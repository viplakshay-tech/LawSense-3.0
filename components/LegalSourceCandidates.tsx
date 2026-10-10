'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpenText,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  ExternalLink,
  Landmark,
  LoaderCircle,
  MapPin,
  Network,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import {
  getIndiaCodeActs,
  getIndiaCodeProvision,
  searchIndiaCode,
  type CaseFact,
  type CaseState,
  type IndiaCodeAct,
  type IndiaCodeProvisionResponse,
  type IndiaCodeSearchResponse,
  type LegalIssue,
  type LegalKnowledgeRecordSummary,
  type LegalMatchSummary,
  type LegalSupportResourceSummary,
} from '@/lib/api';
import { CaseContextLink } from '@/components/case-shell/CaseContextLink';

type LegalSourceCandidatesProps = {
  caseData: CaseState;
  records: LegalKnowledgeRecordSummary[];
  variant?: 'light' | 'dark';
  title?: string;
};

type GroundingStep = 'case-info' | 'issue' | 'source' | 'jurisdiction' | 'applicability' | 'procedure';

function humanize(value: string | null | undefined, fallback = 'Unknown'): string {
  if (!value?.trim()) return fallback;
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value supplied';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No value supplied';
  try {
    return JSON.stringify(value) ?? 'Value could not be displayed';
  } catch {
    return 'Value could not be displayed';
  }
}

function recordedLocation(caseData: CaseState): string | null {
  const values = [
    caseData.jurisdiction.locationText,
    caseData.jurisdiction.city,
    caseData.jurisdiction.district,
    caseData.jurisdiction.state,
    caseData.jurisdiction.country,
  ].filter((value): value is string => Boolean(value?.trim()));
  return values.length ? [...new Set(values)].join(', ') : null;
}

function geographicScopeNote(record: LegalKnowledgeRecordSummary, location: string | null): string {
  switch (record.jurisdictionMatchStatus) {
    case 'mismatch':
      return `Geographic scope mismatch: recorded case location ${location || 'not established'}; source scope ${record.jurisdictionLabel || humanize(record.jurisdiction)}.`;
    case 'matched':
      return 'The recorded geographic scope matches at the levels provided; legal applicability is still not established.';
    case 'source_jurisdiction_unmapped':
      return 'The source jurisdiction could not be resolved in the local jurisdiction catalog.';
    default:
      return 'Case jurisdiction is not established, so geographic fit cannot be checked.';
  }
}

function twinHref(caseId: string, nodeId: string): string {
  return `/case/${encodeURIComponent(caseId)}/twin?focus=${encodeURIComponent(nodeId)}`;
}

function documentHref(caseId: string, documentId: string): string {
  return `/case/${encodeURIComponent(caseId)}/documents?documentId=${encodeURIComponent(documentId)}#document-preview`;
}

function registeredSourceUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sourceProvenanceIds(record: LegalKnowledgeRecordSummary): Set<string> {
  return new Set([
    record.id,
    ...record.provenance.flatMap((item) => [item.sourceId, item.provisionId ?? '']),
  ].filter(Boolean));
}

function factsFromSameSource(record: LegalKnowledgeRecordSummary, facts: CaseFact[]): CaseFact[] {
  const sourceIds = sourceProvenanceIds(record);
  const documentIds = new Set(record.provenance.flatMap((item) => item.documentId ? [item.documentId] : []));
  if (!sourceIds.size && !documentIds.size) return [];
  return facts.filter((fact) =>
    fact.sourceIds.some((sourceId) => sourceIds.has(sourceId)) ||
    fact.provenance.some((item) => documentIds.has(item.documentId)),
  );
}

function relatedEvidence(record: LegalKnowledgeRecordSummary, caseData: CaseState) {
  const sourceIds = sourceProvenanceIds(record);
  const documentIds = new Set(record.provenance.flatMap((item) => item.documentId ? [item.documentId] : []));
  return caseData.evidence.filter((item) =>
    sourceIds.has(item.id) ||
    Boolean(item.documentId && documentIds.has(item.documentId)),
  );
}

function sourceVerificationLabel(record: LegalKnowledgeRecordSummary): string {
  const value = record.sourceVerificationStatus?.trim();
  if (!value) return 'Verification unknown';
  if (['verification_required', 'unverified', 'pending', 'not_verified'].includes(value.toLocaleLowerCase())) {
    return 'Verification required';
  }
  return humanize(value);
}

function applicabilityDescription(record: LegalKnowledgeRecordSummary): string {
  const value = record.sourceApplicabilityStatus?.trim();
  if (!value) {
    return 'Applicability is unknown because no status was returned. This source is relevant, but applicability is not established.';
  }
  const normalized = value.toLocaleLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'applicable') {
    return 'The source record returns “Applicable” as its status. This metadata is separate from retrieval and should be reviewed with jurisdiction and verification.';
  }
  if (normalized === 'not applicable') {
    return 'The source record returns “Not applicable” as its status. This metadata is separate from retrieval and should be reviewed in context.';
  }
  return `Applicability status returned · ${humanize(value)}. Retrieval alone does not establish applicability.`;
}

function statusTone(value: string | null | undefined): string {
  const normalized = value?.toLocaleLowerCase() ?? '';
  if (normalized === 'verified' || normalized === 'matched' || normalized === 'fresh') {
    return 'border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100';
  }
  if (normalized.includes('required') || normalized === 'mismatch' || normalized === 'stale' || normalized === 'expired') {
    return 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100';
  }
  return 'border-white/10 bg-white/[0.035] text-slate-300';
}

function issueLabel(issue: LegalIssue): string {
  return humanize(issue.subcategory ? `${issue.category} · ${issue.subcategory}` : issue.category);
}

function LinkedFact({ fact, caseId, dark }: { fact: CaseFact; caseId: string; dark: boolean }) {
  const tone = dark ? 'text-cyan-100 hover:text-white' : 'text-cyan-800 hover:text-cyan-950 dark:text-cyan-200';
  return (
    <a
      href={twinHref(caseId, `claim:fact:${fact.id}`)}
      className={`group inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] px-2.5 py-2 text-left text-[11px] transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 ${tone}`}
    >
      <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block font-semibold">{humanize(fact.key)}</span>
        <span className="block max-w-64 truncate opacity-75">{displayValue(fact.value)}</span>
      </span>
      <ArrowUpRight aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

function objectItems(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).items)) return [];
  return ((value as Record<string, unknown>).items as unknown[]).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
}

function textItems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).items)) return [];
  return ((value as Record<string, unknown>).items as unknown[]).filter((item): item is string => typeof item === 'string');
}

function MatchGuidance({ matches, resources, dark }: {
  matches: LegalMatchSummary[];
  resources: LegalSupportResourceSummary[];
  dark: boolean;
}) {
  const tone = dark ? 'border-white/10 bg-white/[0.025]' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50';
  const heading = dark ? 'text-slate-100' : 'text-zinc-900 dark:text-zinc-100';
  const muted = dark ? 'text-slate-400' : 'text-zinc-600 dark:text-zinc-400';
  const badge = (assessment: string) => assessment === 'supported'
    ? 'border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100'
    : assessment === 'plausible'
      ? 'border-sky-300/20 bg-sky-300/[0.07] text-sky-100'
      : 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100';

  return (
    <section aria-label="Law guidance from recorded facts and sources" className="space-y-3">
      <div>
        <h4 className={`text-sm font-semibold ${heading}`}>Law candidates and next-step sources</h4>
        <p className={`mt-1 text-[11px] leading-5 ${muted}`}>Candidates are matched to recorded issue categories and facts. They are not findings that a law applies. No numeric score or cutoff is used.</p>
      </div>
      {matches.length ? matches.map((match) => {
        const authorities = objectItems(match.competentAuthority);
        const procedures = objectItems(match.procedures);
        const docs = textItems(match.requiredDocuments);
        const deadlines = objectItems(match.verifiedDeadlines);
        const filingLinks = objectItems(match.officialFilingLinks);
        return (
          <article id={`law-candidate-${match.candidateId}`} key={match.candidateId} className={`rounded-xl border p-3 sm:p-4 ${tone}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h5 className={`text-xs font-semibold ${heading}`}>{match.actTitle} · {match.provisionTitle}</h5>
                <p className={`mt-1 text-[10px] ${muted}`}>{match.provisionReference || 'Provision reference not returned'} · {match.actVersion || 'version not specified'}{match.effectiveFrom ? ` · effective from ${match.effectiveFrom}` : ''}</p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase ${badge(match.evidenceAssessment)}`}>{match.evidenceAssessment}</span>
            </div>
            <p className={`mt-2 text-[11px] leading-5 ${heading}`}>{match.whyItMayApply}</p>
            <ul className={`mt-2 space-y-1 text-[10px] leading-5 ${muted}`}>
              {match.assessmentRationale.slice(0, 4).map((item, index) => <li key={`${match.candidateId}-reason-${index}`}>· {item}</li>)}
            </ul>
            {match.supportingFacts.length > 0 && (
              <div className="mt-3">
                <p className={`text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Relevant recorded details</p>
                <ul className={`mt-1 space-y-1 text-[10px] leading-5 ${heading}`}>
                  {match.supportingFacts.slice(0, 4).map((fact, index) => <li key={`${fact.sourceId}-${index}`}>· {fact.text} <span className={muted}>({fact.status.replaceAll('_', ' ')})</span></li>)}
                </ul>
              </div>
            )}
            {match.conflictingEvidence.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-2.5">
                <p className="text-[10px] font-semibold text-amber-100">Conflicting information to resolve</p>
                <ul className="mt-1 space-y-1 text-[10px] leading-5 text-amber-50/90">{match.conflictingEvidence.slice(0, 3).map((item, index) => <li key={`${index}-${item}`}>· {item}</li>)}</ul>
              </div>
            )}
            {(match.clarifyingQuestions.length > 0) && (
              <div className="mt-3">
                <p className={`text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Material details that could change this guidance</p>
                <ul className={`mt-1 space-y-1 text-[10px] leading-5 ${heading}`}>{match.clarifyingQuestions.slice(0, 3).map((question) => <li key={question}>· {question}</li>)}</ul>
              </div>
            )}
            <div className="mt-3 grid gap-3 border-t border-current/10 pt-3 sm:grid-cols-2">
              <div>
                <p className={`text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Jurisdiction and dates</p>
                <p className={`mt-1 text-[10px] leading-5 ${heading}`}>{String(match.jurisdiction.label ?? 'Jurisdiction unknown')} · {String(match.jurisdiction.matchStatus ?? 'territorial fit unknown')}</p>
                <p className={`mt-1 text-[10px] leading-5 ${muted}`}>{match.temporalLimitation}</p>
              </div>
              <div>
                <p className={`text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Authority and process</p>
                {authorities.length ? authorities.map((authority, index) => <p key={`${match.candidateId}-authority-${index}`} className={`mt-1 text-[10px] leading-5 ${heading}`}>{String(authority.name ?? 'Authority not named')} · {String(authority.verificationStatus ?? 'unverified')}</p>) : <p className={`mt-1 text-[10px] ${muted}`}>Competent authority not found in linked procedure records.</p>}
                {procedures.length ? procedures.map((procedure, index) => (
                  <div key={`${match.candidateId}-procedure-${index}`} className={`mt-2 text-[10px] leading-5 ${heading}`}>
                    <p className="font-semibold">{String(procedure.title ?? 'Procedure record')} · {String(procedure.verificationStatus ?? 'unverified')}</p>
                    {Array.isArray(procedure.steps) && procedure.steps.map((step, stepIndex) => <p key={stepIndex}>· {typeof step === 'string' ? step : JSON.stringify(step)}</p>)}
                  </div>
                )) : <p className={`mt-1 text-[10px] ${muted}`}>Procedure not found in linked records.</p>}
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className={`text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Documents and verified deadlines</p>
                {docs.length ? <ul className={`mt-1 text-[10px] leading-5 ${heading}`}>{docs.map((doc) => <li key={doc}>· {doc}</li>)}</ul> : <p className={`mt-1 text-[10px] ${muted}`}>Required documents not recorded in linked procedure records.</p>}
                {deadlines.length ? deadlines.map((item, index) => <p key={index} className={`mt-1 text-[10px] leading-5 ${heading}`}>Deadline: {String(item.text ?? 'date not returned')} · source-backed</p>) : <p className={`mt-1 text-[10px] ${muted}`}>No verified deadline was found in linked procedure records.</p>}
              </div>
              <div>
                <p className={`text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Verified procedure links</p>
                {filingLinks.length ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {filingLinks.map((link, index) => {
                      const safeUrl = registeredSourceUrl(typeof link.url === 'string' ? link.url : null);
                      return safeUrl ? <a key={`${match.candidateId}-procedure-link-${index}`} href={safeUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-sky-300/20 px-2 text-[10px] font-semibold text-sky-100 hover:bg-sky-200/[0.07]">{String(link.title ?? 'Open verified procedure source')}<ExternalLink aria-hidden="true" className="h-3 w-3" /></a> : null;
                    })}
                  </div>
                ) : <p className={`mt-1 text-[10px] ${muted}`}>No verified procedure or filing link was found in the linked records.</p>}
                <p className={`mt-3 text-[9px] font-semibold uppercase tracking-wide ${muted}`}>Official legal publications</p>
                {match.officialSourceLinks.length ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {match.officialSourceLinks.map((link, index) => {
                      const safeUrl = registeredSourceUrl(link.url);
                      return safeUrl ? <a key={`${match.candidateId}-source-link-${index}`} href={safeUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-emerald-300/20 px-2 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-200/[0.07]">{link.title} · check law text<ExternalLink aria-hidden="true" className="h-3 w-3" /></a> : null;
                    })}
                  </div>
                ) : <p className={`mt-1 text-[10px] ${muted}`}>No verified official legal publication link is recorded.</p>}
              </div>
            </div>
            <p className={`mt-3 text-[9px] leading-4 ${muted}`}>{match.notice}</p>
          </article>
        );
      }) : <p className={`rounded-lg border border-dashed p-3 text-[10px] leading-5 ${muted}`}>No issue-linked provision candidates are recorded yet. An empty local catalog does not mean no law applies.</p>}
      {resources.length > 0 && (
        <div className={`rounded-xl border p-3 ${tone}`}>
          <p className={`text-[10px] font-semibold ${heading}`}>Legal aid and support</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {resources.map((resource) => {
              const safeUrl = registeredSourceUrl(resource.url);
              return safeUrl ? <a key={resource.id} href={safeUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-300/20 px-2.5 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-200/[0.07]">{resource.title}{resource.phone ? ` · ${resource.phone}` : ''}<ExternalLink aria-hidden="true" className="h-3 w-3" /></a> : null;
            })}
          </div>
          {resources.map((resource) => <p key={`${resource.id}-description`} className={`mt-1 text-[9px] leading-4 ${muted}`}>{resource.audience}: {resource.purpose} · {resource.verificationStatus.replaceAll('_', ' ')}</p>)}
        </div>
      )}
    </section>
  );
}

function IndiaCodeLookup({ dark }: { dark: boolean }) {
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<IndiaCodeSearchResponse | null>(null);
  const [acts, setActs] = useState<IndiaCodeAct[] | null>(null);
  const [actId, setActId] = useState('');
  const [unit, setUnit] = useState<'section' | 'article' | 'rule'>('section');
  const [number, setNumber] = useState('');
  const [provision, setProvision] = useState<IndiaCodeProvisionResponse | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [actsBusy, setActsBusy] = useState(false);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = dark ? 'border-white/10 bg-[#0c111a] text-slate-300' : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300';
  const heading = dark ? 'text-slate-100' : 'text-zinc-900 dark:text-zinc-100';
  const muted = dark ? 'text-slate-400' : 'text-zinc-600 dark:text-zinc-400';
  const input = dark ? 'border-white/10 bg-black/20 text-slate-100 placeholder:text-slate-500' : 'border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
  const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-indigo-300/25 bg-indigo-300/[0.08] px-3 text-[10px] font-semibold text-indigo-100 hover:bg-indigo-300/[0.14] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300';

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setSearchResult(null); setSearchBusy(true);
    try { setSearchResult(await searchIndiaCode(query.trim())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Search could not be completed.'); }
    finally { setSearchBusy(false); }
  }

  async function loadActs() {
    setError(null); setActsBusy(true);
    try { setActs((await getIndiaCodeActs(100)).acts); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Act list could not be loaded.'); }
    finally { setActsBusy(false); }
  }

  async function submitProvision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setProvision(null); setProvisionBusy(true);
    try { setProvision(await getIndiaCodeProvision(actId.trim(), unit, number.trim())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Provision text could not be retrieved.'); }
    finally { setProvisionBusy(false); }
  }

  return (
    <section className={`rounded-xl border p-3 sm:p-4 ${panel}`} aria-label="Explicit IndiaCode legal source lookup">
      <div className="flex items-start gap-2">
        <Search aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-200" />
        <div>
          <h4 className={`text-xs font-semibold ${heading}`}>Search and inspect a provision</h4>
          <p className={`mt-1 text-[10px] leading-5 ${muted}`}>This optional lookup sends only the search terms or act/provision identifiers you enter to the third-party IndiaCode/eCourtsIndia API. Case details are never submitted automatically.</p>
        </div>
      </div>
      <form onSubmit={submitSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="indiacode-search-query">Search words</label>
        <input id="indiacode-search-query" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter a statute title or narrow legal term" className={`min-h-10 min-w-0 flex-1 rounded-lg border px-3 text-xs ${input}`} />
        <button className={button} type="submit" disabled={!query.trim() || searchBusy}>{searchBusy ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Search aria-hidden="true" className="h-3.5 w-3.5" />}{searchBusy ? 'Searching…' : 'Search API'}</button>
      </form>
      {searchResult && (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className={`text-[9px] ${muted}`}>{searchResult.source.provider} · retrieved {searchResult.source.retrievedAt} · verification {searchResult.source.verificationStatus}</p>
          <p className="rounded-lg border border-amber-300/20 bg-amber-200/[0.04] px-2.5 py-2 text-[10px] leading-4 text-amber-100">Search snippets are discovery-only. They are not full statutory text and do not verify authenticity, amendments, commencement, current force, or applicability.</p>
          {searchResult.results.length ? searchResult.results.map((hit, index) => {
            const provider = registeredSourceUrl(hit.providerUrl);
            const official = registeredSourceUrl(hit.officialSourceUrl);
            return <article key={`${hit.reference ?? hit.title ?? 'hit'}-${index}`} className={`rounded-lg border p-2.5 ${dark ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black/10'}`}>
              <p className={`text-[11px] font-semibold ${heading}`}>{hit.title || 'Untitled result'}{hit.reference ? ` · ${hit.reference}` : ''}</p>
              <p className={`mt-1 text-[10px] leading-5 ${muted}`}>{hit.snippet || 'No discovery snippet returned.'}</p>
              <p className={`mt-1 text-[9px] ${muted}`}>{hit.kind || 'result'} · jurisdiction scope {hit.jurisdictionScope}{hit.jurisdictionRaw ? ` (${hit.jurisdictionRaw})` : ''} · {hit.textStatus.replaceAll('_', ' ')}</p>
              <div className="mt-2 flex flex-wrap gap-2">{provider && <a href={provider} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[9px] font-semibold text-sky-200">Third-party result <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>}{official && <a href={official} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[9px] font-semibold text-emerald-200">Open official record to verify <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>}</div>
            </article>;
          }) : <p className={`text-[10px] ${muted}`}>No results returned for this search.</p>}
          <p className={`text-[9px] leading-4 ${muted}`}>{searchResult.source.verificationNote}</p>
        </div>
      )}
      <div className="mt-4 border-t border-current/10 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-[10px] font-semibold ${heading}`}>Exact provision text (third-party copy; unverified)</p>
          <button type="button" className={button} onClick={() => void loadActs()} disabled={actsBusy}>{actsBusy ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}{actsBusy ? 'Loading act IDs…' : `Load text-bearing act IDs${acts ? ` · ${acts.length}` : ''}`}</button>
        </div>
        <form onSubmit={submitProvision} className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="min-w-0">
            <label htmlFor="indiacode-act-id" className={`mb-1 block text-[9px] ${muted}`}>Act ID (choose a listed ID or enter one)</label>
            <input id="indiacode-act-id" list="indiacode-act-list" value={actId} onChange={(event) => setActId(event.target.value)} placeholder="IndiaCode act id" className={`min-h-9 w-full rounded-lg border px-2.5 text-[10px] ${input}`} />
            <datalist id="indiacode-act-list">{(acts ?? []).flatMap((act) => act.id ? [<option key={act.id} value={act.id}>{act.title || act.shortTitle || act.id}</option>] : [])}</datalist>
          </div>
          <div>
            <label htmlFor="indiacode-provision-unit" className={`mb-1 block text-[9px] ${muted}`}>Unit</label>
            <select id="indiacode-provision-unit" value={unit} onChange={(event) => setUnit(event.target.value as 'section' | 'article' | 'rule')} className={`min-h-9 rounded-lg border px-2 text-[10px] ${input}`}><option value="section">Section</option><option value="article">Article</option><option value="rule">Rule</option></select>
          </div>
          <div>
            <label htmlFor="indiacode-provision-number" className={`mb-1 block text-[9px] ${muted}`}>Provision number</label>
            <input id="indiacode-provision-number" maxLength={100} value={number} onChange={(event) => setNumber(event.target.value)} placeholder="e.g. 17(2)" className={`min-h-9 w-28 rounded-lg border px-2 text-[10px] ${input}`} />
          </div>
          <div className="flex items-end"><button type="submit" className={button} disabled={!actId.trim() || !number.trim() || provisionBusy}>{provisionBusy ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}{provisionBusy ? 'Retrieving…' : 'Fetch text'}</button></div>
        </form>
        {acts && <p className={`mt-1 text-[9px] ${muted}`}>The act picker lists text-bearing API records only. Scanned `/listed-acts` entries are excluded.</p>}
        {provision && (
          <article className={`mt-3 rounded-lg border p-3 ${dark ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black/10'}`} aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h5 className={`text-[11px] font-semibold ${heading}`}>{provision.actTitle || 'Act title unavailable'} · {provision.provisionUnit} {provision.provisionNumber}</h5><p className={`mt-1 text-[9px] ${muted}`}>{provision.provisionHeading || 'No heading returned'} · {provision.jurisdictionScope}{provision.jurisdictionRaw ? ` (${provision.jurisdictionRaw})` : ''}{provision.effectiveOrCommencementDate ? ` · date listed: ${provision.effectiveOrCommencementDate}` : ''}</p></div>
              <span className="rounded-full border border-amber-300/20 px-2 py-1 text-[9px] font-semibold text-amber-100">UNVERIFIED PROVIDER COPY</span>
            </div>
            {provision.provisionText ? <pre className={`mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-current/10 p-3 font-sans text-[11px] leading-6 ${heading}`}>{provision.provisionText}</pre> : <p className={`mt-3 text-[10px] ${muted}`}>The provider returned no full provision text.</p>}
            <p className={`mt-2 text-[9px] leading-4 ${muted}`}>{provision.source.provider} · originally retrieved {provision.source.retrievedAt} · {provision.source.verificationNote}</p>
            <div className="mt-2 flex flex-wrap gap-3">{registeredSourceUrl(provision.providerUrl) && <a href={registeredSourceUrl(provision.providerUrl)!} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[9px] font-semibold text-sky-200">Provider record <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>}{registeredSourceUrl(provision.officialSourceUrl) && <a href={registeredSourceUrl(provision.officialSourceUrl)!} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[9px] font-semibold text-emerald-200">Verify at official source <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>}{provision.source.officialVerificationPortals.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[9px] font-semibold text-emerald-200">Official verification portal <ExternalLink aria-hidden="true" className="h-3 w-3" /></a>)}</div>
          </article>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-300/20 bg-rose-200/[0.05] p-2 text-[10px] leading-5 text-rose-100">{error}</p>}
    </section>
  );
}

export function LegalSourceCandidates({
  caseData,
  records,
  variant = 'light',
  title = 'Legal grounding',
}: LegalSourceCandidatesProps) {
  const dark = variant === 'dark';
  const reducedMotion = useReducedMotion();
  const issues = caseData.legalIssues;
  const location = recordedLocation(caseData);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(issues[0]?.id ?? null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(records[0]?.id ?? null);
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(() => new Set(records[0] ? [records[0].id] : []));
  const [activeStep, setActiveStep] = useState<GroundingStep>('case-info');
  const [whyRecordId, setWhyRecordId] = useState<string | null>(null);

  const resolvedIssueId = issues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : issues[0]?.id ?? null;
  const resolvedRecordId = records.some((record) => record.id === selectedRecordId) ? selectedRecordId : records[0]?.id ?? null;
  const selectedIssue = issues.find((issue) => issue.id === resolvedIssueId) ?? null;
  const selectedRecord = records.find((record) => record.id === resolvedRecordId) ?? null;
  const lawMatches = caseData.analysis?.legalKnowledge.lawMatches ?? [];
  const supportResources = caseData.analysis?.legalKnowledge.supportResources ?? [];
  const issueRationales = selectedIssue?.rationale.filter((rationale) => rationale.trim()) ?? [];
  const journeyPaths = caseData.analysis?.journey?.possiblePaths ?? [];
  const darkCard = 'border-white/[0.08] bg-[#0c111a] text-slate-300';
  const lightCard = 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300';
  const card = dark ? darkCard : lightCard;
  const heading = dark ? 'text-slate-100' : 'text-zinc-900 dark:text-zinc-100';
  const muted = dark ? 'text-slate-400' : 'text-zinc-500 dark:text-zinc-400';
  const accent = dark ? 'text-[#c6ceff]' : 'text-indigo-700 dark:text-indigo-200';

  const relationshipSteps = useMemo(() => [
    { id: 'case-info' as const, label: 'Case information', icon: FileText, detail: issueRationales.length ? `${issueRationales.length} returned rationale${issueRationales.length === 1 ? '' : 's'}` : 'No rationale returned' },
    { id: 'issue' as const, label: 'Candidate issue', icon: Landmark, detail: selectedIssue ? issueLabel(selectedIssue) : 'No issue selected' },
    { id: 'source' as const, label: 'Source', icon: BookOpenText, detail: selectedRecord?.title ?? 'No source returned' },
    { id: 'jurisdiction' as const, label: 'Jurisdiction', icon: MapPin, detail: selectedRecord?.jurisdictionLabel || humanize(selectedRecord?.jurisdiction, 'Unknown') },
    { id: 'applicability' as const, label: 'Applicability', icon: ShieldCheck, detail: humanize(selectedRecord?.sourceApplicabilityStatus, 'Not established') },
    { id: 'procedure' as const, label: 'Procedural possibility', icon: Waypoints, detail: journeyPaths.length ? `${journeyPaths.length} recorded candidate${journeyPaths.length === 1 ? '' : 's'}` : 'Not established' },
  ], [issueRationales.length, journeyPaths.length, selectedIssue, selectedRecord]);

  function toggleRecord(record: LegalKnowledgeRecordSummary) {
    setSelectedRecordId(record.id);
    setExpandedRecords((current) => {
      const next = new Set(current);
      if (next.has(record.id)) next.delete(record.id);
      else next.add(record.id);
      return next;
    });
  }

  function activateStep(step: GroundingStep) {
    setActiveStep(step);
    if (step === 'issue') document.getElementById('grounding-issue-selector')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    if (step === 'source') document.getElementById('grounding-source-list')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  return (
    <section aria-label={title} className="mt-4 space-y-4 border-t border-current/10 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`grid h-8 w-8 place-items-center rounded-lg border ${dark ? 'border-indigo-200/15 bg-indigo-200/[0.06] text-indigo-100' : 'border-indigo-300/50 bg-indigo-50 text-indigo-700 dark:border-indigo-200/15 dark:bg-indigo-200/[0.06] dark:text-indigo-100'}`}>
              <Network aria-hidden="true" className="h-4 w-4" />
            </span>
            <h3 className={`text-sm font-semibold ${heading}`}>{title}</h3>
          </div>
          <p className={`mt-2 max-w-2xl text-xs leading-5 ${muted}`}>
            Inspect how recorded case information, a candidate issue, and returned source records relate. A retrieval candidate does not establish applicability.
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone(records.length ? 'relevant' : 'unknown')}`}>
          {records.length ? `${records.length} relevant candidate${records.length === 1 ? '' : 's'}` : 'No source returned'}
        </span>
      </div>

      <MatchGuidance matches={lawMatches} resources={supportResources} dark={dark} />
      <details className={`rounded-xl border ${card}`}>
        <summary className={`cursor-pointer list-none px-3 py-3 text-xs font-semibold ${heading} focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300`}>
          Search IndiaCode/eCourtsIndia or fetch exact provision text <span className={`ml-1 text-[9px] font-normal ${muted}`}>(optional third-party lookup)</span>
        </summary>
        <div className="border-t border-current/10 p-3 sm:p-4">
          <IndiaCodeLookup dark={dark} />
        </div>
      </details>

      <div className={`overflow-hidden rounded-2xl border ${card}`}>
        <div className={`grid grid-cols-2 divide-y divide-x sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6 ${dark ? 'divide-white/[0.06]' : 'divide-zinc-200 dark:divide-zinc-800'}`}>
          {relationshipSteps.map((step, index) => {
            const Icon = step.icon;
            const active = activeStep === step.id;
            return (
              <button
                key={step.id}
                type="button"
                aria-pressed={active}
                onClick={() => activateStep(step.id)}
                className={`group relative flex min-h-[86px] flex-col items-start justify-between gap-2 p-3 text-left transition focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-indigo-300 ${active ? dark ? 'bg-indigo-200/[0.07]' : 'bg-indigo-50 dark:bg-indigo-200/[0.06]' : 'hover:bg-white/[0.035]'}`}
              >
                {index < relationshipSteps.length - 1 && <span aria-hidden="true" className={`absolute right-[-5px] top-5 z-10 hidden h-px w-2.5 border-t border-dashed sm:block ${dark ? 'border-indigo-200/35' : 'border-indigo-400/50'}`} />}
                <span className={`flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${active ? accent : muted}`}>
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" />{step.label}
                </span>
                <span className={`line-clamp-2 text-[11px] leading-4 ${active ? heading : muted}`}>{step.detail}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${activeStep}-${selectedIssueId ?? 'none'}-${selectedRecordId ?? 'none'}`}
            initial={reducedMotion ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            className={`border-t p-3 sm:px-4 ${dark ? 'border-white/[0.06] bg-[#101722]/70' : 'border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-black/10'}`}
          >
            {activeStep === 'case-info' && (
              <div className="space-y-3" aria-live="polite">
                <div className="flex items-start gap-2">
                  <ArrowDownRight aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${accent}`} />
                  <div>
                    <p className={`text-xs font-semibold ${heading}`}>Information returned as the issue rationale</p>
                    <p className={`mt-1 text-[11px] leading-5 ${muted}`}>These strings are shown verbatim from the candidate issue record. They are the available explanation for why this issue appeared; they are not independently verified facts.</p>
                  </div>
                </div>
                {issueRationales.length ? (
                  <ul className="space-y-2">
                    {issueRationales.map((rationale, index) => (
                      <li key={`${selectedIssue?.id}-${index}`} className={`rounded-lg border px-3 py-2 text-xs leading-5 ${dark ? 'border-indigo-200/10 bg-indigo-200/[0.035] text-slate-200' : 'border-indigo-200 bg-indigo-50/70 text-zinc-700 dark:border-indigo-200/10 dark:bg-indigo-200/[0.035] dark:text-slate-200'}`}>
                        <span className={`mr-2 font-mono text-[9px] uppercase tracking-wide ${muted}`}>Returned rationale {index + 1}</span>
                        {rationale}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`rounded-lg border border-dashed px-3 py-3 text-xs leading-5 ${dark ? 'border-white/10 text-slate-400' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'}`}>
                    No issue rationale or explicit fact-to-issue link was returned. The case facts remain available in the Legal Twin, but this response does not identify which fact caused the issue to appear.
                  </p>
                )}
              </div>
            )}
            {activeStep === 'issue' && (
              <div className="space-y-2" aria-live="polite">
                <p className={`text-xs font-semibold ${heading}`}>Select a candidate issue</p>
                <p className={`text-[11px] leading-5 ${muted}`}>Selection changes the rationale and context shown in this grounding path. Candidate status is not a legal finding.</p>
                {!issues.length ? (
                  <p className={`rounded-lg border border-dashed p-3 text-xs ${muted}`}>No candidate legal issue was returned with this case.</p>
                ) : (
                  <div id="grounding-issue-selector" className="flex flex-wrap gap-2">
                    {issues.map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        aria-pressed={selectedIssue?.id === issue.id}
                        onClick={() => { setSelectedIssueId(issue.id); setActiveStep('case-info'); }}
                        className={`min-h-10 rounded-lg border px-3 py-2 text-left text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${selectedIssue?.id === issue.id ? 'border-indigo-200/30 bg-indigo-200/[0.12] text-indigo-50' : dark ? 'border-white/[0.08] bg-white/[0.025] text-slate-300 hover:border-indigo-200/20' : 'border-zinc-200 bg-white text-zinc-700 hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-slate-300'}`}
                      >
                        <span className="block">{issueLabel(issue)}</span>
                        <span className={`mt-1 block text-[9px] font-medium uppercase tracking-wide ${muted}`}>Candidate · {humanize(issue.confidence)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeStep === 'source' && (
              <div className="space-y-2" aria-live="polite">
                <p className={`text-xs font-semibold ${heading}`}>{selectedRecord ? `Selected source · ${selectedRecord.title}` : 'No source candidate returned'}</p>
                <p className={`text-[11px] leading-5 ${muted}`}>
                  The case response returns source candidates, but does not include a source-to-issue ID. Treat the displayed connection as a candidate lookup relationship.
                </p>
              </div>
            )}
            {activeStep === 'jurisdiction' && (
              <div className="space-y-2" aria-live="polite">
                <p className={`text-xs font-semibold ${heading}`}>Geographic fit · {selectedRecord?.jurisdictionLabel || humanize(selectedRecord?.jurisdiction)}</p>
                <p className={`text-[11px] leading-5 ${muted}`}>{selectedRecord ? geographicScopeNote(selectedRecord, location) : 'No source jurisdiction metadata was returned.'}</p>
                <p className={`text-[10px] ${muted}`}>Case location · {location || 'Unknown'} · basis {humanize(caseData.jurisdiction.basis)}</p>
              </div>
            )}
            {activeStep === 'applicability' && (
              <div className="space-y-2" aria-live="polite">
                <p className={`text-xs font-semibold ${heading}`}>Applicability is a separate question</p>
                <p className={`text-[11px] leading-5 ${muted}`}>
                  {selectedRecord ? applicabilityDescription(selectedRecord) : 'Applicability is unknown because no source status was returned.'}
                </p>
              </div>
            )}
            {activeStep === 'procedure' && (
              <div className="space-y-2" aria-live="polite">
                <p className={`text-xs font-semibold ${heading}`}>Procedural possibility remains conditional</p>
                {journeyPaths.length ? (
                  <ul className="space-y-2">
                    {journeyPaths.map((path) => (
                      <li key={path.id} className={`rounded-lg border px-3 py-2 ${dark ? 'border-amber-200/10 bg-amber-200/[0.025]' : 'border-amber-200 bg-amber-50 dark:border-amber-200/10 dark:bg-amber-200/[0.025]'}`}>
                        <p className={`text-xs font-medium ${heading}`}>{path.label}</p>
                        <p className={`mt-1 text-[11px] leading-5 ${muted}`}>{path.description}</p>
                        <p className={`mt-1 text-[9px] uppercase tracking-wide ${muted}`}>Journey status · {humanize(path.status)} · jurisdiction required {path.jurisdictionRequired ? 'yes' : 'no'}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`text-[11px] leading-5 ${muted}`}>No procedural possibility was returned. A retrieved source alone does not create a procedural option.</p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {selectedIssue && (
        <section aria-label="Candidate issue details" className={`rounded-xl border p-3 sm:p-4 ${card}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`text-[9px] font-semibold uppercase tracking-[0.14em] ${muted}`}>Selected candidate issue</p>
              <h4 className={`mt-1 text-sm font-semibold ${heading}`}>{issueLabel(selectedIssue)}</h4>
              <p className={`mt-1 text-[10px] ${muted}`}>Candidate · confidence {humanize(selectedIssue.confidence)}</p>
            </div>
            <a href={twinHref(caseData.id, `legal_issue:${selectedIssue.id}`)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-slate-300' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}>
              <Network aria-hidden="true" className="h-3.5 w-3.5" /> Open issue in Twin <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
            </a>
            <CaseContextLink kind="issue" recordId={selectedIssue.id} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-slate-300' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}>
              Review issue in context
            </CaseContextLink>
          </div>
          {issueRationales.length === 0 && <p className={`mt-3 text-xs leading-5 ${muted}`}>No rationale was returned for this issue, so the case information that caused it to appear is not available here.</p>}
        </section>
      )}

      <section id="grounding-source-list" aria-label="Source candidates" className="space-y-3">
        {records.length === 0 ? (
          <div className={`rounded-xl border border-dashed p-4 ${card}`}>
            <p className={`text-xs font-semibold ${heading}`}>No source candidate returned</p>
            <p className={`mt-1 text-[11px] leading-5 ${muted}`}>An empty lookup does not mean no law applies. The case record does not contain a source reference or excerpt to inspect.</p>
          </div>
        ) : records.map((record) => {
          const expanded = expandedRecords.has(record.id);
          const selected = selectedRecord?.id === record.id;
          const facts = factsFromSameSource(record, caseData.facts);
          const evidence = relatedEvidence(record, caseData);
          const documentIds = [...new Set(record.provenance.flatMap((item) => item.documentId ? [item.documentId] : []))];
          const verification = sourceVerificationLabel(record);
          const firstProvenance = record.provenance[0];
          const locator = record.reference || firstProvenance?.pageSectionReference || firstProvenance?.provisionId || null;
          const sourceUrl = registeredSourceUrl(record.sourceUrl || firstProvenance?.sourceUrl);
          const whyOpen = whyRecordId === record.id;

          return (
            <motion.article
              key={record.id}
              layout={!reducedMotion}
              className={`overflow-hidden rounded-xl border transition-colors ${selected ? dark ? 'border-indigo-200/25 bg-indigo-200/[0.035]' : 'border-indigo-300/70 bg-indigo-50/40 dark:border-indigo-200/25 dark:bg-indigo-200/[0.035]' : card}`}
            >
              <div className="flex items-stretch">
                <span aria-hidden="true" className={`hidden w-1 shrink-0 sm:block ${selected ? 'bg-indigo-300/70' : 'bg-transparent'}`} />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleRecord(record)}
                    className="flex min-h-[70px] w-full items-center gap-3 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-indigo-300 sm:px-4"
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${selected ? 'border-indigo-200/20 bg-indigo-200/[0.09] text-indigo-100' : dark ? 'border-white/[0.08] bg-white/[0.03] text-slate-400' : 'border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-black/20 dark:text-zinc-400'}`}>
                      <BookOpenText aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs font-semibold ${heading}`}>{record.title}</span>
                      <span className={`mt-1 block truncate text-[10px] ${muted}`}>
                        {record.authority || humanize(record.authorityTier, 'Authority not returned')} · {record.jurisdictionLabel || humanize(record.jurisdiction)} · {record.version || 'Version unknown'}
                      </span>
                    </span>
                    <span className="hidden flex-wrap justify-end gap-1.5 md:flex">
                      <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusTone('relevant')}`}>Relevant candidate</span>
                      <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusTone(record.sourceVerificationStatus)}`}>{verification}</span>
                    </span>
                    <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} ${muted}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className={`space-y-4 border-t px-3 py-4 sm:px-4 ${dark ? 'border-white/[0.06]' : 'border-zinc-200 dark:border-zinc-800'}`}>
                          <div className="flex flex-wrap gap-1.5 md:hidden">
                            <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusTone('relevant')}`}>Relevant candidate</span>
                            <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${statusTone(record.sourceVerificationStatus)}`}>{verification}</span>
                          </div>
                          <dl className="grid gap-x-5 gap-y-3 text-[10px] sm:grid-cols-2">
                            <div><dt className={muted}>Authority</dt><dd className={`mt-0.5 text-xs ${heading}`}>{record.authority || humanize(record.authorityTier, 'Not returned')}</dd></div>
                            <div><dt className={muted}>Jurisdiction</dt><dd className={`mt-0.5 text-xs ${heading}`}>{record.jurisdictionLabel || humanize(record.jurisdiction)} · {humanize(record.jurisdictionMatchStatus, 'Match unknown')}</dd></div>
                            <div><dt className={muted}>Verification</dt><dd className={`mt-0.5 text-xs ${heading}`}>{verification} · source identity {humanize(record.sourceVerificationStatus, 'Unknown')}</dd></div>
                            <div><dt className={muted}>Freshness / version</dt><dd className={`mt-0.5 text-xs ${heading}`}>{humanize(record.sourceFreshnessStatus, 'Freshness unknown')} · {record.version || 'Version unknown'}</dd></div>
                            <div><dt className={muted}>Applicability</dt><dd className={`mt-0.5 text-xs ${heading}`}>{humanize(record.sourceApplicabilityStatus, 'Unknown')} · not established by retrieval</dd></div>
                            <div><dt className={muted}>Catalog record</dt><dd className={`mt-0.5 text-xs ${heading}`}>{humanize(record.status)}</dd></div>
                            <div className="sm:col-span-2"><dt className={muted}>Geographic scope check</dt><dd className={`mt-0.5 text-xs leading-5 ${heading}`}>{geographicScopeNote(record, location)}</dd></div>
                            {record.effectiveFrom && <div><dt className={muted}>Effective from</dt><dd className={`mt-0.5 text-xs ${heading}`}>{record.effectiveFrom}</dd></div>}
                            {record.reference && <div><dt className={muted}>Source reference</dt><dd className={`mt-0.5 break-words text-xs ${heading}`}>{record.reference}</dd></div>}
                            {firstProvenance?.pageSectionReference && <div><dt className={muted}>Returned locator</dt><dd className={`mt-0.5 break-words text-xs ${heading}`}>{firstProvenance.pageSectionReference}</dd></div>}
                            {firstProvenance?.provisionId && <div><dt className={muted}>Provision / record ID</dt><dd className={`mt-0.5 break-all font-mono text-[10px] ${heading}`}>{firstProvenance.provisionId}</dd></div>}
                            {firstProvenance?.retrievalTime && <div><dt className={muted}>Retrieved</dt><dd className={`mt-0.5 text-xs ${heading}`}>{firstProvenance.retrievalTime}</dd></div>}
                            <div><dt className={muted}>Source identity</dt><dd className={`mt-0.5 break-all font-mono text-[10px] ${heading}`}>{firstProvenance?.sourceId || record.id}</dd></div>
                          </dl>

                          <div className={`rounded-lg border p-3 ${dark ? 'border-amber-200/15 bg-amber-200/[0.035]' : 'border-amber-200 bg-amber-50/70 dark:border-amber-200/15 dark:bg-amber-200/[0.035]'}`}>
                            <div className="flex items-start gap-2">
                              <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
                              <p className={`text-[11px] leading-5 ${dark ? 'text-amber-50/90' : 'text-amber-900 dark:text-amber-50/90'}`}>
                                This source is a relevant candidate. {applicabilityDescription(record)} {geographicScopeNote(record, location)}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              aria-expanded={whyOpen}
                              onClick={() => setWhyRecordId(whyOpen ? null : record.id)}
                              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-indigo-100' : 'border-zinc-300 text-indigo-700 dark:border-zinc-700 dark:text-indigo-200'}`}
                            >
                              <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" /> Why is this here?
                            </button>
                            <a href={twinHref(caseData.id, record.id)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-slate-300' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}>
                              <Network aria-hidden="true" className="h-3.5 w-3.5" /> Inspect in Twin <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                            </a>
                            {sourceUrl && (
                              <a href={sourceUrl} target="_blank" rel="noreferrer" className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-blue-200/15 text-blue-100' : 'border-blue-300 text-blue-800 dark:border-blue-200/15 dark:text-blue-100'}`}>
                                Open registered source <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                              </a>
                            )}
                          </div>

                          <AnimatePresence initial={false}>
                            {whyOpen && (
                              <motion.div
                                initial={reducedMotion ? false : { opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
                                transition={{ duration: reducedMotion ? 0 : 0.16 }}
                                className={`rounded-lg border p-3 ${dark ? 'border-indigo-200/15 bg-indigo-200/[0.04]' : 'border-indigo-200 bg-indigo-50 dark:border-indigo-200/15 dark:bg-indigo-200/[0.04]'}`}
                              >
                                <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${accent}`}>Grounded explanation</p>
                                <p className={`mt-1.5 text-xs leading-5 ${heading}`}>
                                  This record was returned as a legal source candidate for this case. {selectedIssue ? `The selected candidate issue is ${issueLabel(selectedIssue)}.` : 'No candidate issue was returned.'}
                                  {issueRationales.length ? ` The issue rationale says: “${issueRationales.join(' · ')}”` : ' No issue rationale was returned.'}
                                </p>
                                <p className={`mt-1.5 text-[11px] leading-5 ${muted}`}>
                                  Authority: {record.authority || 'not returned'} · Jurisdiction: {record.jurisdictionLabel || record.jurisdiction || 'unknown'} · Verification: {verification} · Freshness: {humanize(record.sourceFreshnessStatus, 'unknown')} · Version: {record.version || 'unknown'} · Reference: {locator || 'not returned'}.
                                </p>
                                <p className={`mt-1.5 text-[11px] leading-5 ${muted}`}>
                                  The response does not identify an individual source-to-issue link. {applicabilityDescription(record)}
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="grid gap-3 border-t border-current/10 pt-3 sm:grid-cols-2">
                            <div>
                              <p className={`mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] ${muted}`}>Case information with matching source provenance</p>
                              {facts.length ? (
                                <div className="flex flex-wrap gap-2">{facts.map((fact) => <LinkedFact key={fact.id} fact={fact} caseId={caseData.id} dark={dark} />)}</div>
                              ) : (
                                <p className={`text-[10px] leading-5 ${muted}`}>No fact-to-source provenance ID was returned. The selected issue rationale above is the only issue explanation supplied here.</p>
                              )}
                            </div>
                            <div>
                              <p className={`mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] ${muted}`}>Evidence and documents</p>
                              <div className="flex flex-wrap gap-2">
                                {evidence.map((item) => {
                                  const document = item.documentId ? caseData.documents.find((candidate) => candidate.id === item.documentId) : undefined;
                                  return document ? (
                                    <a key={item.id} href={documentHref(caseData.id, document.id)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-cyan-100' : 'border-cyan-300 text-cyan-800 dark:border-white/10 dark:text-cyan-100'}`}>
                                      <FileText aria-hidden="true" className="h-3.5 w-3.5" /> {item.title} <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                                    </a>
                                  ) : (
                                    <a key={item.id} href={twinHref(caseData.id, `evidence:${item.id}`)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-cyan-100' : 'border-cyan-300 text-cyan-800 dark:border-white/10 dark:text-cyan-100'}`}>
                                      <FileText aria-hidden="true" className="h-3.5 w-3.5" /> {item.title} <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                                    </a>
                                  );
                                })}
                                {documentIds.filter((documentId) => caseData.documents.some((document) => document.id === documentId) && !evidence.some((item) => item.documentId === documentId)).map((documentId) => {
                                  const document = caseData.documents.find((item) => item.id === documentId)!;
                                  return <a key={documentId} href={documentHref(caseData.id, documentId)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-cyan-100' : 'border-cyan-300 text-cyan-800 dark:border-white/10 dark:text-cyan-100'}`}><FileText aria-hidden="true" className="h-3.5 w-3.5" />{document.filename}<ArrowUpRight aria-hidden="true" className="h-3 w-3" /></a>;
                                })}
                                {evidence.map((item) => <CaseContextLink key={`context-${item.id}`} kind="evidence" recordId={item.id} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-cyan-100' : 'border-cyan-300 text-cyan-800 dark:border-white/10 dark:text-cyan-100'}`}><FileText aria-hidden="true" className="h-3.5 w-3.5" />Review {item.title} in context</CaseContextLink>)}
                                {evidence.length === 0 && !documentIds.some((documentId) => caseData.documents.some((document) => document.id === documentId)) && (
                                  <p className={`text-[10px] leading-5 ${muted}`}>No evidence or document ID was returned with this source.</p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <CaseContextLink kind="source" recordId={record.id} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-slate-300' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}>
                              Follow source context
                            </CaseContextLink>
                            {['authority', 'legal_authority', 'procedure', 'legal_procedure'].includes(record.type.toLocaleLowerCase()) && (
                              <a href={twinHref(caseData.id, `${['authority', 'legal_authority'].includes(record.type.toLocaleLowerCase()) ? 'authority' : 'procedure'}:${record.id}`)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${dark ? 'border-white/10 text-slate-300' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}>
                                <Network aria-hidden="true" className="h-3.5 w-3.5" /> Open source in Twin
                              </a>
                            )}
                          </div>
                          {firstProvenance?.pageSectionReference && (
                            <p className={`text-[10px] leading-4 ${muted}`}>
                              Locator returned by the source record: {firstProvenance.pageSectionReference}. No excerpt was returned, so none is displayed.
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.article>
          );
        })}
      </section>

      <p className={`flex items-start gap-2 text-[10px] leading-5 ${muted}`}>
        <Check aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
        Relevant describes retrieval. Verification, jurisdictional fit, applicability, and procedural availability remain separate determinations.
      </p>
      {selectedRecord && <span className="sr-only" aria-live="polite">Selected source: {selectedRecord.title}</span>}
    </section>
  );
}
