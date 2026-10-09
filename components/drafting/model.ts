import type { CaseState, EvidenceItem } from '@/lib/api';
import { DRAFT_DOCUMENT_TYPES, type DraftDocumentType, type DraftFields, type DraftSourceFact, type DraftState, type PersistedDraftState } from './types';

export const DRAFTING_STORAGE_VERSION = 2;

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Non-cryptographic content fingerprint used only to detect a changed source case. */
export function getCaseStateFingerprint(caseState: CaseState): string {
  const serialized = stableSerialize(caseState);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${caseState.id}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

export function isDraftStale(draft: DraftState, caseState: CaseState): boolean {
  return draft.sourceCaseFingerprint !== getCaseStateFingerprint(caseState);
}

export function createInitialDraft(caseState: CaseState): DraftState {
  const sender = caseState.person.name?.trim() ?? '';
  return {
    version: DRAFTING_STORAGE_VERSION,
    sourceCaseFingerprint: getCaseStateFingerprint(caseState),
    documentType: DRAFT_DOCUMENT_TYPES[0].id,
    fields: {
      documentHeading: DRAFT_DOCUMENT_TYPES[0].title,
      recipient: '',
      recipientAddress: '',
      sender,
      senderContact: caseState.person.contact?.trim() ?? '',
      date: '',
      subject: '',
      greeting: 'Dear',
      purpose: '',
      detailsHeading: 'Details from the case',
      additionalDetails: '',
      requestedAction: '',
      requestHeading: DRAFT_DOCUMENT_TYPES[0].requestHeading,
      closing: 'Sincerely,',
      signature: sender,
      legalText: '',
      legalSourceLabel: '',
      legalSourceUrl: '',
      noticeReference: '',
      noticeDate: '',
      noticeDetails: '',
      responsePosition: '',
    },
    includedFactIds: getDraftSourceFacts(caseState)
      .filter((fact) => fact.canInclude)
      .map((fact) => fact.id),
    factEdits: {},
    hasUserEdited: false,
    reviewConfirmed: false,
    unresolvedAcknowledged: false,
  };
}

function printableValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

function sourceNoteForEvidence(evidence: EvidenceItem, caseState: CaseState): string {
  const document = evidence.documentId
    ? caseState.documents.find((item) => item.id === evidence.documentId)
    : undefined;
  const origin = evidence.source === 'document'
    ? `Uploaded document${document ? ` · ${document.filename}` : ''}`
    : evidence.source === 'user'
      ? 'Your statement'
      : 'Case analysis';
  return `${evidence.title} · ${origin} · ${evidence.status.replaceAll('_', ' ')}`;
}

function factSources(ids: string[], caseState: CaseState, provenance: CaseState['facts'][number]['provenance'] = []): string[] {
  const byId = new Map(caseState.evidence.map((evidence) => [evidence.id, evidence]));
  const notes = [...new Set(ids)].map((id) => {
    const evidence = byId.get(id);
    return evidence ? sourceNoteForEvidence(evidence, caseState) : `Unresolved source reference ${id}`;
  });
  provenance.forEach((item) => {
    const document = caseState.documents.find((entry) => entry.id === item.documentId);
    notes.push(`${document?.filename ?? `Source document ${item.documentId}`} · page ${item.pageNumber} · ${item.status.replaceAll('_', ' ')}`);
  });
  return [...new Set(notes)];
}

function statusForFact(status: CaseState['facts'][number]['status']): DraftSourceFact['status'] {
  return status;
}

export function getDraftSourceFacts(caseState: CaseState): DraftSourceFact[] {
  const result: DraftSourceFact[] = [];
  const hasNarrativeFact = caseState.facts.some(
    (fact) => fact.key.toLowerCase() === 'statement' && printableValue(fact.value),
  );
  const narrativeEvidence = caseState.evidence.filter(
    (item) => item.source === 'user' && (item.type === 'narrative' || item.title.toLowerCase().includes('statement')),
  );

  if (caseState.initialStatement?.trim() && !hasNarrativeFact) {
    result.push({
      id: 'initial-statement',
      label: 'Initial statement',
      value: caseState.initialStatement.trim(),
      status: 'user_reported',
      sourceNotes: [
        'Case intake · your statement · user reported',
        ...narrativeEvidence.map((evidence) => sourceNoteForEvidence(evidence, caseState)),
      ],
      canInclude: true,
    });
  }

  for (const fact of caseState.facts) {
    const value = printableValue(fact.value);
    const sourceNotes = factSources(fact.sourceIds, caseState, fact.provenance);
    const linkedEvidence = fact.sourceIds
      .map((id) => caseState.evidence.find((item) => item.id === id))
      .filter((item): item is EvidenceItem => Boolean(item));
    const sourceStatuses = [
      ...linkedEvidence.map((item) => item.status),
      ...fact.provenance.map((item) => item.status),
    ];
    const hasSupportedSource = sourceStatuses.some((status) => status === 'user_reported' || status === 'evidence_supported');
    const factStatus = value ? statusForFact(fact.status) : 'missing';
    const status = value && (factStatus === 'user_reported' || factStatus === 'evidence_supported') && !hasSupportedSource
      ? 'unsupported'
      : factStatus;
    result.push({
      id: `fact:${fact.id}`,
      label: fact.key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value,
      status,
      sourceNotes,
      canInclude: Boolean(value) && (status === 'user_reported' || status === 'evidence_supported'),
    });
  }

  for (const event of caseState.events) {
    const description = event.description.trim();
    const value = [
      event.date?.trim() ? `${event.datePrecision === 'approximate' ? 'Around ' : ''}${event.date?.trim()}` : '',
      description,
    ].filter(Boolean).join(' · ');
    const evidence = event.evidenceIds
      .map((id) => caseState.evidence.find((item) => item.id === id))
      .filter((item): item is EvidenceItem => Boolean(item));
    const eventStatus = evidence.some((item) => item.status === 'conflicting')
      ? 'conflicting'
      : evidence.some((item) => item.status === 'evidence_supported')
        ? 'evidence_supported'
        : evidence.some((item) => item.status === 'user_reported')
          ? 'user_reported'
          : 'unsupported';
    result.push({
      id: `event:${event.id}`,
      label: event.type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value,
      status: value ? eventStatus : 'missing',
      sourceNotes: factSources(event.evidenceIds, caseState),
      canInclude: Boolean(value) && (eventStatus === 'user_reported' || eventStatus === 'evidence_supported'),
    });
  }

  return result;
}

export function getUnknownCaseItems(caseState: CaseState): string[] {
  return [...new Set([
    ...caseState.unknowns,
    ...(caseState.analysis?.journey.unknowns ?? []).map((item) => item.question),
    ...caseState.facts
    .filter((fact) => fact.status === 'unknown' || fact.status === 'conflicting' || fact.status === 'assumption' || fact.status === 'system_inferred')
      .map((fact) => `${fact.key.replace(/[_-]+/g, ' ')}: ${printableValue(fact.value) || 'not recorded'}`),
  ].map((item) => item.trim()).filter(Boolean))];
}

export function getDocumentType(id: DraftDocumentType) {
  return DRAFT_DOCUMENT_TYPES.find((item) => item.id === id) ?? DRAFT_DOCUMENT_TYPES[0];
}

export function getUnresolvedFields(draft: DraftState, facts: DraftSourceFact[]): string[] {
  const required: Array<[string, string]> = [
    ['documentHeading', 'Document heading'],
    ['recipient', 'Recipient name or organization'],
    ['sender', 'Your name'],
    ['date', 'Date'],
    ['subject', 'Subject'],
    ['greeting', 'Greeting'],
    ['purpose', 'Why you are writing'],
    ['detailsHeading', 'Details heading'],
    ['requestHeading', 'Request heading'],
    ['requestedAction', getDocumentType(draft.documentType).requestLabel],
    ['signature', 'Signature name'],
  ];
  if (draft.documentType === 'response-correspondence') {
    required.push(
      ['noticeReference', 'Notice reference'],
      ['noticeDetails', 'Details of the notice'],
      ['responsePosition', 'Your response to the notice'],
    );
  }
  const missing = required
    .filter(([key]) => !draft.fields[key as keyof DraftFields].trim())
    .map(([, label]) => label);

  const selectedFacts = facts.filter((fact) => draft.includedFactIds.includes(fact.id));
  const hasDetails = Boolean(draft.fields.additionalDetails.trim())
    || selectedFacts.some((fact) => (draft.factEdits[fact.id] ?? fact.value).trim());
  if (!hasDetails) missing.push('Relevant details (select a case fact or add details)');

  const hasBlankSelectedFact = selectedFacts.some((fact) => !(draft.factEdits[fact.id] ?? fact.value).trim());
  if (hasBlankSelectedFact) missing.push('Text for one or more selected case facts');

  if (draft.fields.legalText.trim() && !draft.fields.legalSourceLabel.trim()) {
    missing.push('Source for the legal wording you added');
  }

  return [...new Set(missing)];
}

export function createDocumentText(draft: DraftState, facts: DraftSourceFact[], unresolved: string[]): string {
  const type = getDocumentType(draft.documentType);
  const fields = draft.fields;
  const includedFacts = facts.filter((fact) => draft.includedFactIds.includes(fact.id));

  const valueOrPrompt = (value: string, prompt: string) => value.trim() || `[Add ${prompt}]`;
  const lines = [
    'LAW SENSE · DOCUMENT STUDIO',
    `Status: Generated draft${draft.hasUserEdited ? ' · User edited' : ''} · Not professionally reviewed`,
    `Document type: ${type.title}`,
    '',
    fields.documentHeading.trim() || `[Add document heading]`,
    '',
    valueOrPrompt(fields.date, 'date'),
    '',
    `To: ${valueOrPrompt(fields.recipient, 'recipient name or organization')}`,
    ...(fields.recipientAddress.trim() ? [fields.recipientAddress.trim()] : []),
    `From: ${valueOrPrompt(fields.sender, 'your name')}`,
    ...(fields.senderContact.trim() ? [fields.senderContact.trim()] : []),
    '',
    `Subject: ${valueOrPrompt(fields.subject, 'subject')}`,
    '',
    `${fields.greeting.trim() || '[Add greeting]'} ${fields.recipient.trim() || '[Add recipient name or organization]'},`,
    '',
    `Purpose: ${valueOrPrompt(fields.purpose, 'why you are writing')}`,
    '',
    `${fields.detailsHeading.trim() || '[Add details heading]'}:`,
    ...(includedFacts.length > 0
      ? includedFacts.map((fact, index) => `${index + 1}. ${valueOrPrompt(draft.factEdits[fact.id] ?? fact.value, `${fact.label.toLowerCase()} details`)} [S${index + 1}]`)
      : ['[Add relevant details or select case facts to include.]']),
    ...(draft.documentType === 'response-correspondence'
      ? [
        '',
        `Notice reference: ${valueOrPrompt(fields.noticeReference, 'notice reference')}`,
        `Date of notice: ${valueOrPrompt(fields.noticeDate, 'date of notice')}`,
        `Notice details: ${valueOrPrompt(fields.noticeDetails, 'notice details')}`,
        `Your response: ${valueOrPrompt(fields.responsePosition, 'your response to the notice')}`,
      ]
      : []),
    ...(fields.additionalDetails.trim() ? ['', 'Additional details:', fields.additionalDetails.trim()] : []),
    '',
    `${fields.requestHeading.trim() || '[Add request heading]'}: ${valueOrPrompt(fields.requestedAction, type.requestLabel.toLowerCase())}`,
    ...(fields.legalText.trim() ? ['', 'Legal wording supplied by you:', `${fields.legalText.trim()} [L1]`] : []),
    '',
    fields.closing.trim() || 'Sincerely,',
    '',
    valueOrPrompt(fields.signature, 'signature name'),
    ...(fields.senderContact.trim() ? [fields.senderContact.trim()] : []),
    '',
    'DRAFTING SOURCE NOTES · Review these before using the document',
    ...(includedFacts.length > 0
      ? includedFacts.map((fact, index) => {
        const source = fact.sourceNotes.length > 0 ? fact.sourceNotes.join('; ') : 'Case record · source link not recorded';
        const edited = draft.factEdits[fact.id] !== undefined && draft.factEdits[fact.id] !== fact.value;
        return `[S${index + 1}] ${fact.label} · ${fact.status.replaceAll('_', ' ')} · ${edited ? 'wording edited by you · ' : ''}${source}`;
      })
      : ['No case facts were inserted.']),
    ...(fields.legalText.trim()
      ? [`[L1] User-supplied legal wording · ${fields.legalSourceLabel.trim() || 'source not supplied'}${fields.legalSourceUrl.trim() ? ` · ${fields.legalSourceUrl.trim()}` : ''}`]
      : ['No legal sections were inserted by Law Sense.']),
    '',
    `Unresolved fields: ${unresolved.length ? unresolved.join(' · ') : 'None'}`,
    'Any bracketed “Add …” text is a placeholder, not a case fact.',
  ];
  return lines.join('\n');
}

export function isDraftState(value: unknown): value is PersistedDraftState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedDraftState>;
  const fieldNames: Array<keyof DraftFields> = [
    'documentHeading', 'recipient', 'recipientAddress', 'sender', 'senderContact', 'date', 'subject',
    'greeting', 'purpose', 'detailsHeading', 'additionalDetails', 'requestedAction', 'requestHeading',
    'closing', 'signature', 'legalText', 'legalSourceLabel', 'legalSourceUrl',
  ];
  return (candidate.version === 1 || candidate.version === DRAFTING_STORAGE_VERSION)
    && (candidate.version === 1 || typeof candidate.sourceCaseFingerprint === 'string')
    && DRAFT_DOCUMENT_TYPES.some((type) => type.id === candidate.documentType)
    && Boolean(candidate.fields && typeof candidate.fields === 'object')
    && fieldNames.every((field) => typeof candidate.fields?.[field] === 'string')
    && ['noticeReference', 'noticeDate', 'noticeDetails', 'responsePosition'].every((field) =>
      candidate.fields?.[field as keyof DraftFields] === undefined
      || typeof candidate.fields?.[field as keyof DraftFields] === 'string')
    && Array.isArray(candidate.includedFactIds)
    && candidate.includedFactIds.every((id) => typeof id === 'string')
    && Boolean(candidate.factEdits && typeof candidate.factEdits === 'object')
    && Object.values(candidate.factEdits ?? {}).every((entry) => typeof entry === 'string')
    && typeof candidate.hasUserEdited === 'boolean'
    && typeof candidate.reviewConfirmed === 'boolean'
    && typeof candidate.unresolvedAcknowledged === 'boolean';
}

export function normalizeDraftState(candidate: PersistedDraftState, caseState: CaseState): DraftState {
  const defaults = createInitialDraft(caseState);
  const includedFactIds = new Set(getDraftSourceFacts(caseState).filter((fact) => fact.canInclude).map((fact) => fact.id));
  return {
    ...defaults,
    ...candidate,
    version: DRAFTING_STORAGE_VERSION,
    sourceCaseFingerprint: candidate.version === 1
      ? 'legacy-draft-without-case-fingerprint'
      : candidate.sourceCaseFingerprint,
    reviewConfirmed: candidate.version === 1 ? false : candidate.reviewConfirmed,
    fields: { ...defaults.fields, ...candidate.fields },
    includedFactIds: candidate.includedFactIds.filter((id) => includedFactIds.has(id)),
    factEdits: Object.fromEntries(Object.entries(candidate.factEdits).filter(([id, value]) => includedFactIds.has(id) && typeof value === 'string')),
  };
}

/** Refresh only source selections and provenance after an explicit user review. */
export function refreshDraftSources(draft: DraftState, caseState: CaseState): DraftState {
  return {
    ...draft,
    sourceCaseFingerprint: getCaseStateFingerprint(caseState),
    includedFactIds: [],
    factEdits: {},
    reviewConfirmed: false,
    unresolvedAcknowledged: false,
  };
}
