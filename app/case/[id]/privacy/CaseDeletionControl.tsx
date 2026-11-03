'use client';

import { useState } from 'react';
import { AlertTriangle, LoaderCircle, Trash2 } from 'lucide-react';
import { forgetSessionCase } from '@/lib/case-continuity';

type DeleteCaseResponse = {
  status?: string;
  data_records_removed?: boolean;
  uploaded_documents_removed?: boolean;
  cleanup_warning?: string | null;
  detail?: string;
};

export function CaseDeletionControl({ caseId }: { caseId: string }) {
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteCase() {
    if (confirmation !== 'DELETE' || submitting) return;
    const accepted = window.confirm(
      'Permanently delete this case, its saved drafts/packages, and its uploaded evidence from this LawSense installation? This cannot be undone.'
    );
    if (!accepted) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/cases/' + encodeURIComponent(caseId), {
        method: 'DELETE',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          confirmation_phrase: 'DELETE',
          case_id_confirmation: caseId,
        }),
      });
      const payload: DeleteCaseResponse = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'deleted') {
        throw new Error(payload.detail || 'The case could not be deleted. No success has been assumed.');
      }

      forgetSessionCase(caseId);
      if (payload.uploaded_documents_removed === false) {
        window.alert(
          payload.cleanup_warning
          || 'The case record was deleted, but some uploaded document bytes may remain in the local cleanup folder. Review the configured documents folder before sharing or handing off this device.'
        );
      } else {
        window.alert(
          'Case and app-managed records deleted. A minimal hash-only deletion marker is retained to prevent a pending request from restoring this case. This does not guarantee forensic erasure or remove copies exported elsewhere.'
        );
      }
      window.location.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The case could not be deleted.');
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-rose-300/25 bg-[#1b1418] p-5 sm:p-6"
      aria-labelledby="delete-case-heading"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-rose-200/15 bg-rose-200/[0.06] text-rose-200">
          <Trash2 aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="delete-case-heading" className="text-base font-semibold text-rose-100">Permanently delete this case</h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Removes the saved case record, generated drafts and package snapshots, and the uploaded document folder managed by this LawSense installation.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200/15 bg-amber-100/[0.04] p-3.5">
        <p className="flex items-start gap-2 text-sm font-medium text-amber-100">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          This is irreversible.
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-5 text-slate-400">
          <li>Downloaded or exported files, copied material, OS/device backups, and files in other locations are not removed.</li>
          <li>File deletion is not a guarantee of forensic secure erasure.</li>
          <li>A minimal hash-only deletion marker remains to block stale requests from recreating the case; it does not retain the case narrative.</li>
        </ul>
      </div>

      <div className="mt-4">
        <label htmlFor="delete-case-confirmation" className="block text-sm font-medium text-slate-200">
          Type <span className="font-bold tracking-wider text-rose-200">DELETE</span> to enable the permanent deletion button.
        </label>
        <input
          id="delete-case-confirmation"
          type="text"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          placeholder="Type DELETE"
          disabled={submitting}
          className="mt-2 min-h-11 w-full rounded-xl border border-white/[0.12] bg-black/20 px-3 text-sm text-white placeholder:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-200 disabled:opacity-60 sm:max-w-sm"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200/20 bg-rose-200/[0.05] p-3 text-sm leading-5 text-rose-100">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void deleteCase()}
        disabled={confirmation !== 'DELETE' || submitting}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200/20 bg-rose-300/[0.12] px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/[0.18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-200 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
      >
        {submitting && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
        {submitting ? 'Deleting case…' : 'Permanently delete case'}
      </button>
    </section>
  );
}
