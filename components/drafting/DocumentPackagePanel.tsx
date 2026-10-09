'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, FileStack, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  confirmDocumentPackage,
  createDocumentPackage,
  exportDocumentPackage,
  type CaseState,
  type CompiledDocumentDraft,
  type CompiledDocumentPackage,
  type ExportReadyPackage,
} from '@/lib/api';
import type { DraftState } from './types';

const styles = new Proxy<Record<string, string>>({} as Record<string, string>, {
  get: (_target, property) => typeof property === 'string' ? `lsd-${property}` : undefined,
});

const TEMPLATE_IDS = [
  'formal-demand-representation',
  'complaint-draft',
  'grievance-application',
  'notice-response',
  'supporting-statement-chronology',
  'evidence-index',
  'filing-checklist',
];

function sourceFactIds(draft: DraftState): string[] {
  return draft.includedFactIds.map((id) => {
    if (id === 'initial-statement') return id;
    if (id.startsWith('fact:')) return id.slice('fact:'.length);
    return id;
  });
}

function makeFieldValues(
  draft: DraftState,
): Record<string, Record<string, string>> {
  const additionalContext = draft.fields.additionalDetails.trim();
  const letter: Record<string, string> = {
    sender_name: draft.fields.sender,
    sender_contact: draft.fields.senderContact,
    recipient_name: draft.fields.recipient,
    recipient_address: draft.fields.recipientAddress,
    document_date: draft.fields.date,
    subject: draft.fields.subject,
    requested_action: draft.fields.requestedAction,
    signature_name: draft.fields.signature,
  };
  if (additionalContext) letter.additional_context = additionalContext;
  if (draft.fields.legalText.trim()) letter.legal_text = draft.fields.legalText;

  const values: Record<string, Record<string, string>> = {
    'formal-demand-representation': { ...letter },
    'complaint-draft': { ...letter },
    'grievance-application': { ...letter },
    'notice-response': {
      sender_name: draft.fields.sender,
      recipient_name: draft.fields.recipient,
      document_date: draft.fields.date,
      notice_reference: draft.fields.noticeReference,
      notice_date: draft.fields.noticeDate,
      notice_details: draft.fields.noticeDetails,
      ...(additionalContext ? { additional_context: additionalContext } : {}),
      response_position: draft.fields.responsePosition,
      requested_action: draft.fields.requestedAction,
      signature_name: draft.fields.signature,
      ...(draft.fields.legalText.trim() ? { legal_text: draft.fields.legalText } : {}),
    },
    'supporting-statement-chronology': {
      declarant_name: draft.fields.sender,
      ...(additionalContext ? { additional_context: additionalContext } : {}),
    },
    'evidence-index': {},
    'filing-checklist': {},
  };
  return values;
}

function getVerifiedLegalSourceId(caseState: CaseState, label: string, sourceUrl: string): string | null {
  const wanted = label.trim().toLocaleLowerCase();
  const wantedUrl = sourceUrl.trim();
  if (!wanted && !wantedUrl) return null;
  const match = caseState.analysis?.legalKnowledge.records.find((record) => {
    const matchesReference = record.title.trim().toLocaleLowerCase() === wanted
      || (record.reference ?? '').trim().toLocaleLowerCase() === wanted;
    const matchesUrl = Boolean(wantedUrl)
      && (record.sourceUrl === wantedUrl || record.provenance.some((item) => item.sourceUrl === wantedUrl));
    return (matchesReference || matchesUrl)
      && record.status === 'verified'
      && (!record.sourceVerificationStatus || record.sourceVerificationStatus === 'verified')
      && Boolean(record.sourceUrl || record.provenance.some((item) => item.sourceUrl));
  });
  return match?.id ?? null;
}

function getDraftPackageSignature(draft: DraftState): string {
  return JSON.stringify({
    fields: draft.fields,
    includedFactIds: draft.includedFactIds,
    factEdits: draft.factEdits,
  });
}

function describeDocument(document: CompiledDocumentDraft): string[] {
  return [
    ...document.missingInformation.map((item) => `Missing: ${item}`),
    ...document.unsupportedMaterialFactIds.map((item) => `Unsupported material fact: ${document.fields[item]?.label ?? item}`),
    ...document.conflicts.map((item) => `Conflict: ${item.summary}`),
  ];
}

export function DocumentPackagePanel({
  caseId,
  caseState,
  draft,
  stale,
}: {
  caseId: string;
  caseState: CaseState;
  draft: DraftState;
  stale: boolean;
}) {
  const [packageState, setPackageState] = useState<CompiledDocumentPackage | null>(null);
  const [packageSignature, setPackageSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [missingAcknowledged, setMissingAcknowledged] = useState(false);
  const [exportBlockers, setExportBlockers] = useState<string[]>([]);

  const currentSignature = useMemo(() => getDraftPackageSignature(draft), [draft]);
  const packageIsOutdated = Boolean(packageState && (stale || packageSignature !== currentSignature));
  const needsMissingAcknowledgement = Boolean(packageState?.documents.some((item) => item.missingInformation.length > 0));
  const allReviewed = Boolean(packageState?.documents.length)
    && packageState!.documents.every((item) => item.reviewState === 'reviewed');

  async function compilePackage() {
    setBusy(true);
    setError('');
    setNotice('');
    setExportBlockers([]);
    setReviewAcknowledged(false);
    setMissingAcknowledged(false);
    try {
      const fieldValuesByTemplate = makeFieldValues(draft);
      const legalSourceIdsByTemplate: Record<string, Record<string, string>> = {};
      if (draft.fields.legalText.trim()) {
        const sourceId = getVerifiedLegalSourceId(caseState, draft.fields.legalSourceLabel, draft.fields.legalSourceUrl);
        if (!sourceId) {
          throw new Error('Select a verified legal source already recorded in this case, or remove the legal wording before compiling the package.');
        }
        for (const templateId of TEMPLATE_IDS) {
          if (fieldValuesByTemplate[templateId]?.legal_text) {
            legalSourceIdsByTemplate[templateId] = { legal_text: sourceId };
          }
        }
      }
      const includedFactIds = sourceFactIds(draft);
      const includedFactIdsByTemplate = Object.fromEntries(
        TEMPLATE_IDS.map((templateId) => [templateId, includedFactIds]),
      );
      const selectedFactEdits: Record<string, string> = {};
      const includedFactIdSet = new Set(includedFactIds);
      for (const [id, value] of Object.entries(draft.factEdits)) {
        const caseFactId = id.startsWith('fact:') ? id.slice('fact:'.length) : id;
        if (includedFactIdSet.has(caseFactId)) selectedFactEdits[caseFactId] = value;
      }
      const factEditsByTemplate = Object.fromEntries(
        TEMPLATE_IDS.map((templateId) => [templateId, selectedFactEdits]),
      );
      const nextPackage = await createDocumentPackage(caseId, {
        templateIds: TEMPLATE_IDS,
        fieldValuesByTemplate,
        legalSourceIdsByTemplate,
        includedFactIdsByTemplate,
        factEditsByTemplate,
      });
      setPackageState(nextPackage);
      setPackageSignature(currentSignature);
      setNotice('Package compiled from the selected case facts and current draft fields. Review every document and its source notes below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The document package could not be compiled.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPackage() {
    if (!packageState || packageIsOutdated || !reviewAcknowledged) return;
    setBusy(true);
    setError('');
    setNotice('');
    setExportBlockers([]);
    try {
      const updated = await confirmDocumentPackage(caseId, packageState.id, missingAcknowledged);
      setPackageState(updated);
      setNotice('Your review is recorded for each document. Export still checks for unresolved conflicts and unsupported material facts.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your document review could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function exportPackage() {
    if (!packageState || packageIsOutdated || !allReviewed) return;
    setBusy(true);
    setError('');
    setNotice('');
    setExportBlockers([]);
    try {
      const result: ExportReadyPackage = await exportDocumentPackage(caseId, packageState.id);
      if (result.status !== 'ready') {
        setExportBlockers(result.blockers);
        setNotice('Export is blocked by unresolved items listed below.');
        return;
      }
      const content = result.documents.map((document) =>
        `\n${'='.repeat(72)}\n${document.filename}\n${'='.repeat(72)}\n\n${document.content}`,
      ).join('\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `law-sense-document-package-${caseId}.txt`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('The reviewed package was exported as a text file.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The document package could not be exported.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.packageSection} aria-labelledby="document-package-heading">
      <div className={styles.packageHeader}>
        <div className={styles.packageIcon}><FileStack size={18} aria-hidden="true" /></div>
        <div>
          <p className={styles.sectionKicker}>EVIDENCE-TO-DOCUMENT COMPILER</p>
          <h2 id="document-package-heading">Build a seven-document package</h2>
          <p>Uses your selected facts and this draft. Conflicts and missing sources stay visible; legal wording needs a verified source in the case.</p>
        </div>
      </div>
      {stale && <p className={styles.packageWarning} role="alert">This draft uses an older case snapshot. Review and refresh its sources before compiling a package.</p>}
      <button type="button" onClick={() => void compilePackage()} disabled={busy || stale} className={styles.packageButton}>
        {busy ? <LoaderCircle size={15} className={styles.packageSpinner} aria-hidden="true" /> : <FileStack size={15} aria-hidden="true" />}
        {packageState ? 'Compile package from current draft' : 'Compile document package'}
      </button>
      {notice && <p className={styles.packageNotice} role="status">{notice}</p>}
      {error && <p className={styles.packageError} role="alert">{error}</p>}

      {packageState && (
        <div className={styles.packageResult}>
          {packageIsOutdated && (
            <p className={styles.packageWarning} role="alert">The case or document fields changed after this package was compiled. Recompile before review or export.</p>
          )}
          <div className={styles.packageDocumentList}>
            {packageState.documents.map((document) => {
              const issues = describeDocument(document);
              return (
                <details key={document.id} className={styles.packageDocument}>
                  <summary>
                    <span className={styles.packageDocumentTitle}>{document.title}</span>
                    <span className={styles.packageDocumentMeta}>
                      {document.reviewState === 'reviewed' ? 'Reviewed' : document.reviewState === 'stale' ? 'Stale' : 'Draft'}
                      {issues.length ? ` · ${issues.length} review item${issues.length === 1 ? '' : 's'}` : ''}
                    </span>
                  </summary>
                  {issues.length > 0 && <ul className={styles.packageIssueList}>{issues.map((item, index) => <li key={`${document.id}-${index}`}>{item}</li>)}</ul>}
                  <pre className={styles.packagePreview}>{document.content}</pre>
                </details>
              );
            })}
          </div>

          {!allReviewed && !packageIsOutdated && (
            <div className={styles.packageReviewBox}>
              <label className={styles.packageAcknowledge}>
                <input type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} />
                <span>I reviewed the contents and source notes of every document in this package.</span>
              </label>
              {needsMissingAcknowledgement && (
                <label className={styles.packageAcknowledge}>
                  <input type="checkbox" checked={missingAcknowledged} onChange={(event) => setMissingAcknowledged(event.target.checked)} />
                  <span>I reviewed the missing-information markers and want to keep them in the draft package.</span>
                </label>
              )}
              <button type="button" onClick={() => void confirmPackage()} disabled={busy || !reviewAcknowledged || (needsMissingAcknowledgement && !missingAcknowledged)} className={styles.packageConfirm}>
                <ShieldCheck size={15} aria-hidden="true" /> Confirm review of all seven documents
              </button>
            </div>
          )}

          {allReviewed && !packageIsOutdated && (
            <div className={styles.packageExportRow}>
              <p><CheckCircle2 size={15} aria-hidden="true" /> Review recorded · export checks are running before download.</p>
              <button type="button" onClick={() => void exportPackage()} disabled={busy} className={styles.packageButton}>
                <ArrowDownToLine size={15} aria-hidden="true" /> Export package .txt
              </button>
            </div>
          )}
          {exportBlockers.length > 0 && <ul className={styles.packageBlockers} role="alert">{exportBlockers.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}

