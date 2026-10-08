import type { CaseClaim, CaseDocument, CaseFact, CaseState, EvidenceItem, EvidenceProvenance, InformationStatus } from '@/lib/api';
import type { EvidenceMapNode, EvidenceMapPath, EvidenceMapRelationship, EvidenceMapStatus } from './types';

function valueText(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value recorded';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return 'No value recorded';
  try {
    return JSON.stringify(value) ?? 'No value recorded';
  } catch {
    return 'Value could not be displayed';
  }
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusForInformation(status: InformationStatus): EvidenceMapStatus {
  switch (status) {
    case 'evidence_supported': return 'evidence-supported';
    case 'user_reported': return 'user-reported';
    case 'conflicting': return 'conflict';
    case 'system_inferred': return 'system-inferred';
    case 'assumption': return 'assumption';
    case 'unknown': return 'unknown';
  }
}

function sourceStatus(
  evidence: EvidenceItem | null,
  document: CaseDocument | null,
  recordStatus?: InformationStatus,
): EvidenceMapStatus {
  if (recordStatus === 'conflicting' || evidence?.status === 'conflicting') return 'conflict';
  if (recordStatus === 'evidence_supported' || evidence?.status === 'evidence_supported') return 'evidence-supported';
  if (recordStatus === 'user_reported' || evidence?.source === 'user' || evidence?.status === 'user_reported') return 'user-reported';
  if (evidence?.processingStatus === 'processing' || (document?.reviewStatus === 'awaiting_confirmation' && evidence?.source === 'document')) return 'pending';
  return recordStatus ? statusForInformation(recordStatus) : evidence ? statusForInformation(evidence.status) : 'unknown';
}

function node(
  id: string,
  layer: EvidenceMapNode['layer'],
  title: string,
  detail: string,
  status: EvidenceMapStatus,
  extra: Partial<EvidenceMapNode> = {},
): EvidenceMapNode {
  return { id, layer, title, detail, status, ...extra };
}

function relationship(
  pathId: string,
  index: number,
  from: EvidenceMapNode,
  to: EvidenceMapNode,
  label: string,
  reason: string,
  status: EvidenceMapStatus,
  provenance: string[],
  focus?: EvidenceMapRelationship['focus'],
): EvidenceMapRelationship {
  return { id: `${pathId}:edge-${index}`, from, to, label, reason, status, provenance, ...(focus ? { focus } : {}) };
}

function provenanceForFact(fact: CaseFact, evidence: EvidenceItem, documentId: string | null): EvidenceProvenance[] {
  return fact.provenance.filter((item) =>
    item.source === 'document'
    && item.documentId === (documentId ?? evidence.documentId)
    && (item.documentId != null || item.pageNumber != null),
  );
}

function pagesForEvidence(state: CaseState, evidence: EvidenceItem, documentId: string | null): Array<{ provenance: EvidenceProvenance; fact: CaseFact }> {
  if (!documentId) return [];
  return state.facts.flatMap((fact) => {
    if (!fact.sourceIds.includes(evidence.id)) return [];
    return provenanceForFact(fact, evidence, documentId).map((provenance) => ({ provenance, fact }));
  });
}

function confirmationNode(
  pathId: string,
  document: CaseDocument | null,
  evidence: EvidenceItem | null,
  provenance: EvidenceProvenance | null,
  sourceNode?: EvidenceMapNode,
): EvidenceMapNode {
  const confirmed = provenance?.confirmedByUser === true;
  if (confirmed) {
    return node(
      `${pathId}:confirmation`, 'confirmation', 'Reading confirmed by user',
      provenance?.confirmedAt ? `Confirmed ${provenance.confirmedAt}` : 'The source record marks this extraction as confirmed.',
      'review-confirmed', { confirmedByUser: true, confirmedAt: provenance?.confirmedAt },
    );
  }
  if (provenance?.confirmedAt) {
    return node(
      `${pathId}:confirmation`, 'confirmation', 'Confirmation time recorded',
      'A timestamp was supplied, but the confirming actor was not identified.',
      'unknown', { confirmedAt: provenance.confirmedAt },
    );
  }
  if (document?.reviewStatus === 'awaiting_confirmation') {
    return node(`${pathId}:confirmation`, 'confirmation', 'Awaiting review', 'The document review is awaiting confirmation.', 'pending');
  }
  if (document?.reviewStatus === 'confirmed') {
    return node(
      `${pathId}:confirmation`, 'confirmation', 'Document review marked confirmed',
      'The document review is confirmed; page-specific confirmation details were not supplied.',
      'review-confirmed',
    );
  }
  if (evidence?.source === 'user' || sourceNode?.layer === 'case-intake') {
    return node(`${pathId}:confirmation`, 'confirmation', 'No document confirmation applies', 'This user-reported case-intake source is not a document extraction.', 'unknown');
  }
  return node(`${pathId}:confirmation`, 'confirmation', 'No confirmation recorded', 'Confirmation details were not supplied for this relationship.', 'unknown');
}

function makePath({
  id,
  root,
  evidence,
  document,
  provenance,
  sourceNode,
  rootEvidenceReason,
  rootEvidenceLabel,
  rootEvidenceStatus,
  provenanceFact,
}: {
  id: string;
  root: EvidenceMapNode;
  evidence: EvidenceItem | null;
  document: CaseDocument | null;
  provenance: EvidenceProvenance | null;
  sourceNode?: EvidenceMapNode;
  rootEvidenceReason: string;
  rootEvidenceLabel: string;
  rootEvidenceStatus: EvidenceMapStatus;
  provenanceFact?: CaseFact | null;
}): EvidenceMapPath {
  const isCaseIntake = evidence?.source === 'user'
    && (evidence.type === 'narrative' || evidence.title.toLowerCase().includes('statement'));
  const evidenceNode = sourceNode ?? (isCaseIntake
    ? node(`${id}:case-intake`, 'case-intake', 'CASE_INTAKE · USER_REPORTED',
        'An initial account provided by the user. This is not document evidence, an OCR result, or a legal source.',
        'user-reported', { evidenceId: evidence.id })
    : evidence
    ? node(`${id}:evidence`, 'evidence', evidence.title, `${humanize(evidence.type)} · ${humanize(evidence.source)} source`, sourceStatus(evidence, document, provenance?.status ?? (root.status === 'evidence-supported' ? 'evidence_supported' : undefined)), {
        evidenceId: evidence.id,
      })
    : provenance?.documentId
      ? node(`${id}:evidence`, 'evidence', 'Fact provenance', 'This fact records a document source; no separate evidence ID was supplied.', sourceStatus(null, document, provenance.status), {
          documentId: provenance.documentId,
        })
      : node(`${id}:evidence`, 'evidence', 'No evidence record linked', 'The case record did not return an evidence ID for this source.', 'unknown'));
  const documentNode = document
    ? node(`${id}:document`, 'document', document.filename, `${humanize(document.classification)} · ${humanize(document.processingStatus)}`, sourceStatus(evidence, document, provenance?.status), {
        documentId: document.id,
        evidenceId: evidence?.id,
      })
    : node(
        `${id}:document`, 'document', evidence?.documentId ? 'Document record unavailable' : 'No linked document',
        evidence?.documentId ? `Document ID ${evidence.documentId} is not in the returned document list.` : 'No document ID was returned for this evidence.',
        'unknown', { ...(evidence?.documentId ? { documentId: evidence.documentId } : {}), evidenceId: evidence?.id },
      );
  const pageNumber = provenance?.pageNumber;
  const findingNode = provenance
    ? node(
        `${id}:finding`, 'finding', pageNumber != null ? `Page ${pageNumber} · recorded finding` : 'Recorded finding',
        `${provenanceFact ? valueText(provenanceFact.value) : 'Finding details'} · ${humanize(provenance.extractionMethod || 'method not supplied')}`,
        sourceStatus(evidence, document, provenance.status),
        { ...(document?.id ? { documentId: document.id } : {}), evidenceId: evidence?.id, ...(pageNumber != null ? { pageNumber } : {}), provenance,
          ...(provenance.confirmedByUser !== undefined ? { confirmedByUser: provenance.confirmedByUser } : {}),
          ...(provenance.confirmedAt !== undefined ? { confirmedAt: provenance.confirmedAt } : {}),
        },
      )
    : node(`${id}:finding`, 'finding', 'No page or finding supplied', 'Page-level provenance was not returned for this relationship.', 'unknown', {
        ...(document?.id ? { documentId: document.id } : {}), evidenceId: evidence?.id,
      });
  const confirmation = confirmationNode(id, document, evidence, provenance, sourceNode);
  const focus = document?.id
    ? { documentId: document.id, ...(evidence?.id ? { evidenceId: evidence.id } : {}), ...(pageNumber != null ? { pageNumber } : {}) }
    : undefined;
  const chain: [EvidenceMapNode, EvidenceMapNode, EvidenceMapNode, EvidenceMapNode, EvidenceMapNode] = [root, evidenceNode, documentNode, findingNode, confirmation];
  const relationships = [
    relationship(id, 0, root, evidenceNode, rootEvidenceLabel, rootEvidenceReason, rootEvidenceStatus, [rootEvidenceReason], focus),
    relationship(
      id, 1, evidenceNode, documentNode,
      evidence?.documentId || provenance?.documentId ? 'links to document' : 'document link missing',
      evidence?.documentId
        ? 'The evidence record supplies this document ID.'
        : provenance?.documentId
          ? 'The fact provenance directly supplies this document ID.'
          : 'This evidence record does not include a document ID.',
      document ? sourceStatus(evidence, document, provenance?.status) : 'unknown',
      evidence?.documentId || provenance?.documentId
        ? [`Document ID: ${evidence?.documentId ?? provenance?.documentId}`, ...(document ? [`File: ${document.filename}`] : [])]
        : ['Document ID not supplied'],
      focus,
    ),
    relationship(
      id, 2, documentNode, findingNode,
      provenance?.pageNumber != null ? `page ${provenance.pageNumber}` : 'page/finding unavailable',
      provenance
        ? 'The fact provenance records this document page and extraction method.'
        : 'No page-level finding was returned for this evidence-to-document relationship.',
      provenance ? sourceStatus(evidence, document, provenance.status) : 'unknown',
      provenance
        ? [
            `Extraction method: ${provenance.extractionMethod || 'not supplied'}`,
            `Confidence: ${Math.round(Math.max(0, Math.min(1, provenance.confidence)) * 100)}%`,
            ...(provenance.confirmedAt ? [`Confirmed at: ${provenance.confirmedAt}`] : []),
          ]
        : ['Page and finding details not supplied'],
      focus,
    ),
    relationship(
      id, 3, findingNode, confirmation,
      confirmation.confirmedByUser ? 'user confirmed reading' : confirmation.status === 'pending' ? 'awaiting confirmation' : 'confirmation status',
      confirmation.confirmedByUser
        ? 'The provenance record says the user confirmed the extraction reading.'
        : confirmation.status === 'pending'
          ? 'The document review record is awaiting user confirmation.'
          : 'This displays only the confirmation metadata returned by the case record.',
      confirmation.status,
      [confirmation.detail],
      focus,
    ),
  ];
  return { id, nodes: chain, relationships };
}

function placeholderPath(id: string, root: EvidenceMapNode, reason: string): EvidenceMapPath {
  return makePath({
    id,
    root,
    evidence: null,
    document: null,
    provenance: null,
    rootEvidenceLabel: 'no link recorded',
    rootEvidenceReason: reason,
    rootEvidenceStatus: 'unknown',
  });
}

function factRoot(fact: CaseFact): EvidenceMapNode {
  const label = fact.key === 'statement' ? valueText(fact.value) : `${humanize(fact.key)}: ${valueText(fact.value)}`;
  return node(`fact:${fact.id}`, 'claim-fact', label, `Fact · ${humanize(fact.status)}`, statusForInformation(fact.status));
}

function claimRoot(claim: CaseClaim): EvidenceMapNode {
  return node(`claim:${claim.id}`, 'claim-fact', claim.text, `Claim · ${humanize(claim.status)}`, statusForInformation(claim.status));
}

export function buildEvidenceMap(state: CaseState): EvidenceMapPath[] {
  const evidenceById = new Map(state.evidence.map((item) => [item.id, item]));
  const documentById = new Map(state.documents.map((item) => [item.id, item]));
  const paths: EvidenceMapPath[] = [];
  const usedEvidenceIds = new Set<string>();

  const hasInitialNarrative = state.evidence.some((item) =>
    item.source === 'user' && (item.type === 'narrative' || item.title.toLowerCase().includes('statement')),
  );
  if (state.initialStatement?.trim() && !hasInitialNarrative) {
    const statement = state.initialStatement.trim();
    const preview = statement.length > 180 ? `${statement.slice(0, 177)}…` : statement;
    const root = node('claim:initial-statement', 'claim-fact', 'Initial user statement · CASE_INTAKE', preview, 'user-reported');
    const intakeSource = node(
      'case:initial-statement:case-intake', 'case-intake', 'CASE_INTAKE · USER_REPORTED',
      'The user-provided initial statement is part of case intake, not DOCUMENT_EVIDENCE, an OCR_RESULT, or a LEGAL_SOURCE.',
      'user-reported',
    );
    paths.push(makePath({
      id: 'case:initial-statement', root, evidence: null, document: null, provenance: null, sourceNode: intakeSource,
      rootEvidenceReason: 'This is the initial account saved in the case record and is identified as user-reported.',
      rootEvidenceLabel: 'user reported',
      rootEvidenceStatus: 'user-reported',
    }));
  }

  for (const claim of state.claims) {
    const linkedIds = new Set(claim.evidenceIds);
    state.evidence.forEach((item) => {
      if (item.supportsClaimIds.includes(claim.id) || item.conflictsWithClaimIds.includes(claim.id)) linkedIds.add(item.id);
    });
    if (linkedIds.size === 0) {
      paths.push(placeholderPath(`claim:${claim.id}:unlinked`, claimRoot(claim), 'The claim has no evidence IDs recorded on either side of the relationship.'));
      continue;
    }
    for (const evidenceId of linkedIds) {
      const evidence = evidenceById.get(evidenceId) ?? null;
      if (evidence) usedEvidenceIds.add(evidence.id);
      const document = evidence?.documentId ? documentById.get(evidence.documentId) ?? null : null;
      const explicitConflict = evidence?.conflictsWithClaimIds.includes(claim.id) || evidence?.status === 'conflicting';
      const relationStatus = explicitConflict
        ? 'conflict'
        : sourceStatus(evidence, document, claim.status);
      const declaredOnClaim = claim.evidenceIds.includes(evidenceId);
      const declaredByEvidence = Boolean(evidence?.supportsClaimIds.includes(claim.id));
      const reason = explicitConflict
        ? 'The evidence record lists this claim under conflictsWithClaimIds.'
        : declaredOnClaim && declaredByEvidence
          ? 'The claim and evidence records both list this relationship.'
          : declaredOnClaim
            ? 'The claim evidenceIds list this evidence ID.'
            : 'The evidence supportsClaimIds list this claim ID.';
      const pageSources = evidence ? pagesForEvidence(state, evidence, document?.id ?? null) : [];
      const sources = pageSources.length ? pageSources : [{ provenance: null, fact: null }];
      sources.forEach(({ provenance, fact }, index) => {
        paths.push(makePath({
          id: `claim:${claim.id}:${evidenceId}:${index}`,
          root: claimRoot(claim), evidence, document, provenance, provenanceFact: fact,
          rootEvidenceReason: reason,
          rootEvidenceLabel: explicitConflict ? 'conflicts with' : 'linked evidence',
          rootEvidenceStatus: relationStatus,
        }));
      });
    }
  }

  for (const fact of state.facts) {
    const root = factRoot(fact);
    const sources = fact.sourceIds.map((id) => ({ evidence: evidenceById.get(id) ?? null, evidenceId: id, provenance: null as EvidenceProvenance | null }));
    const unmatchedProvenance = fact.provenance.filter((provenance) =>
      provenance.documentId && !sources.some((source) => source.evidence?.documentId === provenance.documentId),
    ).map((provenance, index) => ({
      evidence: null,
      evidenceId: `provenance-${fact.id}-${index}`,
      provenance,
    }));
    const factSources = [...sources, ...unmatchedProvenance];
    if (factSources.length === 0) {
      paths.push(placeholderPath(`fact:${fact.id}:unlinked`, root, 'The fact has no source IDs or page provenance recorded.'));
      continue;
    }
    factSources.forEach(({ evidence, evidenceId, provenance: directProvenance }, sourceIndex) => {
      if (evidence) usedEvidenceIds.add(evidence.id);
      const documentId = directProvenance?.documentId ?? evidence?.documentId ?? null;
      const document = documentId ? documentById.get(documentId) ?? null : null;
      const pageSources = directProvenance
        ? [{ provenance: directProvenance, fact }]
        : evidence
          ? provenanceForFact(fact, evidence, documentId).map((provenance) => ({ provenance, fact }))
          : [];
      const selectedPageSources = pageSources.length ? pageSources : [{ provenance: null, fact: null }];
      selectedPageSources.forEach(({ provenance, fact: pageFact }, pageIndex) => {
        const isDirectProvenance = directProvenance != null;
        const edgeReason = isDirectProvenance
          ? 'The fact provenance directly records a source document and page.'
          : evidence
            ? 'The fact sourceIds list this evidence record.'
            : 'The fact sourceIds reference an evidence ID not returned with the case.';
        const status = sourceStatus(evidence, document, provenance?.status ?? fact.status);
        paths.push(makePath({
          id: `fact:${fact.id}:${evidenceId}:${sourceIndex}:${pageIndex}`,
          root, evidence, document, provenance, provenanceFact: pageFact,
          rootEvidenceReason: edgeReason,
          rootEvidenceLabel: isDirectProvenance ? 'has recorded provenance' : 'source link',
          rootEvidenceStatus: status,
        }));
      });
    });
  }

  for (const evidence of state.evidence) {
    if (usedEvidenceIds.has(evidence.id)) continue;
    const root = node(`unlinked:${evidence.id}`, 'claim-fact', 'No claim or fact linked', 'No matching relationship ID was returned.', 'unknown');
    const document = evidence.documentId ? documentById.get(evidence.documentId) ?? null : null;
    const pageSources = pagesForEvidence(state, evidence, document?.id ?? null);
    const sources = pageSources.length ? pageSources : [{ provenance: null, fact: null }];
    sources.forEach(({ provenance, fact }, index) => paths.push(makePath({
      id: `unlinked:${evidence.id}:${index}`,
      root, evidence, document, provenance, provenanceFact: fact,
      rootEvidenceLabel: 'no claim/fact link',
      rootEvidenceReason: 'No claim.evidenceIds, evidence.supportsClaimIds, or fact.sourceIds relationship points to this record.',
      rootEvidenceStatus: 'unknown',
    })));
  }

  for (const document of state.documents) {
    if (state.evidence.some((item) => item.documentId === document.id) || paths.some((path) => path.nodes[2].documentId === document.id)) continue;
    const root = node(`unlinked-document:${document.id}:root`, 'claim-fact', 'No claim or fact linked', 'No evidence relationship to this document was returned.', 'unknown');
    const syntheticEvidence = node(`unlinked-document:${document.id}:source`, 'evidence', 'Document source link not supplied', 'The document is in the case record without a linked evidence record.', 'unknown');
    const pathId = `unlinked-document:${document.id}`;
    const path = makePath({
      id: pathId, root, evidence: null, document, provenance: null,
      rootEvidenceReason: 'No relationship from a claim, fact, or evidence record to this document was returned.',
      rootEvidenceLabel: 'no link recorded', rootEvidenceStatus: 'unknown',
    });
    path.nodes[1] = syntheticEvidence;
    path.relationships[0] = relationship(pathId, 0, root, syntheticEvidence, 'no link recorded', 'No relationship from a claim, fact, or evidence record to this document was returned.', 'unknown', ['Document is present, but its evidence relationship was not supplied.']);
    paths.push(path);
  }

  if (paths.length === 0) {
    const root = node('case:empty', 'claim-fact', 'No claim or fact recorded', 'The case has no claim or fact records yet.', 'unknown');
    paths.push(placeholderPath('case:empty', root, 'No relationship data is available for this case yet.'));
  }

  return paths;
}

export function mapStatusForDisplay(status: EvidenceMapStatus): string {
  switch (status) {
    case 'evidence-supported': return 'Evidence-supported';
    case 'user-reported': return 'User-reported';
    case 'review-confirmed': return 'Review-confirmed';
    case 'pending': return 'Pending';
    case 'unknown': return 'Unknown';
    case 'conflict': return 'Conflicting';
    case 'system-inferred': return 'System-inferred';
    case 'assumption': return 'Assumption';
  }
}
