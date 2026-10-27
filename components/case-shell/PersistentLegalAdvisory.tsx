'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleHelp, FileText, LoaderCircle, RefreshCw, Scale, ShieldAlert, X } from 'lucide-react';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function firstText(value: JsonRecord, keys: string[], fallback: string): string {
  for (const key of keys) {
    const result = textValue(value[key]);
    if (result) return result;
  }
  return fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PersistentLegalAdvisory({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JsonRecord | null>(null);
  const [legalKnowledgeStatus, setLegalKnowledgeStatus] = useState('');

  const loadAdvisory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/cases/' + encodeURIComponent(caseId) + '/legal-reasoning', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(body) ? textValue(body.detail) : '';
        throw new Error(message || 'The case advisory could not be loaded.');
      }
      if (!isRecord(body) || !isRecord(body.result)) {
        throw new Error('The analysis service returned an unexpected response.');
      }
      setResult(body.result);
      setLegalKnowledgeStatus(textValue(body.legalKnowledgeStatus));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The case advisory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (open) void loadAdvisory();
  }, [open, loadAdvisory]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const statements = rows(result?.groundedLegalStatements);
  const questions = rows(result?.unresolvedQuestions);
  const evidenceGaps = rows(result?.evidenceGaps);
  const conflicts = rows(result?.conflicts);
  const risks = rows(result?.risks);
  const paths = rows(result?.possibleProceduralPaths);
  const blocked = rows(result?.blockedConclusions);
  const jurisdictionStatus = textValue(result?.jurisdictionStatus, 'unknown');
  const uncertainty = isRecord(result?.uncertainty) ? result.uncertainty : {};
  const uncertaintyLevel = textValue(uncertainty.level);
  const needsAttention = questions.length > 0
    || evidenceGaps.length > 0
    || conflicts.length > 0
    || jurisdictionStatus.toLowerCase().includes('unknown')
    || legalKnowledgeStatus === 'unavailable'
    || legalKnowledgeStatus === 'insufficient_or_blocked';
  const advisoryStatus = statements.length === 0
    ? 'No reliable case-specific legal grounding yet'
    : needsAttention
      ? 'Provisional review · important gaps remain'
      : 'Provisional review · applicability still needs checking';

  function openDialog() {
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-label="Open Legal Advisory based on information recorded so far"
        className="fixed bottom-[calc(5.3rem+env(safe-area-inset-bottom))] left-3 z-[65] inline-flex min-h-11 items-center gap-2 rounded-full border border-[#d9bd8c]/35 bg-[#111923]/[0.97] px-4 text-xs font-semibold text-[#f2dfb9] shadow-[0_12px_36px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:border-[#d9bd8c]/60 hover:bg-[#1b2633] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none lg:bottom-5 lg:left-5"
      >
        <Scale aria-hidden="true" className="h-4 w-4" />
        <span>Legal Advisory</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-advisory-title"
            className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0b121b] text-slate-100 shadow-2xl sm:max-h-[88dvh] sm:rounded-3xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.09] bg-[radial-gradient(ellipse_at_80%_0%,rgba(217,189,140,0.12),transparent_55%)] px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d9bd8c]">LawSense · Case review</p>
                <h2 id="legal-advisory-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Legal Advisory</h2>
                <p className="mt-1 text-sm text-slate-400">Based on information recorded so far</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void loadAdvisory()}
                  disabled={loading}
                  aria-label="Refresh legal advisory"
                  className="grid h-10 w-10 place-items-center rounded-xl text-slate-300 hover:bg-white/[0.07] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b]"
                >
                  <RefreshCw aria-hidden="true" className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close legal advisory"
                  className="grid h-10 w-10 place-items-center rounded-xl text-slate-300 hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b]"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-7 sm:py-6">
              <div className="rounded-2xl border border-amber-100/15 bg-amber-100/[0.045] p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-100">
                      {loading ? 'Reviewing the current case record' : result ? advisoryStatus : 'Advisory status not yet established'}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      This is a provisional, source-aware case review—not a determination that a law applies, a prediction of an outcome, or a substitute for qualified legal advice.
                    </p>
                    {uncertaintyLevel && (
                      <p className="mt-2 text-xs text-amber-100/75">Recorded uncertainty level: {humanize(uncertaintyLevel)}. This is not a probability of winning.</p>
                    )}
                  </div>
                </div>
              </div>

              {loading && (
                <div role="status" className="flex items-center gap-3 rounded-2xl border border-white/[0.08] p-4 text-sm text-slate-300">
                  <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
                  Reading the latest case reasoning…
                </div>
              )}

              {error && (
                <div role="alert" className="rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-4 text-sm text-rose-100">
                  <p className="font-semibold">Advisory could not be refreshed</p>
                  <p className="mt-1 leading-6">{error}</p>
                  <button type="button" onClick={() => void loadAdvisory()} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-rose-100/20 px-3 font-semibold hover:bg-rose-100/[0.06]">
                    Try again
                  </button>
                </div>
              )}

              {!loading && !error && result && (
                <>
                  <section className="rounded-2xl border border-white/[0.08] p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      <CircleHelp aria-hidden="true" className="h-4 w-4 text-[#d9bd8c]" />
                      <h3 className="text-sm font-semibold">What the current record says</h3>
                    </div>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-white/[0.035] p-3">
                        <dt className="text-xs text-slate-400">Legal material</dt>
                        <dd className="mt-1 text-sm font-medium text-slate-100">{humanize(legalKnowledgeStatus || textValue(result.legalKnowledgeStatus, 'not established'))}</dd>
                      </div>
                      <div className="rounded-xl bg-white/[0.035] p-3">
                        <dt className="text-xs text-slate-400">Jurisdiction status</dt>
                        <dd className="mt-1 text-sm font-medium text-slate-100">{humanize(jurisdictionStatus)}</dd>
                      </div>
                    </dl>
                    {statements.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">Source-linked legal material to review</h4>
                        {statements.slice(0, 6).map((item, index) => (
                          <article key={textValue(item.id, 'statement-' + index)} className="rounded-xl border border-white/[0.07] p-3">
                            <p className="text-sm font-medium leading-6 text-slate-100">{textValue(item.recordTitle, 'Legal record')}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-300">{textValue(item.text, 'No statement text was provided.')}</p>
                            <p className="mt-2 text-xs leading-5 text-amber-100/70">Candidate legal context only. Confirm the source, current version, jurisdiction and applicability before relying on it.</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-xl border border-dashed border-white/10 p-3 text-sm leading-6 text-slate-300">
                        The current reasoning did not establish a reliable source-linked legal statement for this case. That does not prove that no remedy exists. Confirm the key facts and jurisdiction, then review the case again.
                      </p>
                    )}
                  </section>

                  {(questions.length > 0 || evidenceGaps.length > 0 || conflicts.length > 0) && (
                    <section className="rounded-2xl border border-white/[0.08] p-4 sm:p-5">
                      <h3 className="text-sm font-semibold">What still needs attention</h3>
                      <div className="mt-3 space-y-3">
                        {questions.slice(0, 6).map((item, index) => (
                          <div key={textValue(item.id, 'question-' + index)} className="flex items-start gap-2.5">
                            <CircleHelp aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-amber-200" />
                            <p className="text-sm leading-6 text-slate-300">{firstText(item, ['text'], 'A case question remains unresolved.')}</p>
                          </div>
                        ))}
                        {evidenceGaps.slice(0, 5).map((item, index) => (
                          <div key={textValue(item.id, 'gap-' + index)} className="flex items-start gap-2.5">
                            <FileText aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                            <p className="text-sm leading-6 text-slate-300">{firstText(item, ['description', 'text'], 'An evidence gap remains.')}</p>
                          </div>
                        ))}
                        {conflicts.slice(0, 5).map((item, index) => (
                          <div key={textValue(item.id, 'conflict-' + index)} className="flex items-start gap-2.5">
                            <AlertTriangle aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-rose-200" />
                            <p className="text-sm leading-6 text-slate-300">{firstText(item, ['description', 'text'], 'A case conflict remains unresolved.')}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {risks.length > 0 && (
                    <section className="rounded-2xl border border-amber-100/15 p-4 sm:p-5">
                      <div className="flex items-center gap-2">
                        <ShieldAlert aria-hidden="true" className="h-4 w-4 text-amber-200" />
                        <h3 className="text-sm font-semibold">Risks or limitations recorded</h3>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {risks.slice(0, 6).map((item, index) => (
                          <li key={textValue(item.id, 'risk-' + index)} className="text-sm leading-6 text-slate-300">
                            <span className="font-semibold text-amber-100">{textValue(item.severity, 'Review')} · </span>
                            {firstText(item, ['description', 'text'], 'A risk was recorded without a description.')}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {paths.length > 0 && (
                    <section className="rounded-2xl border border-white/[0.08] p-4 sm:p-5">
                      <h3 className="text-sm font-semibold">Possible procedural paths</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-400">These are candidate paths from the supplied records; availability and suitability are not established.</p>
                      <div className="mt-3 space-y-3">
                        {paths.slice(0, 4).map((item, index) => (
                          <article key={textValue(item.id, 'path-' + index)} className="rounded-xl bg-white/[0.035] p-3">
                            <p className="text-sm font-semibold text-slate-100">{firstText(item, ['title'], 'Possible route to review')}</p>
                            <p className="mt-1 text-xs text-slate-400">Status: {humanize(textValue(item.status, 'verification required'))}</p>
                            {stringList(item.steps).length > 0 && (
                              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-300">
                                {stringList(item.steps).slice(0, 5).map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}
                              </ol>
                            )}
                            {stringList(item.blockedReasonCodes).length > 0 && (
                              <p className="mt-2 text-xs leading-5 text-amber-100/75">Open blockers: {stringList(item.blockedReasonCodes).map(humanize).join(', ')}</p>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  {blocked.length > 0 && (
                    <section className="rounded-2xl border border-white/[0.08] p-4 sm:p-5">
                      <h3 className="text-sm font-semibold">Conclusions deliberately withheld</h3>
                      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
                        {blocked.slice(0, 6).map((item, index) => <li key={textValue(item.id, 'blocked-' + index)}>{firstText(item, ['explanation'], 'The current record does not support a reliable conclusion.')}</li>)}
                      </ul>
                    </section>
                  )}

                  {questions.length === 0 && evidenceGaps.length === 0 && conflicts.length === 0 && (
                    <p className="rounded-2xl border border-white/[0.08] p-4 text-sm leading-6 text-slate-300">
                      No unresolved questions, evidence gaps, or conflicts were returned by this analysis. This is not proof that the case is complete or that a legal outcome is certain.
                    </p>
                  )}
                </>
              )}

              {!loading && !error && !result && (
                <p className="rounded-2xl border border-white/[0.08] p-4 text-sm leading-6 text-slate-300">Open this advisory after a case has been created. The review is generated from the current saved case record.</p>
              )}
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-white/[0.09] px-4 py-3 sm:px-7">
              <Link href={'/case/' + encodeURIComponent(caseId) + '/guide'} onClick={() => setOpen(false)} className="inline-flex min-h-10 items-center rounded-xl bg-[#d9bd8c] px-4 text-sm font-semibold text-[#171a1e] hover:bg-[#ead5ac]">
                Open Guide
              </Link>
              <Link href={'/case/' + encodeURIComponent(caseId) + '/documents'} onClick={() => setOpen(false)} className="inline-flex min-h-10 items-center rounded-xl border border-white/[0.1] px-4 text-sm font-semibold text-slate-200 hover:bg-white/[0.05]">
                Review evidence
              </Link>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto inline-flex min-h-10 items-center rounded-xl px-3 text-sm text-slate-400 hover:bg-white/[0.05] hover:text-white">
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
