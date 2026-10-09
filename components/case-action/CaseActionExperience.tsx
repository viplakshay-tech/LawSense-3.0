'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ArrowUpRight,
  BadgeCheck,
  CircleHelp,
  FileCheck2,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import type { CaseState } from '@/lib/api';

type OfficialResource = {
  id: string;
  name: string;
  phone: string;
  url: string;
  description: string;
  phoneNote?: string;
};

const WOMEN_DOMAINS = new Set([
  'domestic_abuse',
  'sexual_violence',
  'workplace_sexual_harassment',
  'stalking',
  'threats_coercion',
  'cyber_harassment',
  'intimate_image_abuse',
  'dowry_related_abuse',
  'financial_control_abuse',
  'trafficking_exploitation',
]);

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function caseContextText(caseState: CaseState): string {
  return [
    caseState.title,
    caseState.initialStatement,
    ...caseState.legalIssues.flatMap((issue) => [issue.category, issue.subcategory]),
    ...caseState.facts.map((fact) => `${fact.key} ${typeof fact.value === 'string' ? fact.value : ''}`),
  ].filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase();
}

function getResources(caseState: CaseState): OfficialResource[] {
  const safety = caseState.analysis?.safetyContext;
  const womenDomains = safety?.womenSafetyContext?.domains ?? [];
  const context = caseContextText(caseState);
  const womenRelated = womenDomains.some((domain) => WOMEN_DOMAINS.has(domain))
    || /workplace harassment|domestic abuse|stalk|threat|coerc|sexual violence|dowry|traffick|exploitation|intimate image/i.test(context);
  const cyberRelated = womenDomains.some((domain) => domain === 'cyber_harassment' || domain === 'intimate_image_abuse')
    || /cyber|online abuse|online fraud|financial cyber fraud|phishing|hacked|intimate image|non-consensual image/i.test(context);
  const consumerRelated = /consumer|purchase|refund|warranty|defective|seller|e-commerce|billing grievance|product complaint/i.test(context);
  const dangerRecorded = safety?.context === 'urgent_safety_context'
    || safety?.urgency === 'urgent'
    || safety?.womenSafetyContext?.urgency === 'IMMEDIATE_DANGER'
    || safety?.womenSafetyContext?.immediateDangerAnswer === 'yes';
  const resources: OfficialResource[] = [];

  if (dangerRecorded) {
    resources.push({
      id: 'emergency-112',
      name: 'Emergency Response Support System',
      phone: '112',
      url: 'https://112.gov.in/',
      description: 'If you are in immediate danger, you can choose to contact India’s emergency response service. LawSense will not place a call or send an alert.',
    });
  }

  if (womenRelated) {
    resources.push({
      id: 'women-181',
      name: 'Women Helpline',
      phone: '181',
      url: 'https://wcd.gov.in/women/help',
      description: 'For women seeking support or information about violence and distress. The Ministry page lists state coverage; check availability for your location.',
    });
  }

  if (cyberRelated) {
    resources.push({
      id: 'cybercrime',
      name: 'National Cyber Crime Reporting Portal',
      phone: '1930',
      url: 'https://cybercrime.gov.in/',
      description: 'Use the official portal to review reporting options. The 1930 helpline is for online financial cyber fraud; other cybercrime options are on the portal.',
      phoneNote: 'Call 1930 for online financial cyber fraud. LawSense does not submit a complaint.',
    });
  }

  if (caseState.legalIssues.length > 0 || caseState.unknowns.length > 0 || caseState.jurisdiction.basis === 'unknown') {
    resources.push({
      id: 'legal-aid',
      name: 'National Legal Services Authority',
      phone: '15100',
      url: 'https://nalsa.gov.in/',
      description: 'Check official information about legal aid and how to find the appropriate legal services authority. Eligibility and availability are determined by those services.',
    });
  }

  if (consumerRelated) {
    resources.push({
      id: 'consumer-helpline',
      name: 'National Consumer Helpline',
      phone: '1915',
      url: 'https://consumerhelpline.gov.in/public/',
      description: 'Official consumer grievance information and support. The helpline page lists service hours and available contact options.',
    });
  }

  return resources;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function OfficialResourceCard({ resource }: { resource: OfficialResource }) {
  return (
    <li className="rounded-2xl border border-white/[0.09] bg-[#121821] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{resource.name}</h3>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-[#f1d0a8]">{resource.phone}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/15 bg-emerald-100/[0.04] px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-100/75">
          <BadgeCheck aria-hidden="true" className="h-3 w-3" /> Official
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">{resource.description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={resource.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c987]">
          Open official resource <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
        <a href={`tel:${resource.phone}`} className="inline-flex min-h-10 items-center rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-slate-300 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c987]">
          Call {resource.phone}
        </a>
      </div>
      {resource.phoneNote && <p className="mt-3 text-[10px] leading-4 text-slate-500">{resource.phoneNote}</p>}
    </li>
  );
}

export function CaseActionExperience({ caseId }: { caseId: string }) {
  const { caseState, loading, error, refreshCaseState } = useCaseState();
  const resources = useMemo(() => caseState ? getResources(caseState) : [], [caseState]);
  const casePath = `/case/${encodeURIComponent(caseId)}`;

  if (loading) {
    return <main className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400"><LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Loading case readiness…</main>;
  }

  if (!caseState) {
    return (
      <main className="mx-auto max-w-5xl p-6 text-slate-100">
        <section className="rounded-2xl border border-rose-200/15 bg-[#17161a] p-6">
          <h1 className="text-xl font-semibold">Case Readiness &amp; Action</h1>
          <p className="mt-2 text-sm text-slate-400">{error || 'Case data is not available.'}</p>
          <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold">Refresh case</button>
        </section>
      </main>
    );
  }

  const analysis = caseState.analysis;
  const safety = analysis?.safetyContext;
  const legalKnowledge = analysis?.legalKnowledge;
  const factsSupported = caseState.facts.filter((fact) => fact.status === 'evidence_supported').length;
  const reportedFacts = caseState.facts.filter((fact) => fact.status === 'user_reported').length;
  const unresolved = unique([
    ...caseState.unknowns,
    ...(analysis?.journey.unknowns.map((item) => item.question) ?? []),
  ]);
  const conflicts = unique([
    ...caseState.conflicts,
    ...caseState.facts.filter((item) => item.status === 'conflicting').map((item) => `${item.key}: conflicting status`),
    ...caseState.claims.filter((item) => item.status === 'conflicting').map((item) => `${item.text}: conflicting status`),
    ...caseState.evidence.filter((item) => item.status === 'conflicting').map((item) => `${item.title}: conflicting status`),
  ]);
  const safetyLabel = safety?.context === 'urgent_safety_context'
    ? 'Urgent context returned · review Protect'
    : safety?.context === 'none' || !safety
      ? 'No safety context returned in the case analysis'
      : 'Sensitive context returned · review Protect';
  const legalRecords = legalKnowledge?.records ?? [];
  const primaryAction = safety?.context === 'urgent_safety_context'
    ? { label: 'Review safety options', href: `${casePath}/safety`, reason: 'A safety context was returned with this case.' }
    : unresolved.length > 0
      ? { label: 'Review open questions', href: `${casePath}#clarification`, reason: `${unresolved.length} question${unresolved.length === 1 ? '' : 's'} remain open in the case record.` }
      : caseState.evidence.length === 0 && caseState.documents.length === 0
        ? { label: 'Add or review evidence', href: `${casePath}/documents`, reason: 'No evidence or documents are attached to this case record yet.' }
        : legalRecords.length === 0
          ? { label: 'Review legal grounding', href: `${casePath}/guide`, reason: 'No legal source records were returned for this case.' }
          : { label: 'Review the Living Twin', href: `${casePath}/twin`, reason: 'Trace how recorded facts, claims, evidence and sources connect.' };
  const readinessCopy = unresolved.length > 0 || conflicts.length > 0
    ? 'Some information remains open or conflicting. Review it before you prepare or use a document.'
    : 'The record has no open questions or conflict markers at this time. This does not establish completeness, legal strength, or an outcome.';

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <header className="rounded-3xl border border-white/[0.08] bg-[linear-gradient(135deg,#21161a,#111821_64%)] p-5 sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#e7c3aa]">Act · Case Readiness</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Case Readiness &amp; Action</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">A view of what this case record contains, what is still unclear, and user-chosen next steps. It is not a legal verdict and does not predict a court outcome.</p>
          </div>
          <Link href={`${casePath}/privacy`} className="inline-flex min-h-10 items-center rounded-lg border border-white/[0.12] px-3 text-xs font-semibold text-slate-200 hover:bg-white/[0.05]">Privacy &amp; Control</Link>
        </div>
      </header>

      <section aria-labelledby="case-status-heading" className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="case-status-heading" className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-200">Case status</h2>
          <span className="rounded-full border border-sky-200/15 bg-sky-100/[0.04] px-2.5 py-1 text-[10px] font-medium text-sky-100">Local case record · available</span>
        </div>
        <p className="mt-3 text-lg font-semibold">{caseState.title?.trim() || 'Untitled case'}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><MapPin aria-hidden="true" className="h-3.5 w-3.5" />{[caseState.jurisdiction.city, caseState.jurisdiction.district, caseState.jurisdiction.state, caseState.jurisdiction.country].filter(Boolean).join(', ') || 'Jurisdiction not recorded'}</p>
        <p className="mt-3 text-xs leading-5 text-slate-500">This prototype does not keep a formal legal case status. “Available” means case data loaded in this workspace.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Safety and evidence status">
        <article className="rounded-2xl border border-rose-200/15 bg-[#171519] p-5">
          <div className="flex items-center gap-2 text-rose-100"><ShieldAlert aria-hidden="true" className="h-4 w-4" /><h2 className="text-xs font-semibold uppercase tracking-[0.13em]">Safety status</h2></div>
          <p className="mt-3 text-sm font-medium text-slate-100">{safetyLabel}</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">Safety markers are system-inferred from supplied information. They are not a finding about what happened.</p>
          <Link href={`${casePath}/safety`} className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-rose-100 underline decoration-rose-200/30 underline-offset-4">Open Protect <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
        </article>
        <article className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5">
          <div className="flex items-center gap-2 text-slate-200"><FileCheck2 aria-hidden="true" className="h-4 w-4" /><h2 className="text-xs font-semibold uppercase tracking-[0.13em]">Evidence status</h2></div>
          <p className="mt-3 text-sm font-medium">{caseState.evidence.length} evidence items · {caseState.documents.length} uploaded documents</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">{factsSupported} facts are marked evidence-supported and {reportedFacts} are marked user-reported. These labels reflect the saved record; they do not assess evidence strength.</p>
          <Link href={`${casePath}/documents`} className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-[#f1d0a8] underline decoration-[#f1d0a8]/25 underline-offset-4">Review Evidence <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
        </article>
      </section>

      <section aria-labelledby="legal-context-heading" className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6">
        <h2 id="legal-context-heading" className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-200">Legal context</h2>
        {legalRecords.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {legalRecords.slice(0, 4).map((record) => (
              <li key={record.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                <p className="text-sm font-medium text-slate-100">{record.title}</p>
                <p className="mt-1 text-[11px] text-slate-400">{record.jurisdictionLabel || record.jurisdiction || 'Jurisdiction not returned'} · {record.version || 'Source version not returned'}</p>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">Source status · {record.sourceApplicabilityStatus ? statusLabel(record.sourceApplicabilityStatus) : 'Applicability not returned'}</p>
                {record.sourceUrl && <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-sky-200 underline underline-offset-4">Open source <ArrowUpRight aria-hidden="true" className="h-3 w-3" /></a>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-400">No legal source records were returned for this case.</p>
        )}
        <p className="mt-4 text-xs leading-5 text-slate-500">Check jurisdiction, commencement, source version and applicability in each source. LawSense does not invent legal provisions or treat a candidate source as a conclusion.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Unknowns, conflicts, and readiness">
        <article className="rounded-2xl border border-amber-200/15 bg-[#171713] p-5">
          <div className="flex items-center gap-2 text-amber-100"><CircleHelp aria-hidden="true" className="h-4 w-4" /><h2 className="text-xs font-semibold uppercase tracking-[0.13em]">Unknown / conflicting information</h2></div>
          <p className="mt-3 text-sm font-medium">{unresolved.length} open questions · {conflicts.length} conflict markers · {caseState.assumptions.length} assumptions</p>
          {(unresolved.length > 0 || conflicts.length > 0 || caseState.assumptions.length > 0) && (
            <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
              {[...unresolved.slice(0, 3).map((item) => `Unknown: ${item}`), ...conflicts.slice(0, 3).map((item) => `Conflict: ${item}`), ...caseState.assumptions.slice(0, 2).map((item) => `Assumption: ${item}`)].map((item) => <li key={item} className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2">{item}</li>)}
            </ul>
          )}
          {unresolved.length === 0 && conflicts.length === 0 && caseState.assumptions.length === 0 && <p className="mt-2 text-xs text-slate-500">No unknowns or conflicts were returned in the current record.</p>}
        </article>
        <article className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5">
          <div className="flex items-center gap-2 text-[#f1d0a8]"><TriangleAlert aria-hidden="true" className="h-4 w-4" /><h2 className="text-xs font-semibold uppercase tracking-[0.13em]">Readiness</h2></div>
          <p className="mt-3 text-sm font-medium">Preparation snapshot · not scored</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">{readinessCopy}</p>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">This is an organization aid, not a legal verdict, risk diagnosis, or prediction of a court outcome.</p>
        </article>
      </section>

      <section aria-labelledby="next-actions-heading" className="rounded-2xl border border-[#e9bd7b]/20 bg-[linear-gradient(135deg,rgba(233,189,123,0.08),rgba(16,22,31,0.98)_55%)] p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e8c891]">One next step</p>
            <h2 id="next-actions-heading" className="mt-1 text-lg font-semibold">Next actions</h2>
            <p className="mt-2 text-xs leading-5 text-slate-300">{primaryAction.reason}</p>
          </div>
          <Link href={primaryAction.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#e9bd7b] px-4 text-sm font-semibold text-[#20170d] transition hover:bg-[#f3d3a1]">{primaryAction.label}<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
          <Link href={`${casePath}/safety`} className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05]">Protect</Link>
          <Link href={`${casePath}/documents`} className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05]">Evidence</Link>
          <Link href={`${casePath}/guide`} className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05]">Law</Link>
          <Link href={`${casePath}/draft`} className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05]">Prepare</Link>
          <Link href={`${casePath}/voice`} className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05]">Guide Call</Link>
        </div>
      </section>

      {resources.length > 0 && (
        <section aria-labelledby="official-support-heading" className="space-y-4">
          <header>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100/70">Support resources matched to this record</p>
            <h2 id="official-support-heading" className="mt-1 text-lg font-semibold">Official support</h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">Resources are suggestions based on recorded safety and case categories. You decide whether to open them. LawSense does not contact anyone or submit information, and no helpline can guarantee a resolution.</p>
          </header>
          <ul className="grid gap-3 sm:grid-cols-2">
            {resources.map((resource) => <OfficialResourceCard key={resource.id} resource={resource} />)}
          </ul>
        </section>
      )}

      <section id="monitor" aria-labelledby="monitor-heading" className="scroll-mt-8 rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Monitor · living case</p>
            <h2 id="monitor-heading" className="mt-1 text-lg font-semibold">Check the record as it changes</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">Review newly added facts, events, evidence, source status, open questions and conflicts. Only updates returned by the case service change this case state.</p>
          </div>
          <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.1] px-3 text-xs font-semibold text-slate-200 hover:bg-white/[0.05]"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Refresh record</button>
        </div>
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
          <p className="rounded-lg bg-white/[0.025] p-3 text-slate-400">{caseState.facts.length} facts</p>
          <p className="rounded-lg bg-white/[0.025] p-3 text-slate-400">{caseState.events.length} timeline events</p>
          <p className="rounded-lg bg-white/[0.025] p-3 text-slate-400">{caseState.evidence.length} evidence items</p>
          <p className="rounded-lg bg-white/[0.025] p-3 text-slate-400">{legalRecords.length} legal source records</p>
        </div>
        {caseState.events.length > 0 && (
          <ol className="mt-4 space-y-2">
            {caseState.events.slice(0, 6).map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] px-3 py-2 text-xs">
                <span className="text-slate-500">{event.date || 'Date unknown'}</span>
                <span className="font-medium text-slate-200">{event.description}</span>
                <span className="text-slate-500">Date precision · {event.datePrecision}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="flex items-start gap-2 text-[10px] leading-4 text-slate-500"><TriangleAlert aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />LawSense will never submit anything automatically. Opening an official site or choosing a phone link is your action; a phone app may open on your device.</p>
    </main>
  );
}
