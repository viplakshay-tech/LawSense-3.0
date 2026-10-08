'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Check,
  CircleAlert,
  FileText,
  Landmark,
  Network,
  Route,
  ShieldAlert,
  X,
} from 'lucide-react';
import { getLegalTwin, type CaseState, type LegalTwinSummary, type TwinNodeRecord } from '@/lib/api';
import { buildCaseSurfaceHref } from '@/lib/case-context';
import { useCaseState } from '../../app/case/[id]/CaseStateProvider';
import type { CaseContextKind } from '@/lib/case-context';
import { CaseContextLink } from './CaseContextLink';

type CaseContextPanelProps = { caseId: string };

function humanize(value: string | null | undefined): string {
  return value?.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Not reported';
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value provided.';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return 'No value provided.';
  try { return JSON.stringify(value) ?? 'No value provided.'; } catch { return 'Value could not be displayed.'; }
}

function LinkRow({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  const className = 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:-translate-y-px hover:border-[#a77b49]/40 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a77b49] motion-reduce:transform-none dark:border-white/[0.1] dark:bg-white/[0.035] dark:text-slate-200 dark:hover:bg-white/[0.07]';
  const content = <>{children}<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /></>;
  return external ? <a href={href} target="_blank" rel="noreferrer" className={className}>{content}</a> : <Link href={href} className={className}>{content}</Link>;
}

function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="border-t border-slate-200/80 py-3 first:border-0 dark:border-white/[0.07]"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt><dd className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">{children}</dd></div>;
}

function PanelAction({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function ContextBody({ caseData, kind, recordId, caseId }: { caseData: CaseState; kind: CaseContextKind; recordId: string | null; caseId: string }) {
  const evidence = caseData.evidence.find((item) => item.id === recordId);
  const fact = caseData.facts.find((item) => item.id === recordId);
  const issue = caseData.legalIssues.find((item) => item.id === recordId);
  const source = caseData.analysis?.legalKnowledge.records.find((item) => item.id === recordId);
  const step = caseData.analysis?.journey.steps.find((item) => item.id === recordId);
  const document = caseData.documents.find((item) => item.id === recordId);
  const safety = caseData.analysis?.safetyContext;
  const twinRoute = (focus: string) => buildCaseSurfaceHref(caseId, 'twin', { focus });
  const documentRoute = (documentId: string) => buildCaseSurfaceHref(caseId, 'documents', { documentId });
  const guideRoute = (context: CaseContextKind, targetId?: string) => buildCaseSurfaceHref(caseId, 'guide', { context, recordId: targetId });
  if (kind === 'fact' && fact) {
    const linkedEvidence = caseData.evidence.filter((item) => fact.sourceIds.includes(item.id) || fact.provenance.some((itemSource) => itemSource.documentId && itemSource.documentId === item.documentId));
    const linkedDocumentIds = [...new Set(fact.provenance.map((item) => item.documentId))].filter(Boolean) as string[];
    const linkedSources = (caseData.analysis?.legalKnowledge.records ?? []).filter((item) => {
      const sourceIds = new Set([item.id, ...item.provenance.flatMap((entry) => [entry.sourceId, entry.provisionId ?? ''])].filter(Boolean));
      const documentIds = new Set(item.provenance.flatMap((entry) => entry.documentId ? [entry.documentId] : []));
      return fact.sourceIds.some((id) => sourceIds.has(id)) || fact.provenance.some((entry) => documentIds.has(entry.documentId));
    });
    return <>
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{fact.key !== 'statement' && <span className="font-semibold">{humanize(fact.key)}: </span>}{displayValue(fact.value)}</p>
      <dl className="mt-5"><DataRow label="Record status">{humanize(fact.status)} · {humanize(fact.confidence)} confidence</DataRow><DataRow label="Guide context">The case record currently represents this as {humanize(fact.status).toLowerCase()}. {fact.sourceIds.length ? `${fact.sourceIds.length} source reference${fact.sourceIds.length === 1 ? '' : 's'} are attached.` : 'No evidence source is attached.'} This describes the saved record, not a legal conclusion.</DataRow></dl>
      {linkedEvidence.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Evidence linked to this fact</h3><PanelAction>{linkedEvidence.map((item) => <CaseContextLink key={item.id} kind="evidence" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{item.title}</CaseContextLink>)}</PanelAction></section>}
      {linkedDocumentIds.length > 0 && <section className="mt-4 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Source documents</h3><PanelAction>{linkedDocumentIds.map((id) => caseData.documents.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => <LinkRow key={item.id} href={documentRoute(item.id)}>{item.filename}</LinkRow>)}</PanelAction></section>}
      {linkedSources.length > 0 && <section className="mt-4 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Legal sources sharing this provenance</h3><PanelAction>{linkedSources.map((item) => <CaseContextLink key={item.id} kind="source" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Landmark aria-hidden="true" className="h-3.5 w-3.5" />{item.title}</CaseContextLink>)}</PanelAction></section>}
      {caseData.legalIssues.length > 0 && <p className="mt-4 text-[11px] leading-5 text-slate-500">Candidate issue classifications are available in the case record, but this fact has no returned fact-to-issue ID link.</p>}
      <PanelAction><LinkRow href={twinRoute(`claim:fact:${fact.id}`)}><Network aria-hidden="true" className="h-3.5 w-3.5" />Inspect this fact in the Living Twin</LinkRow><LinkRow href={guideRoute('fact', fact.id)}><BookOpenText aria-hidden="true" className="h-3.5 w-3.5" />Open Guide with this fact</LinkRow></PanelAction>
    </>;
  }

  if (kind === 'evidence' && evidence) {
    const linkedFacts = caseData.facts.filter((item) => item.sourceIds.includes(evidence.id) || Boolean(evidence.documentId && item.provenance.some((sourceItem) => sourceItem.documentId === evidence.documentId)));
    const linkedSources = (caseData.analysis?.legalKnowledge.records ?? []).filter((item) => {
      const sourceIds = new Set([item.id, ...item.provenance.flatMap((entry) => [entry.sourceId, entry.provisionId ?? ''])].filter(Boolean));
      const documentIds = new Set(item.provenance.flatMap((entry) => entry.documentId ? [entry.documentId] : []));
      return sourceIds.has(evidence.id) || Boolean(evidence.documentId && documentIds.has(evidence.documentId));
    });
    const associatedDocument = evidence.documentId ? caseData.documents.find((item) => item.id === evidence.documentId) : null;
    return <>
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{evidence.title}</p>
      <dl className="mt-5"><DataRow label="Evidence record">{humanize(evidence.type)} · {humanize(evidence.source)} · {humanize(evidence.status)}</DataRow>{evidence.processingStatus && <DataRow label="Processing">{humanize(evidence.processingStatus)}</DataRow>}</dl>
      {associatedDocument && <section className="mt-5 rounded-2xl border border-[#d7b27f]/30 bg-[#f7f0e7] p-4 dark:border-[#d7b27f]/15 dark:bg-[#d7b27f]/[0.05]"><h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">Source page</h3><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{associatedDocument.filename} · {associatedDocument.pageCount} page{associatedDocument.pageCount === 1 ? '' : 's'} · {humanize(associatedDocument.processingStatus)}</p><div className="mt-3"><LinkRow href={documentRoute(associatedDocument.id)}><FileText aria-hidden="true" className="h-3.5 w-3.5" />Open the source document</LinkRow></div></section>}
      {linkedFacts.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Facts linked to this evidence</h3><PanelAction>{linkedFacts.map((item) => <CaseContextLink key={item.id} kind="fact" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Check aria-hidden="true" className="h-3.5 w-3.5" />{humanize(item.key)} · {displayValue(item.value)}</CaseContextLink>)}</PanelAction></section>}
      {linkedSources.length > 0 && <section className="mt-4 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Legal sources with matching source provenance</h3><PanelAction>{linkedSources.map((item) => <CaseContextLink key={item.id} kind="source" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Landmark aria-hidden="true" className="h-3.5 w-3.5" />{item.title}</CaseContextLink>)}</PanelAction></section>}
      <PanelAction><LinkRow href={twinRoute(`evidence:${evidence.id}`)}><Network aria-hidden="true" className="h-3.5 w-3.5" />Inspect evidence in the Living Twin</LinkRow><LinkRow href={guideRoute('evidence', evidence.id)}><BookOpenText aria-hidden="true" className="h-3.5 w-3.5" />Open Guide with this evidence</LinkRow></PanelAction>
    </>;
  }

  if (kind === 'document' && document) {
    const linkedEvidence = caseData.evidence.filter((item) => item.documentId === document.id);
    const linkedFacts = caseData.facts.filter((factItem) => factItem.provenance.some((sourceItem) => sourceItem.documentId === document.id) || linkedEvidence.some((evidenceItem) => factItem.sourceIds.includes(evidenceItem.id)));
    return <>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{document.filename}</p>
      <dl className="mt-5"><DataRow label="Review status">{humanize(document.reviewStatus)} · {humanize(document.processingStatus)}</DataRow><DataRow label="Document details">{document.pageCount} page{document.pageCount === 1 ? '' : 's'} · {document.mimeType} · {document.fileSize.toLocaleString()} bytes</DataRow></dl>
      {linkedEvidence.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Evidence records from this document</h3><PanelAction>{linkedEvidence.map((item) => <CaseContextLink key={item.id} kind="evidence" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{item.title}</CaseContextLink>)}</PanelAction></section>}
      {linkedFacts.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Facts with document provenance</h3><PanelAction>{linkedFacts.map((item) => <CaseContextLink key={item.id} kind="fact" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Check className="h-3.5 w-3.5" aria-hidden="true" />{humanize(item.key)}</CaseContextLink>)}</PanelAction></section>}
      <PanelAction><LinkRow href={documentRoute(document.id)}><FileText aria-hidden="true" className="h-3.5 w-3.5" />Open source page and findings</LinkRow><LinkRow href={twinRoute(`document-recorded:${document.id}`)}><Network aria-hidden="true" className="h-3.5 w-3.5" />Inspect document in the Living Twin</LinkRow></PanelAction>
    </>;
  }

  if (kind === 'issue' && issue) {
    return <>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{humanize(issue.subcategory ? `${issue.category} · ${issue.subcategory}` : issue.category)}</p>
      <dl className="mt-5"><DataRow label="Classification">Candidate · {humanize(issue.confidence)} confidence</DataRow><DataRow label="Returned rationale">{issue.rationale.length ? issue.rationale.join(' · ') : 'No rationale was returned with this candidate issue.'}</DataRow><DataRow label="Jurisdiction">{[caseData.jurisdiction.city, caseData.jurisdiction.district, caseData.jurisdiction.state, caseData.jurisdiction.country].filter(Boolean).join(', ') || caseData.jurisdiction.locationText || 'Not established'} · {humanize(caseData.jurisdiction.basis)}</DataRow></dl>
      {caseData.analysis?.legalKnowledge.records.length ? <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Candidate source records for this case</h3><p className="text-xs leading-5 text-slate-500">The case response does not provide an individual source-to-issue ID. These remain case-level candidate sources.</p><PanelAction>{caseData.analysis.legalKnowledge.records.map((item) => <CaseContextLink key={item.id} kind="source" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Landmark className="h-3.5 w-3.5" aria-hidden="true" />{item.title}</CaseContextLink>)}</PanelAction></section> : null}
      <PanelAction><LinkRow href={twinRoute(`legal_issue:${issue.id}`)}><Network aria-hidden="true" className="h-3.5 w-3.5" />Inspect candidate in the Living Twin</LinkRow><LinkRow href={guideRoute('issue', issue.id)}><BookOpenText aria-hidden="true" className="h-3.5 w-3.5" />Open Guide with this issue</LinkRow></PanelAction>
    </>;
  }

  if (kind === 'source' && source) {
    const location = [caseData.jurisdiction.city, caseData.jurisdiction.district, caseData.jurisdiction.state, caseData.jurisdiction.country].filter(Boolean).join(', ') || caseData.jurisdiction.locationText || 'Not established';
    const lawSteps = caseData.analysis?.journey.steps.filter((item) => item.stage === 'LAW') ?? [];
    const sourceUrl = source.sourceUrl || source.provenance.find((item) => item.sourceUrl)?.sourceUrl;
    const validatedUrl = (() => { try { const url = sourceUrl ? new URL(sourceUrl) : null; return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; } catch { return null; } })();
    const twinType = ['authority', 'legal_authority'].includes(source.type.toLocaleLowerCase()) ? 'authority' : ['procedure', 'legal_procedure'].includes(source.type.toLocaleLowerCase()) ? 'procedure' : null;
    return <>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{source.title}</p>
      <dl className="mt-5"><DataRow label="Source record">{humanize(source.type)} · {humanize(source.status)}</DataRow><DataRow label="Authority and jurisdiction">{source.authority || 'Authority not returned'} · {source.jurisdictionLabel || source.jurisdiction || 'Jurisdiction not returned'}</DataRow><DataRow label="Case jurisdiction">{location} · {humanize(caseData.jurisdiction.basis)}</DataRow><DataRow label="Verification and applicability">{humanize(source.sourceVerificationStatus)} · {humanize(source.sourceApplicabilityStatus)}</DataRow></dl>
      {lawSteps.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Journey implications · legal stage</h3><PanelAction>{lawSteps.map((item) => <CaseContextLink key={item.id} kind="journey" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Route className="h-3.5 w-3.5" aria-hidden="true" />{item.title || 'Legal grounding step'}</CaseContextLink>)}</PanelAction></section>}
      {caseData.legalIssues.length > 0 && <section className="mt-4 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Candidate issues in this case</h3><p className="text-[11px] leading-5 text-slate-500">The case does not return a direct source-to-issue ID link. These issue classifications remain candidates.</p><PanelAction>{caseData.legalIssues.map((item) => <CaseContextLink key={item.id} kind="issue" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Landmark className="h-3.5 w-3.5" aria-hidden="true" />{humanize(item.category)}</CaseContextLink>)}</PanelAction></section>}
      <PanelAction>{validatedUrl && <LinkRow href={validatedUrl} external><BookOpenText aria-hidden="true" className="h-3.5 w-3.5" />Open returned source</LinkRow>}{twinType && <CaseContextLink kind="twin" recordId={`${twinType}:${source.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/[0.1] dark:bg-white/[0.035] dark:text-slate-200 dark:hover:bg-white/[0.07]"><Network aria-hidden="true" className="h-3.5 w-3.5" />Inspect source connections in the Living Twin</CaseContextLink>}{twinType && <LinkRow href={twinRoute(`${twinType}:${source.id}`)}><Network aria-hidden="true" className="h-3.5 w-3.5" />Open full Living Twin</LinkRow>}</PanelAction>
    </>;
  }

  if (kind === 'journey' && step) {
    const actions = caseData.analysis?.journey.nextActions.filter((item) => item.stage === step.stage) ?? [];
    const relatedIds = new Set(step.relatedIds);
    const relatedEvidence = caseData.evidence.filter((item) => relatedIds.has(item.id));
    const relatedFacts = caseData.facts.filter((item) => relatedIds.has(item.id));
    const relatedIssues = caseData.legalIssues.filter((item) => relatedIds.has(item.id));
    const relatedDocuments = caseData.documents.filter((item) => relatedIds.has(item.id));
    return <>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.title || humanize(step.stage)}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{step.description || 'No description was returned for this journey step.'}</p>
      <dl className="mt-5"><DataRow label="Journey status">{humanize(step.status)} · {humanize(step.stage)}</DataRow></dl>
      {actions.length > 0 && <section className="mt-5 space-y-3"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Recorded next actions for this stage</h3>{actions.map((item) => <article key={item.id} className="rounded-xl border border-[#d7b27f]/30 bg-[#f7f0e7] p-3 dark:border-[#d7b27f]/15 dark:bg-[#d7b27f]/[0.05]"><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.action}</p>{item.reason && <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{item.reason}</p>}{item.condition && <p className="mt-1 text-[11px] leading-5 text-amber-800 dark:text-amber-200">Condition · {item.condition}</p>}</article>)}</section>}
      {(relatedEvidence.length + relatedFacts.length + relatedIssues.length + relatedDocuments.length > 0) && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Records named by this step</h3><PanelAction>{relatedFacts.map((item) => <CaseContextLink key={item.id} kind="fact" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Check className="h-3.5 w-3.5" aria-hidden="true" />{humanize(item.key)}</CaseContextLink>)}{relatedEvidence.map((item) => <CaseContextLink key={item.id} kind="evidence" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{item.title}</CaseContextLink>)}{relatedIssues.map((item) => <CaseContextLink key={item.id} kind="issue" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><Landmark className="h-3.5 w-3.5" aria-hidden="true" />{humanize(item.category)}</CaseContextLink>)}{relatedDocuments.map((item) => <LinkRow key={item.id} href={documentRoute(item.id)}>{item.filename}</LinkRow>)}</PanelAction></section>}
      <PanelAction><LinkRow href={buildCaseSurfaceHref(caseId, 'case') + `#journey-step-${encodeURIComponent(step.id)}`}><Route aria-hidden="true" className="h-3.5 w-3.5" />Open this step in the Journey plan</LinkRow>{step.stage === 'LAW' && <LinkRow href={guideRoute('journey', step.id)}><BookOpenText aria-hidden="true" className="h-3.5 w-3.5" />Open Guide with this step</LinkRow>}</PanelAction>
    </>;
  }

  if (kind === 'safety') {
    const sources = caseData.evidence.filter((item) => safety?.sourceIds.includes(item.id));
    return <>
      <div className="flex items-start gap-3 rounded-2xl border border-rose-300/25 bg-rose-50 p-4 dark:border-rose-300/15 dark:bg-rose-300/[0.045]"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-200" aria-hidden="true" /><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{safety && safety.context !== 'none' ? `${humanize(safety.context)} · ${humanize(safety.urgency)} urgency` : 'Safety information'}</p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{safety?.recommendedSafetyPrompt?.trim() || 'No safety prompt was returned with this case.'}</p></div></div>
      {safety?.indicators.length ? <dl className="mt-4">{safety.indicators.map((item, index) => <DataRow key={`${item.category}-${index}`} label={humanize(item.category)}>{humanize(item.confidence)} confidence · system inferred</DataRow>)}</dl> : null}
      {sources.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Case records cited by the safety context</h3><PanelAction>{sources.map((item) => <CaseContextLink key={item.id} kind="evidence" recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{item.title}</CaseContextLink>)}</PanelAction></section>}
      <PanelAction><LinkRow href={buildCaseSurfaceHref(caseId, 'safety')}><ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />Open safety options and support</LinkRow></PanelAction>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">This panel keeps your current case view in place. The safety page contains the case’s full optional support actions.</p>
    </>;
  }

  return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm leading-6 text-slate-500 dark:border-white/10">This record is not present in the current case state.</p>;
}

function TwinContext({ caseId, nodeId, twin, loading, error, caseData }: { caseId: string; nodeId: string | null; twin: LegalTwinSummary | null; loading: boolean; error: string | null; caseData: CaseState }) {
  if (loading) return <p role="status" className="text-sm text-slate-500">Opening the Living Twin record…</p>;
  if (error) return <p role="status" className="text-sm leading-6 text-amber-800 dark:text-amber-200">The Twin record could not be loaded. {error}</p>;
  const node = twin?.snapshot.nodes.find((item) => item.id === nodeId) ?? null;
  if (!node) return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm leading-6 text-slate-500 dark:border-white/10">The requested node is not present in the current Living Twin projection.</p>;

  const relatedNodeIds = new Set(twin!.snapshot.edges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id).map((edge) => edge.sourceId === node.id ? edge.targetId : edge.sourceId));
  const relatedNodes = twin!.snapshot.nodes.filter((item) => relatedNodeIds.has(item.id));
  const twinFocusHref = (id: string) => buildCaseSurfaceHref(caseId, 'twin', { focus: id });
  const connected: Array<{ kind: CaseContextKind; id: string; label: string; nodeId: string }> = [];
  for (const related of relatedNodes) {
    const target = resolveTwinNode(related, caseData);
    if (target) connected.push({ ...target, nodeId: related.id });
  }
  return <>
    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{node.label}</p>
    <dl className="mt-5"><DataRow label="Twin node">{humanize(node.kind)} · {humanize(node.status)}</DataRow><DataRow label="Graph connections">{relatedNodes.length} connected record{relatedNodes.length === 1 ? '' : 's'} returned by the Twin.</DataRow></dl>
    {connected.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Connected case records</h3><PanelAction>{connected.map((item) => <CaseContextLink key={item.nodeId} kind={item.kind} recordId={item.id} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</CaseContextLink>)}</PanelAction></section>}
    {node.provenance.length > 0 && <section className="mt-5 space-y-2"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Provenance returned by the Twin</h3>{node.provenance.map((item, index) => <p key={`${item.sourceId}-${index}`} className="rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-white/[0.07] dark:text-slate-400">{item.details || item.sourcePath} · {humanize(item.status)}</p>)}</section>}
    <PanelAction><LinkRow href={twinFocusHref(node.id)}><Network aria-hidden="true" className="h-3.5 w-3.5" />Open this node in the Living Twin</LinkRow></PanelAction>
  </>;
}

function resolveTwinNode(node: TwinNodeRecord, caseData: CaseState): { kind: CaseContextKind; id: string; label: string } | null {
  if (node.kind === 'EVIDENCE') {
    const id = node.id.startsWith('evidence:') ? node.id.slice(9) : '';
    const item = caseData.evidence.find((value) => value.id === id);
    return item ? { kind: 'evidence', id, label: item.title } : null;
  }
  if (node.kind === 'CLAIM' && node.properties.record_type === 'case_fact') {
    const id = node.id.startsWith('claim:fact:') ? node.id.slice(11) : '';
    const item = caseData.facts.find((value) => value.id === id);
    return item ? { kind: 'fact', id, label: humanize(item.key) } : null;
  }
  if (node.kind === 'LEGAL_ISSUE') {
    const id = node.id.startsWith('legal_issue:') ? node.id.slice(12) : '';
    const item = caseData.legalIssues.find((value) => value.id === id);
    return item ? { kind: 'issue', id, label: humanize(item.category) } : null;
  }
  if (node.kind === 'DOCUMENT' && node.id.startsWith('document-recorded:')) {
    const id = node.id.slice('document-recorded:'.length);
    const item = caseData.documents.find((value) => value.id === id);
    return item ? { kind: 'document', id, label: item.filename } : null;
  }
  if (node.kind === 'AUTHORITY' || node.kind === 'PROCEDURE') {
    const id = typeof node.properties.record_id === 'string' ? node.properties.record_id : '';
    const item = caseData.analysis?.legalKnowledge.records.find((value) => value.id === id);
    return item ? { kind: 'source', id, label: item.title } : null;
  }
  return null;
}

export function CaseContextPanel({ caseId }: CaseContextPanelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { caseState } = useCaseState();
  const kindValue = searchParams.get('context');
  const kind = (['fact', 'evidence', 'issue', 'source', 'journey', 'document', 'twin', 'safety'] as const).find((value) => value === kindValue) ?? null;
  const recordId = searchParams.get('record');
  const open = kind !== null;
  const panelRef = useRef<HTMLElement>(null);
  const panelContentRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [twin, setTwin] = useState<LegalTwinSummary | null>(null);
  const [twinError, setTwinError] = useState<string | null>(null);
  const [twinRequest, setTwinRequest] = useState(0);
  const title = useMemo(() => {
    if (kind === 'safety') return 'Safety context';
    if (!caseState || !recordId || !kind) return 'Case context';
    if (kind === 'fact') return `Fact · ${humanize(caseState.facts.find((item) => item.id === recordId)?.key)}`;
    if (kind === 'evidence') return `Evidence · ${caseState.evidence.find((item) => item.id === recordId)?.title ?? 'Record'}`;
    if (kind === 'document') return `Source page · ${caseState.documents.find((item) => item.id === recordId)?.filename ?? 'Document'}`;
    if (kind === 'issue') return `Candidate issue · ${humanize(caseState.legalIssues.find((item) => item.id === recordId)?.category)}`;
    if (kind === 'source') return `Legal source · ${caseState.analysis?.legalKnowledge.records.find((item) => item.id === recordId)?.title ?? 'Record'}`;
    if (kind === 'journey') return `Journey · ${caseState.analysis?.journey.steps.find((item) => item.id === recordId)?.title ?? 'Step'}`;
    return 'Living Twin node';
  }, [caseState, kind, recordId]);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('context');
    params.delete('record');
    const query = params.toString();
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(`${pathname}${query ? `?${query}` : ''}${hash}`, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    panelContentRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    panelRef.current?.focus({ preventScroll: true });
  }, [kind, open, recordId, reducedMotion]);

  useEffect(() => {
    if (!open || kind !== 'twin' || !recordId) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      setTwinError(null);
      return getLegalTwin(caseId, controller.signal);
    }).then((result) => {
      if (result && !controller.signal.aborted) setTwin(result);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setTwinError(error instanceof Error ? error.message : 'The Twin service did not return this record.');
    });
    return () => controller.abort();
  }, [caseId, kind, open, recordId, twinRequest]);

  return <AnimatePresence initial={false}>
    {open && <>
      <motion.button type="button" aria-label="Close case context" onClick={close} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }} className="fixed inset-0 z-[90] cursor-default bg-slate-950/35 backdrop-blur-[2px]" />
      <motion.aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="case-context-title" initial={reducedMotion ? false : { x: '100%', opacity: 0.75 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.75 }} transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 36 }} className="fixed inset-y-0 right-0 z-[91] flex w-full max-w-[min(36rem,100vw)] flex-col border-l border-slate-200 bg-[#fbfcfe] shadow-[-24px_0_80px_rgba(9,16,26,0.28)] outline-none dark:border-white/[0.08] dark:bg-[#101722]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-white/[0.08] sm:px-7">
          <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#947044] dark:text-[#e9bd7b]">Case context · stays with your workspace</p><h2 id="case-context-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-900 dark:text-slate-100">{title}</h2>{caseState?.title && <p className="mt-1 truncate text-xs text-slate-500">{caseState.title}</p>}</div>
          <button type="button" onClick={close} aria-label="Close case context" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a77b49] dark:border-white/[0.1] dark:bg-white/[0.035] dark:text-slate-200 dark:hover:bg-white/[0.08]"><X aria-hidden="true" className="h-4 w-4" /></button>
        </header>
        <div ref={panelContentRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {!caseState ? <p role="status" className="text-sm text-slate-500">Case details are loading.</p> : kind === 'twin' ? <TwinContext caseId={caseId} nodeId={recordId} twin={twin} loading={Boolean(recordId && !twin && !twinError)} error={twinError} caseData={caseState} /> : kind ? <ContextBody caseData={caseState} kind={kind} recordId={recordId} caseId={caseId} /> : null}
          {kind === 'twin' && twinError && <button type="button" onClick={() => { setTwin(null); setTwinRequest((value) => value + 1); }} className="mt-3 min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300">Try again</button>}
          {kind && kind !== 'safety' && <p className="mt-6 flex items-start gap-2 border-t border-slate-200 pt-4 text-[10px] leading-5 text-slate-500 dark:border-white/[0.07]"><CircleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />Connections shown here come from IDs and relationships returned with this case. Candidate legal sources and inferred context are labeled as such.</p>}
        </div>
      </motion.aside>
    </>}
  </AnimatePresence>;
}
