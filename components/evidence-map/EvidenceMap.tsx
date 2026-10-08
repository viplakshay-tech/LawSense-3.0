'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  CircleHelp,
  Clock3,
  FileCheck2,
  FileText,
  Link2,
  MessageSquareText,
  Network,
  Scale,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import type { CaseState } from '@/lib/api';
import { buildEvidenceMap, mapStatusForDisplay } from './model';
import type { EvidenceMapLayer, EvidenceMapNode, EvidenceMapPath, EvidenceMapRelationship, EvidenceMapStatus } from './types';

const STATUS_STYLES: Record<EvidenceMapStatus, { pill: string; dot: string; glow: string }> = {
  'evidence-supported': { pill: 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100', dot: 'bg-emerald-300', glow: 'shadow-[0_0_22px_rgba(110,231,183,0.08)]' },
  'user-reported': { pill: 'border-sky-300/25 bg-sky-300/[0.08] text-sky-100', dot: 'bg-sky-300', glow: 'shadow-[0_0_22px_rgba(125,211,252,0.07)]' },
  'review-confirmed': { pill: 'border-teal-300/25 bg-teal-300/[0.08] text-teal-100', dot: 'bg-teal-300', glow: '' },
  pending: { pill: 'border-amber-300/25 bg-amber-300/[0.08] text-amber-100', dot: 'bg-amber-300', glow: 'shadow-[0_0_22px_rgba(252,211,77,0.07)]' },
  unknown: { pill: 'border-slate-300/15 bg-white/[0.035] text-slate-300', dot: 'bg-slate-400', glow: '' },
  conflict: { pill: 'border-rose-300/25 bg-rose-300/[0.08] text-rose-100', dot: 'bg-rose-300', glow: 'shadow-[0_0_22px_rgba(253,164,175,0.07)]' },
  'system-inferred': { pill: 'border-violet-300/25 bg-violet-300/[0.08] text-violet-100', dot: 'bg-violet-300', glow: '' },
  assumption: { pill: 'border-orange-300/25 bg-orange-300/[0.08] text-orange-100', dot: 'bg-orange-300', glow: '' },
};

const LAYER_LABELS: Record<EvidenceMapLayer, string> = {
  'claim-fact': 'Claim / fact',
  evidence: 'Evidence record',
  'case-intake': 'Case intake · user-reported',
  document: 'Document',
  finding: 'Page / finding',
  confirmation: 'Confirmation status',
};

const STATUS_FILTERS: Array<{ value: EvidenceMapStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All links' },
  { value: 'evidence-supported', label: 'Evidence-supported' },
  { value: 'review-confirmed', label: 'Review-confirmed' },
  { value: 'user-reported', label: 'User-reported' },
  { value: 'pending', label: 'Pending' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'conflict', label: 'Conflicting' },
  { value: 'system-inferred', label: 'System-inferred' },
  { value: 'assumption', label: 'Assumption' },
];

function IconForLayer({ layer }: { layer: EvidenceMapLayer }) {
  const Icon = layer === 'claim-fact' ? BookOpenCheck
    : layer === 'evidence' ? Scale
      : layer === 'case-intake' ? MessageSquareText
      : layer === 'document' ? FileText
        : layer === 'finding' ? FileCheck2
          : layer === 'confirmation' ? UserRound
            : CircleHelp;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5" />;
}

function StatusBadge({ status, compact = false }: { status: EvidenceMapStatus; compact?: boolean }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 font-medium ${style.pill} ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {mapStatusForDisplay(status)}
    </span>
  );
}

function NodeCard({
  node,
  selected,
  onSelect,
}: {
  node: EvidenceMapNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = STATUS_STYLES[node.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${LAYER_LABELS[node.layer]}: ${node.title}. Status: ${mapStatusForDisplay(node.status)}. Select relationship details.`}
      className={`group flex min-h-[112px] w-full flex-col rounded-xl border p-3 text-left transition duration-200 motion-reduce:transition-none ${selected ? `border-[#e9bd7b]/45 bg-[#e9bd7b]/[0.07] ${style.glow}` : `border-white/[0.08] bg-[#111a26] hover:border-white/[0.16] ${style.glow}`}`}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          <IconForLayer layer={node.layer} />
          <span>{LAYER_LABELS[node.layer]}</span>
        </span>
        <span className="shrink-0"><StatusBadge status={node.status} compact /></span>
      </span>
      <span className="mt-3 line-clamp-2 text-xs font-semibold leading-[1.5] text-slate-100">{node.title}</span>
      <span className="mt-1 line-clamp-2 text-[10px] leading-[1.5] text-slate-500">{node.detail}</span>
    </button>
  );
}

function RelationshipButton({
  relationship,
  selected,
  onClick,
}: {
  relationship: EvidenceMapRelationship;
  selected: boolean;
  onClick: () => void;
}) {
  const style = STATUS_STYLES[relationship.status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${relationship.from.title} to ${relationship.to.title}: ${relationship.label}. ${mapStatusForDisplay(relationship.status)}. Show why this relationship exists and its provenance.`}
      aria-pressed={selected}
      title={`${relationship.label} · ${mapStatusForDisplay(relationship.status)}`}
      className={`group flex h-full min-h-[112px] w-full flex-col items-center justify-center gap-2 rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none ${selected ? 'bg-white/[0.045]' : 'hover:bg-white/[0.025]'}`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-full border transition duration-200 motion-reduce:transition-none ${selected ? 'scale-110 border-[#e9bd7b]/40 bg-[#e9bd7b]/10 text-[#f1cc97]' : `border-white/[0.09] bg-white/[0.025] text-slate-500 group-hover:border-white/[0.18] group-hover:text-slate-200`} ${style.glow}`}>
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      <span className={`max-w-[48px] line-clamp-2 text-center text-[8px] leading-3 ${selected ? 'text-[#e9bd7b]' : 'text-slate-600'}`}>
        {relationship.label}
      </span>
    </button>
  );
}

function SearchablePath({ path, search }: { path: EvidenceMapPath; search: string }): boolean {
  if (!search.trim()) return true;
  const query = search.trim().toLocaleLowerCase();
  return path.nodes.some((item) => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(query))
    || path.relationships.some((item) => `${item.label} ${item.reason} ${item.provenance.join(' ')}`.toLocaleLowerCase().includes(query));
}

function pathStatus(path: EvidenceMapPath): EvidenceMapStatus {
  if (path.relationships.some((item) => item.status === 'conflict')) return 'conflict';
  if (path.relationships.some((item) => item.status === 'pending')) return 'pending';
  if (path.relationships.some((item) => item.status === 'evidence-supported')) return 'evidence-supported';
  if (path.relationships.some((item) => item.status === 'user-reported')) return 'user-reported';
  if (path.relationships.some((item) => item.status === 'system-inferred')) return 'system-inferred';
  if (path.relationships.some((item) => item.status === 'assumption')) return 'assumption';
  return 'unknown';
}

function pathHasStatus(path: EvidenceMapPath, status: EvidenceMapStatus): boolean {
  return pathStatus(path) === status
    || path.nodes.some((item) => item.status === status)
    || path.relationships.some((item) => item.status === status);
}

function timestamp(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function RelationshipInspector({
  relationship,
  onOpenSource,
}: {
  relationship: EvidenceMapRelationship;
  onOpenSource: (relationship: EvidenceMapRelationship) => void;
}) {
  const date = relationship.to.layer === 'confirmation' ? timestamp(relationship.to.confirmedAt) : null;
  const sourceIsDocument = relationship.focus != null;
  const needsReview = relationship.status === 'pending'
    || ['unknown', 'assumption', 'system-inferred'].includes(relationship.to.status);
  const canConfirm = relationship.status === 'pending' && relationship.focus != null;
  return (
    <motion.aside
      key={relationship.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      aria-live="polite"
      aria-label="Selected relationship details"
      className="rounded-2xl border border-[#e9bd7b]/15 bg-[linear-gradient(125deg,rgba(233,189,123,0.06),rgba(255,255,255,0.015)_65%)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#e9bd7b]/70">Selected relationship</p>
          <h3 className="mt-1 text-sm font-semibold leading-6 text-slate-100">{relationship.from.title} <span className="text-[#e9bd7b]">→</span> {relationship.to.title}</h3>
        </div>
        <StatusBadge status={relationship.status} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-end">
        <div>
          <h4 className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">Why this relationship exists</h4>
          <p className="mt-1.5 text-xs leading-5 text-slate-300">{relationship.reason}</p>
        </div>
        <div>
          <h4 className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">Recorded provenance</h4>
          {relationship.provenance.length ? (
            <ul className="mt-1.5 space-y-1 text-[10px] leading-4 text-slate-400">
              {relationship.provenance.map((item, index) => <li key={`${relationship.id}:provenance:${index}`} className="flex gap-1.5"><span aria-hidden="true" className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#e9bd7b]/75" />{item}</li>)}
              {date && <li>Confirmation time {date}</li>}
            </ul>
          ) : (
            <p className="mt-1.5 text-[10px] leading-4 text-slate-500">The case record did not supply additional provenance details.</p>
          )}
        </div>
        {sourceIsDocument && (
          <button
            type="button"
            onClick={() => onOpenSource(relationship)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#e9bd7b]/25 bg-[#e9bd7b]/[0.08] px-3 text-[10px] font-semibold text-[#f1d4a8] transition hover:bg-[#e9bd7b]/[0.13] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
          >
            {canConfirm ? 'Review / confirm extraction' : needsReview ? 'Review source' : 'Open source'} <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-4 flex items-start gap-2 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-slate-500">
        <ShieldAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200/70" />
        User confirmation records a review of the extraction. It does not establish that the document is authentic or that its contents are true.
      </p>
    </motion.aside>
  );
}

export function EvidenceMap({
  caseState,
  caseId,
  onOpenSource,
}: {
  caseState: CaseState;
  caseId: string;
  onOpenSource: (relationship: EvidenceMapRelationship) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const paths = useMemo(() => buildEvidenceMap(caseState), [caseState]);
  const [statusFilter, setStatusFilter] = useState<EvidenceMapStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const displayedPaths = paths.filter((path) =>
    (statusFilter === 'all' || pathHasStatus(path, statusFilter))
    && SearchablePath({ path, search }),
  );
  const firstVisibleRelationship = displayedPaths[0]?.relationships[0] ?? null;
  const selectedRelationship = displayedPaths.flatMap((path) => path.relationships).find((item) => item.id === selectedId)
    ?? firstVisibleRelationship;
  const transition = shouldReduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 300, damping: 28 };
  const caseBase = `/case/${encodeURIComponent(caseId)}`;
  const headers = [
    { label: 'Claim / fact', icon: BookOpenCheck },
    { label: 'Source record', icon: MessageSquareText },
    { label: 'Document', icon: FileText },
    { label: 'Page / finding', icon: FileCheck2 },
    { label: 'Confirmation status', icon: UserRound },
  ];

  function selectNode(path: EvidenceMapPath, index: number) {
    const adjacent = path.relationships[Math.min(index, path.relationships.length - 1)];
    if (adjacent) setSelectedId(adjacent.id);
  }

  return (
    <section id="evidence-map" aria-labelledby="evidence-map-heading" className="overflow-hidden rounded-[1.5rem] border border-white/[0.075] bg-[#0c121b] text-slate-100 shadow-[0_24px_80px_rgba(4,9,16,0.2)]">
      <div className="border-b border-white/[0.07] bg-[radial-gradient(ellipse_at_84%_0%,rgba(233,189,123,0.13),transparent_42%),linear-gradient(115deg,rgba(23,34,48,0.68),rgba(12,18,27,0.3)_68%)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#e9bd7b]/75">Case record · Evidence view 2.0</p>
            <h1 id="evidence-map-heading" className="mt-2 text-xl font-semibold tracking-[-0.02em] text-white sm:text-2xl">Evidence Map</h1>
            <p className="mt-2 text-xs leading-5 text-slate-400">Follow the recorded links from a claim or fact through its source, document, page, and review status.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Related case workspaces">
            <Link href={`${caseBase}/guide`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.025] px-2.5 text-[10px] font-medium text-slate-300 transition hover:border-white/[0.16] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none">
              <Scale aria-hidden="true" className="h-3.5 w-3.5" /> Legal Grounding
            </Link>
            <Link href={`${caseBase}/twin`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.025] px-2.5 text-[10px] font-medium text-slate-300 transition hover:border-white/[0.16] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none">
              <Network aria-hidden="true" className="h-3.5 w-3.5" /> Living Twin
            </Link>
            <Link href={`${caseBase}/guide`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.025] px-2.5 text-[10px] font-medium text-slate-300 transition hover:border-white/[0.16] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none">
              <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" /> Guide
            </Link>
          </div>
        </div>

        <p className="mt-5 flex max-w-4xl items-start gap-2 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5 text-[10px] leading-4 text-slate-400">
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200/75" />
          Status describes what this case record says. Evidence-supported means the record links a source to a detail; user confirmation of an extraction does not verify document authenticity or truth.
        </p>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter evidence relationships by status">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={statusFilter === item.value}
                onClick={() => setStatusFilter(item.value)}
                className={`min-h-11 rounded-full border px-2.5 text-[9px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none ${statusFilter === item.value ? 'border-[#e9bd7b]/30 bg-[#e9bd7b]/[0.09] text-[#f4d7a9]' : 'border-white/[0.08] bg-white/[0.02] text-slate-500 hover:text-slate-200'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="relative block w-full xl:max-w-[17rem]">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <span className="sr-only">Search claims, sources, and provenance</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search the map"
              className="min-h-9 w-full rounded-lg border border-white/[0.08] bg-black/15 pl-9 pr-3 text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-[#e9bd7b]/30 focus:outline-none focus:ring-1 focus:ring-[#e9bd7b]/20"
            />
          </label>
        </div>

        <div className="-mx-1 overflow-x-auto px-1 pb-2" role="region" aria-label="Interactive evidence relationships; scroll horizontally to inspect each layer" tabIndex={0}>
          <div className="min-w-[1160px]">
            <div className="grid grid-cols-[minmax(180px,1fr)_42px_minmax(180px,1fr)_42px_minmax(180px,1fr)_42px_minmax(180px,1fr)_42px_minmax(180px,1fr)] items-center gap-1.5 pb-2">
              {headers.map(({ label, icon: Icon }, index) => (
                <div key={label} style={{ gridColumnStart: index * 2 + 1 }} className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-[#e9bd7b]/70"><Icon aria-hidden="true" className="h-3.5 w-3.5" /></span>
                  <span className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <AnimatePresence initial={false} mode="popLayout">
                {displayedPaths.map((path) => {
                  const active = path.relationships.some((item) => item.id === selectedRelationship?.id);
                  return (
                    <motion.div
                      key={path.id}
                      layout
                      initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                      transition={transition}
                      className={`grid grid-cols-[minmax(180px,1fr)_42px_minmax(180px,1fr)_42px_minmax(180px,1fr)_42px_minmax(180px,1fr)_42px_minmax(180px,1fr)] items-stretch gap-1.5 rounded-2xl border p-2 ${active ? 'border-[#e9bd7b]/12 bg-[#e9bd7b]/[0.018]' : 'border-white/[0.045] bg-black/[0.06]'}`}
                    >
                      {path.nodes.map((item, index) => (
                        <div key={item.id} style={{ gridColumnStart: index * 2 + 1, gridRowStart: 1 }}>
                          <NodeCard
                            node={item}
                            selected={path.relationships.some((edge) => edge.id === selectedRelationship?.id && (edge.from.id === item.id || edge.to.id === item.id))}
                            onSelect={() => selectNode(path, index)}
                          />
                        </div>
                      ))}
                      {path.relationships.map((edge, index) => (
                        <div key={edge.id} style={{ gridColumnStart: index * 2 + 2, gridRowStart: 1 }}>
                          <RelationshipButton relationship={edge} selected={selectedRelationship?.id === edge.id} onClick={() => setSelectedId(edge.id)} />
                        </div>
                      ))}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
          {displayedPaths.length === 0 && (
            <div className="mx-auto max-w-xl rounded-xl border border-dashed border-white/[0.1] px-4 py-7 text-center">
              <Search aria-hidden="true" className="mx-auto h-4 w-4 text-slate-500" />
              <p className="mt-2 text-xs font-medium text-slate-300">No map links match this view</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">Clear the search or choose a different status filter.</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
          <p className="flex items-center gap-1.5 text-[9px] text-slate-500"><Link2 aria-hidden="true" className="h-3 w-3" />{displayedPaths.length} recorded relationship path{displayedPaths.length === 1 ? '' : 's'} · choose an arrow to inspect its provenance</p>
          <p className="flex items-center gap-1.5 text-[9px] text-slate-600"><Clock3 aria-hidden="true" className="h-3 w-3" />Changes in the case record animate into or out of the map</p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {selectedRelationship && <RelationshipInspector key={selectedRelationship.id} relationship={selectedRelationship} onOpenSource={onOpenSource} />}
        </AnimatePresence>
      </div>
    </section>
  );
}
