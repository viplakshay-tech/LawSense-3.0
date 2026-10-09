'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowLeft,
  BookOpenText,
  Check,
  CheckCircle2,
  CircleHelp,
  FilePenLine,
  Link2,
  Printer,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import {
  createDocumentText,
  createInitialDraft,
  getDocumentType,
  getDraftSourceFacts,
  getUnknownCaseItems,
  getUnresolvedFields,
  isDraftStale,
  isDraftState,
  normalizeDraftState,
  refreshDraftSources,
} from './model';
import { DRAFT_DOCUMENT_TYPES, type DraftDocumentType, type DraftFields, type DraftSourceFact, type DraftState } from './types';
import type { CaseState } from '@/lib/api';
import { DocumentPackagePanel } from './DocumentPackagePanel';
import './DraftingStudio.css';

const styles = new Proxy<Record<string, string>>({} as Record<string, string>, {
  get: (_target, property) => typeof property === 'string' ? `lsd-${property}` : undefined,
});

const STATUS_LABELS: Record<DraftSourceFact['status'], string> = {
  user_reported: 'User-reported',
  evidence_supported: 'Evidence-supported',
  system_inferred: 'System-inferred',
  assumption: 'Assumption',
  conflicting: 'Conflicting',
  unknown: 'Unknown',
  missing: 'Missing',
  unsupported: 'Unsupported',
};

function storageKey(caseId: string) {
  return `lawsense:drafting:v${1}:${caseId}`;
}

function safeSourceUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasVerifiedLegalSource(caseState: CaseState, label: string, url: string): boolean {
  const normalizedLabel = label.trim().toLocaleLowerCase();
  const normalizedUrl = safeSourceUrl(url);
  return Boolean(caseState.analysis?.legalKnowledge.records.some((record) => {
    if (record.status !== 'verified' || (record.sourceVerificationStatus && record.sourceVerificationStatus !== 'verified')) return false;
    const recordUrl = safeSourceUrl(record.sourceUrl || record.provenance.find((item) => item.sourceUrl)?.sourceUrl);
    const normalizedReference = (record.reference ?? '').trim().toLocaleLowerCase();
    return Boolean(
      (normalizedLabel && (record.title.trim().toLocaleLowerCase() === normalizedLabel || normalizedReference === normalizedLabel))
      || (normalizedUrl && recordUrl === normalizedUrl),
    );
  }));
}

function FactStatus({ status }: { status: DraftSourceFact['status'] }) {
  return <span className={`${styles.status} ${styles[`status_${status}`]}`}>{STATUS_LABELS[status]}</span>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  hint,
  multiline = false,
  rows = 3,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required && <span className={styles.requiredMark}>Required for review</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={styles.textarea}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={styles.input}
        />
      )}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

function getFactDisplayValue(fact: DraftSourceFact, draft: DraftState): string {
  return draft.factEdits[fact.id] ?? fact.value;
}

export function DraftingStudio({ caseId }: { caseId: string }) {
  const { caseState, loading, error, refreshCaseState } = useCaseState();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageNotice, setStorageNotice] = useState('Saved in this browser');
  const paperRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!caseState || caseState.id !== caseId) return;
    const initial = createInitialDraft(caseState);
    let nextDraft = initial;
    let notice = 'Saved in this browser';
    try {
      const saved = window.localStorage.getItem(storageKey(caseId));
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        nextDraft = isDraftState(parsed) ? normalizeDraftState(parsed, caseState) : initial;
      }
    } catch {
      notice = 'This browser could not reopen a saved draft. Your current edits will stay in this tab.';
    }
    startTransition(() => {
      setDraft(nextDraft);
      setStorageNotice(notice);
      setHydrated(true);
    });
  }, [caseId, caseState]);

  useEffect(() => {
    if (!hydrated || !draft) return;
    try {
      window.localStorage.setItem(storageKey(caseId), JSON.stringify(draft));
    } catch {
      startTransition(() => setStorageNotice('Browser storage is unavailable · keep this tab open while drafting'));
    }
  }, [caseId, draft, hydrated]);

  const sourceFacts = useMemo(
    () => (caseState ? getDraftSourceFacts(caseState) : []),
    [caseState],
  );
  const unknownItems = useMemo(
    () => (caseState ? getUnknownCaseItems(caseState) : []),
    [caseState],
  );
  const draftIsStale = Boolean(caseState && draft && isDraftStale(draft, caseState));
  const previewDraft = useMemo(
    () => draft
      ? draftIsStale
        ? { ...draft, includedFactIds: [], factEdits: {} }
        : draft
      : null,
    [draft, draftIsStale],
  );
  const verifiedLegalSourceMissing = Boolean(
    caseState && previewDraft?.fields.legalText.trim()
    && !hasVerifiedLegalSource(caseState, previewDraft.fields.legalSourceLabel, previewDraft.fields.legalSourceUrl),
  );
  const unresolved = useMemo(
    () => {
      const missing = previewDraft ? getUnresolvedFields(previewDraft, sourceFacts) : [];
      if (verifiedLegalSourceMissing) missing.push('Verified legal source already recorded in this case');
      return missing;
    },
    [previewDraft, sourceFacts, verifiedLegalSourceMissing],
  );
  const previewText = useMemo(
    () => (previewDraft ? createDocumentText(previewDraft, sourceFacts, unresolved) : ''),
    [previewDraft, sourceFacts, unresolved],
  );

  if (loading || !caseState || caseState.id !== caseId || !draft || !hydrated) {
    return (
      <main className={styles.loading}>
        {error ? (
          <div className={styles.loadCard} role="alert">
            <ShieldCheck aria-hidden="true" />
            <h1>Drafting needs your case record</h1>
            <p>{error}</p>
            <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)}>Try again</button>
          </div>
        ) : (
          <div className={styles.loadingCard} role="status">
            <span className={styles.loader} />
            <span>Opening your document studio…</span>
          </div>
        )}
      </main>
    );
  }

  const activeDraft = draft;
  const selectedType = getDocumentType(activeDraft.documentType);
  const selectedFacts = sourceFacts.filter((fact) => previewDraft?.includedFactIds.includes(fact.id));
  const safeLegalSources = (caseState.analysis?.legalKnowledge.records ?? [])
    .map((record) => ({ record, url: safeSourceUrl(record.sourceUrl || record.provenance.find((item) => item.sourceUrl)?.sourceUrl) }))
    .filter((item) => item.url && item.record.status === 'verified' && (!item.record.sourceVerificationStatus || item.record.sourceVerificationStatus === 'verified'));

  function changeField(field: keyof DraftFields, value: string) {
    setDraft((current) => current ? {
      ...current,
      fields: { ...current.fields, [field]: value },
      hasUserEdited: true,
      reviewConfirmed: false,
      unresolvedAcknowledged: false,
    } : current);
  }

  function chooseType(documentType: DraftDocumentType) {
    setDraft((current) => current ? {
      ...current,
      documentType,
      fields: {
        ...current.fields,
        documentHeading: current.fields.documentHeading === getDocumentType(current.documentType).title
          ? getDocumentType(documentType).title
          : current.fields.documentHeading,
        requestHeading: current.fields.requestHeading === getDocumentType(current.documentType).requestHeading
          ? getDocumentType(documentType).requestHeading
          : current.fields.requestHeading,
      },
      hasUserEdited: true,
      reviewConfirmed: false,
      unresolvedAcknowledged: false,
    } : current);
  }

  function toggleFact(fact: DraftSourceFact, checked: boolean) {
    if (!fact.canInclude) return;
    setDraft((current) => {
      if (!current) return current;
      const includedFactIds = checked
        ? [...new Set([...current.includedFactIds, fact.id])]
        : current.includedFactIds.filter((id) => id !== fact.id);
      return {
        ...current,
        includedFactIds,
        hasUserEdited: true,
        reviewConfirmed: false,
        unresolvedAcknowledged: false,
      };
    });
  }

  function editFact(fact: DraftSourceFact, value: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        factEdits: { ...current.factEdits, [fact.id]: value },
        hasUserEdited: true,
        reviewConfirmed: false,
        unresolvedAcknowledged: false,
      };
    });
  }

  function confirmReview() {
    if (draftIsStale || verifiedLegalSourceMissing) return;
    if (unresolved.length > 0 && !activeDraft.unresolvedAcknowledged) return;
    setDraft((current) => current ? { ...current, reviewConfirmed: true } : current);
  }

  function downloadDraft() {
    if (!activeDraft.reviewConfirmed || draftIsStale || verifiedLegalSourceMissing) return;
    const blob = new Blob([previewText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `law-sense-${activeDraft.documentType}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printDraft() {
    const paper = paperRef.current;
    if (!activeDraft.reviewConfirmed || draftIsStale || verifiedLegalSourceMissing || !paper) return;
    const previousBodyVisibility = window.document.body.style.visibility;
    const previousPaperVisibility = paper.style.visibility;
    const restore = () => {
      window.document.body.style.visibility = previousBodyVisibility;
      paper.style.visibility = previousPaperVisibility;
    };
    window.addEventListener('afterprint', restore, { once: true });
    window.document.body.style.visibility = 'hidden';
    paper.style.visibility = 'visible';
    window.print();
  }

  return (
    <main className={`${styles.studio} ${styles.printRoot}`}>
      <div className={styles.studioChrome}>
        <div className={styles.topline}>
          <Link href={`/case/${encodeURIComponent(caseId)}#journey`} className={styles.backLink}>
            <ArrowLeft aria-hidden="true" size={15} /> Back to your case
          </Link>
          <div className={styles.savedStatus} role="status" aria-live="polite">
            <span className={styles.savedDot} /> {hydrated ? storageNotice || 'Saved in this browser' : 'Opening saved draft'}
          </div>
        </div>

        <header className={styles.hero}>
          <div className={styles.heroIcon}><FilePenLine aria-hidden="true" size={20} /></div>
          <div>
            <p className={styles.eyebrow}>Law Sense · Document studio</p>
            <h1>Shape a clear first draft</h1>
            <p className={styles.heroCopy}>Choose a format, review the case details you want to use, then edit every line before export.</p>
          </div>
          <div className={styles.stepper} aria-label="Drafting steps">
            <span className={styles.stepActive}><b>01</b> Choose</span>
            <span className={styles.stepDivider} />
            <span><b>02</b> Edit</span>
            <span className={styles.stepDivider} />
            <span><b>03</b> Review</span>
          </div>
        </header>

        <section className={styles.typeSection} aria-labelledby="type-heading">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionKicker}>01 · FORMAT</span><h2 id="type-heading">What are you preparing?</h2></div>
            <span className={styles.sectionSideNote}>Six starting formats · all editable</span>
          </div>
          <div className={styles.typeGrid}>
            {DRAFT_DOCUMENT_TYPES.map((type, index) => {
              const selected = draft.documentType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => chooseType(type.id)}
                  aria-pressed={selected}
                  className={`${styles.typeCard} ${selected ? styles.typeCardSelected : ''}`}
                >
                  <span className={styles.typeIndex}>0{index + 1}</span>
                  <span className={styles.typeTitle}>{type.title}</span>
                  <span className={styles.typeSummary}>{type.summary}</span>
                  {selected && <CheckCircle2 aria-hidden="true" className={styles.typeCheck} size={17} />}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {draftIsStale && (
        <section className={styles.staleBanner} role="alert" aria-labelledby="draft-stale-heading">
          <div>
            <h2 id="draft-stale-heading">The case changed after this draft was prepared</h2>
            <p>Review the current case sources before continuing. Export is locked, and refreshing removes selected facts and their edits so changed details cannot carry forward unnoticed.</p>
          </div>
          <button
            type="button"
            onClick={() => setDraft((current) => current ? refreshDraftSources(current, caseState) : current)}
            className={styles.staleRefresh}
          >
            Review changes and refresh sources
          </button>
        </section>
      )}

      <div className={styles.workspace}>
        <section className={`${styles.editor} ${styles.studioChrome}`} aria-labelledby="edit-heading">
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.sectionKicker}>02 · EDIT</span>
              <h2 id="edit-heading">Build your {selectedType.title.toLowerCase()}</h2>
              <p>Blank fields stay visibly marked until you provide them.</p>
            </div>
            {draft.hasUserEdited && <span className={styles.editedChip}><Check size={12} /> User edited</span>}
          </div>

          <section className={styles.editorCard} aria-labelledby="address-heading">
            <div className={styles.cardHeading}><span className={styles.cardNumber}>A</span><div><h3 id="address-heading">Address and subject</h3><p>Enter names and details exactly as you want them to appear.</p></div></div>
            <div className={styles.formGrid}>
              <Field label="Document heading" value={draft.fields.documentHeading} onChange={(value) => changeField('documentHeading', value)} placeholder="Document heading" required />
              <Field label="Greeting" value={draft.fields.greeting} onChange={(value) => changeField('greeting', value)} placeholder="Dear" required hint="The recipient's name is added after this phrase." />
              <Field label="To · name or organization" value={draft.fields.recipient} onChange={(value) => changeField('recipient', value)} placeholder="Recipient name or organization" required />
              <Field label="Your name" value={draft.fields.sender} onChange={(value) => changeField('sender', value)} placeholder="Your name" required hint={caseState.person.name ? 'Started from the case profile · user-reported' : undefined} />
              <Field label="Recipient address" value={draft.fields.recipientAddress} onChange={(value) => changeField('recipientAddress', value)} placeholder="Street, office, or email address" />
              <Field label="Date" value={draft.fields.date} onChange={(value) => changeField('date', value)} placeholder="Enter the date to use" required />
              <Field label="Your contact details" value={draft.fields.senderContact} onChange={(value) => changeField('senderContact', value)} placeholder="Phone, email, or address" />
              <Field label="Subject" value={draft.fields.subject} onChange={(value) => changeField('subject', value)} placeholder="A short description of this letter" required />
            </div>
          </section>

          <section className={styles.editorCard} aria-labelledby="purpose-heading">
            <div className={styles.cardHeading}><span className={styles.cardNumber}>B</span><div><h3 id="purpose-heading">Purpose and details</h3><p>Keep the wording factual. Case material stays linked to its source.</p></div></div>
            <div className={styles.stackFields}>
              <Field label="Details section heading" value={draft.fields.detailsHeading} onChange={(value) => changeField('detailsHeading', value)} placeholder="Details from the case" required />
              <Field label="Why you are writing" value={draft.fields.purpose} onChange={(value) => changeField('purpose', value)} placeholder="Briefly describe the purpose of this document" required multiline rows={2} maxLength={1200} />
              {draft.documentType === 'response-correspondence' && (
                <div className={styles.stackFields}>
                  <div className={styles.formGrid}>
                    <Field label="Notice reference" value={draft.fields.noticeReference} onChange={(value) => changeField('noticeReference', value)} placeholder="Reference shown on the notice" required />
                    <Field label="Date of notice" value={draft.fields.noticeDate} onChange={(value) => changeField('noticeDate', value)} placeholder="Enter the date shown on the notice" />
                  </div>
                  <Field label="Notice details" value={draft.fields.noticeDetails} onChange={(value) => changeField('noticeDetails', value)} placeholder="Enter or summarize the notice details" required multiline rows={3} maxLength={5000} hint="Use your wording or quote the notice. The compiler will not infer its contents." />
                  <Field label="Your response to the notice" value={draft.fields.responsePosition} onChange={(value) => changeField('responsePosition', value)} placeholder="State your response in your own words" required multiline rows={3} maxLength={5000} />
                </div>
              )}
              <div className={styles.factsCard}>
                <div className={styles.factsHeader}>
                  <div><h4>Case facts to include</h4><p>{selectedFacts.length} selected · unchecked details stay out of the draft</p></div>
                  <span className={styles.factsIcon}><BookOpenText size={16} aria-hidden="true" /></span>
                </div>
                <p className={styles.provenanceNotice}>Evidence-supported means the case record marks a document extraction as user-confirmed; it does not establish authenticity or truth.</p>
                {sourceFacts.length === 0 ? (
                  <div className={styles.emptyFacts}><CircleHelp size={17} aria-hidden="true" /><span>No case facts are available yet. You can add details below in your own words.</span></div>
                ) : (
                  <div className={styles.factList}>
                    {sourceFacts.map((fact) => {
                      const included = !draftIsStale && draft.includedFactIds.includes(fact.id);
                      return (
                        <article key={fact.id} className={`${styles.factItem} ${included ? styles.factItemIncluded : ''}`}>
                          <div className={styles.factTopline}>
                            <label className={styles.factToggle}>
                              <input type="checkbox" checked={included} disabled={!fact.canInclude} onChange={(event) => toggleFact(fact, event.target.checked)} />
                              <span className={styles.customCheck}>{included && <Check size={12} aria-hidden="true" />}</span>
                              <span className={styles.factName}>{fact.label}</span>
                            </label>
                            <FactStatus status={fact.status} />
                          </div>
                          <p className={styles.factValue}>{fact.value || 'No value recorded.'}</p>
                          {fact.sourceNotes.length > 0 && <p className={styles.sourceLine}><Link2 size={12} aria-hidden="true" /> {fact.sourceNotes.join(' · ')}</p>}
                          {included && (
                            <label className={styles.factEdit}>
                              <span>Edit this wording for the draft</span>
                              <textarea value={getFactDisplayValue(fact, draft)} onChange={(event) => editFact(fact, event.target.value)} rows={Math.min(5, Math.max(2, Math.ceil(fact.value.length / 90)))} maxLength={6000} />
                            </label>
                          )}
                          {!fact.canInclude && <p className={styles.excludedHint}>{fact.status === 'missing'
                            ? 'Missing value · not included'
                            : fact.status === 'conflicting'
                              ? 'Conflicting · review the source before including'
                            : fact.status === 'system_inferred' || fact.status === 'assumption' || fact.status === 'unsupported'
                                ? `${STATUS_LABELS[fact.status]} · not inserted as a confirmed fact`
                                : 'Unknown · not inserted as a confirmed fact'}</p>}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
              <Field label="Additional details in your own words" value={draft.fields.additionalDetails} onChange={(value) => changeField('additionalDetails', value)} placeholder="Optional · add context that is not already listed above" multiline rows={4} maxLength={8000} hint="This text is marked as your wording and is not linked to an evidence source." />
            </div>
          </section>

          <section className={styles.editorCard} aria-labelledby="request-heading">
            <div className={styles.cardHeading}><span className={styles.cardNumber}>C</span><div><h3 id="request-heading">{selectedType.requestHeading}</h3><p>State the action or response you want in your own words.</p></div></div>
            <div className={styles.stackFields}>
              <Field label="Request section heading" value={draft.fields.requestHeading} onChange={(value) => changeField('requestHeading', value)} placeholder={selectedType.requestHeading} required />
            <Field label={selectedType.requestLabel} value={draft.fields.requestedAction} onChange={(value) => changeField('requestedAction', value)} placeholder="Describe what you are asking for" required multiline rows={3} maxLength={5000} />
            </div>
            <div className={styles.formGridCompact}>
              <Field label="Closing" value={draft.fields.closing} onChange={(value) => changeField('closing', value)} placeholder="Sincerely," />
              <Field label="Signature name" value={draft.fields.signature} onChange={(value) => changeField('signature', value)} placeholder="Name to sign with" required />
            </div>
          </section>

          <details className={styles.legalCard}>
            <summary><span><span className={styles.sectionKicker}>OPTIONAL</span><strong>Add legal wording you already have</strong></span><span className={styles.legalSummaryHint}>No legal provisions are added automatically</span></summary>
            <p className={styles.legalIntro}>Law Sense does not invent or insert legal sections. Legal wording can be exported only when its source matches a verified legal record already saved in this case.</p>
            <div className={styles.stackFields}>
              <Field label="Legal wording · copied or written by you" value={draft.fields.legalText} onChange={(value) => changeField('legalText', value)} placeholder="Optional · leave empty to use no legal wording" multiline rows={4} maxLength={6000} />
              {draft.fields.legalText.trim() && (
                <div className={styles.formGrid}>
                  <Field label="Source title or reference" value={draft.fields.legalSourceLabel} onChange={(value) => changeField('legalSourceLabel', value)} placeholder="Use the title or reference of a verified case source" required hint="A source link by itself does not count as verification." />
                  <Field label="Source link" value={draft.fields.legalSourceUrl} onChange={(value) => changeField('legalSourceUrl', value)} placeholder="https://…" hint="Optional · only a valid web link will be clickable in the preview." />
                </div>
              )}
            </div>
            {safeLegalSources.length > 0 && (
              <div className={styles.availableSources}>
                <p>Sources already recorded in this case · not inserted into your draft</p>
                {safeLegalSources.map(({ record, url }) => (
                  <a key={record.id} href={url!} target="_blank" rel="noreferrer">{record.title}<span>{record.jurisdictionLabel || record.jurisdiction || 'Jurisdiction not recorded'}</span></a>
                ))}
              </div>
            )}
          </details>

          {unknownItems.length > 0 && (
            <section className={styles.unknownCard} aria-labelledby="unknown-heading">
              <div className={styles.unknownHeading}><CircleHelp size={16} aria-hidden="true" /><h3 id="unknown-heading">Unknowns kept out of this draft</h3></div>
              <p>These items remain unresolved in the case record and are not inserted as facts.</p>
              <ul>{unknownItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </section>
          )}
        </section>

        <aside className={styles.previewColumn} aria-label="Draft preview and review">
          <div className={styles.previewHeading}>
            <div><span className={styles.sectionKicker}>LIVE PREVIEW</span><h2>{selectedType.title}</h2></div>
            <span className={styles.previewPage}>A4 · Portrait</span>
          </div>
          <article ref={paperRef} className={styles.paper} aria-label="Live document preview">
            <div className={styles.paperTopline}>
              <span className={styles.paperBrand}>LAW SENSE <i>·</i> DOCUMENT STUDIO</span>
              <span className={styles.paperStatus}>{draft.hasUserEdited ? 'User edited' : 'Generated draft'}</span>
            </div>
            <div className={styles.paperStatusLine}>Not professionally reviewed</div>
            <pre className={styles.documentText}>{previewText.replace(/^LAW SENSE · DOCUMENT STUDIO\nStatus: .*?\nDocument type: .*?\n\n/, '')}</pre>
            <div className={styles.paperFooter}><span>Prepared in Law Sense</span><span>Review every detail before use</span></div>
          </article>

          <section className={`${styles.reviewCard} ${unresolved.length ? styles.reviewNeedsWork : styles.reviewReady}`} aria-labelledby="review-heading">
            <div className={styles.reviewTitleRow}>
              <span className={styles.reviewIcon}>{unresolved.length ? <CircleHelp size={17} /> : <Sparkles size={17} />}</span>
              <div><span className={styles.sectionKicker}>03 · FINAL CHECK</span><h2 id="review-heading">{unresolved.length ? `${unresolved.length} item${unresolved.length === 1 ? '' : 's'} to review` : 'Ready for your review'}</h2></div>
            </div>
            {unresolved.length > 0 ? (
              <div className={styles.unresolvedList}>
                <p>These fields are still missing. They will remain marked in the downloaded draft.</p>
                <ul>{unresolved.map((item) => <li key={item}><span />{item}</li>)}</ul>
                {!draft.reviewConfirmed && !draftIsStale && (
                  <label className={styles.acknowledge}>
                    <input
                      type="checkbox"
                      checked={draft.unresolvedAcknowledged}
                      onChange={(event) => setDraft((current) => current ? { ...current, unresolvedAcknowledged: event.target.checked } : current)}
                    />
                    <span>I reviewed these unresolved fields and want to keep the placeholders.</span>
                  </label>
                )}
              </div>
            ) : (
              <p className={styles.reviewCopy}>Check the preview, selected case facts, and source notes. The draft is saved only in this browser.</p>
            )}
            <div className={styles.reviewActions}>
              {!draft.reviewConfirmed || draftIsStale ? (
                <button type="button" className={styles.primaryButton} onClick={confirmReview} disabled={draftIsStale || verifiedLegalSourceMissing || (unresolved.length > 0 && !draft.unresolvedAcknowledged)}>
                  <ShieldCheck size={15} aria-hidden="true" /> I reviewed this draft
                </button>
              ) : (
                <div className={styles.reviewComplete} role="status"><CheckCircle2 size={16} aria-hidden="true" /> Reviewed by you · export unlocked</div>
              )}
              <div className={styles.exportButtons}>
                <button type="button" onClick={downloadDraft} disabled={!draft.reviewConfirmed || draftIsStale} className={styles.exportButton}>
                  <ArrowDownToLine size={15} aria-hidden="true" /> Download .txt
                </button>
                <button type="button" onClick={printDraft} disabled={!draft.reviewConfirmed || draftIsStale} className={styles.exportButtonSecondary}>
                  <Printer size={15} aria-hidden="true" /> Print / save PDF
                </button>
              </div>
            </div>
            <p className={styles.reviewDisclaimer}>Generated draft · {draft.hasUserEdited ? 'User edited · ' : ''}Not professionally reviewed</p>
          </section>

          <section className={styles.provenanceCard} aria-labelledby="provenance-heading">
            <h3 id="provenance-heading"><Link2 size={15} aria-hidden="true" /> Sources in this preview</h3>
            {selectedFacts.length > 0 ? (
              <ol>{selectedFacts.map((fact, index) => (
                <li key={fact.id}><span className={styles.sourceMarker}>S{index + 1}</span><div><strong>{fact.label}</strong><p><FactStatus status={fact.status} /> {fact.sourceNotes.join(' · ') || 'Source link not recorded.'}</p></div></li>
              ))}</ol>
            ) : <p>No case facts selected. Details you type yourself remain your wording.</p>}
            {draft.fields.legalText.trim() && <div className={styles.legalProvenance}><span className={styles.sourceMarker}>L1</span><p><strong>User-supplied legal wording</strong><br />{draft.fields.legalSourceLabel.trim() || 'Source not supplied'}{safeSourceUrl(draft.fields.legalSourceUrl) && <> · <a href={safeSourceUrl(draft.fields.legalSourceUrl)!} target="_blank" rel="noreferrer">Open source</a></>}</p></div>}
          </section>
          <p className={styles.reviewNote}><ShieldCheck size={14} aria-hidden="true" /> This is a generated draft. No professional review is recorded.</p>
        </aside>
      </div>
      <DocumentPackagePanel
        caseId={caseId}
        caseState={caseState}
        draft={activeDraft}
        stale={draftIsStale}
      />
      <span className={styles.srOnly} aria-live="polite">{draftIsStale ? 'The case changed after this draft was prepared. Review and refresh its sources before export.' : draft.reviewConfirmed ? 'Review complete. Download and print are available.' : 'Export is locked until you confirm your review.'}</span>
    </main>
  );
}
