'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  CircleHelp,
  Clock3,
  FileText,
  GitBranch,
  Landmark,
  LoaderCircle,
  Pause,
  Play,
  Scale,
  UserRound,
  UsersRound,
  Waypoints,
} from 'lucide-react';
import {
  getLegalTwin,
  getTwinSnapshot,
  type CaseState,
  type ConfidenceLevel,
  type EvidenceItem,
  type InformationStatus,
  type LegalTwinSummary,
  type TwinNodeRecord,
  type TwinProvenance,
  type TwinSnapshotSummary,
  type TwinTimelineEvent,
} from '@/lib/api';
import { LegalSourceCandidates } from '@/components/LegalSourceCandidates';
import { TrustNotice } from '@/components/TrustNotice';
import { useCaseState } from '../CaseStateProvider';
import type { PointerEvent, ReactNode } from 'react';

type TwinKind =
  | 'person'
  | 'party'
  | 'event'
  | 'fact'
  | 'claim'
  | 'evidence'
  | 'document'
  | 'issue'
  | 'procedure'
  | 'authority'
  | 'action';

type TwinNode = {
  id: string;
  kind: TwinKind;
  title: string;
  subtitle: string;
  summary: string;
  status?: InformationStatus;
  statusLabel?: string;
  legalStatusDetails?: Array<{ label: string; value: string }>;
  confidence?: ConfidenceLevel;
  references: string[];
  provenance: TwinProvenance[];
  depth: number;
  unresolved?: boolean;
  temporallyUncertain?: boolean;
  date?: string | null;
  datePrecision?: TwinTimelineEvent['datePrecision'];
};

type TwinEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  status: InformationStatus;
  provenance: TwinProvenance[];
};

const KIND_ORDER: TwinKind[] = [
  'person',
  'party',
  'event',
  'fact',
  'claim',
  'evidence',
  'document',
  'issue',
  'procedure',
  'authority',
  'action',
];

const KIND_LABELS: Record<TwinKind, string> = {
  person: 'People',
  party: 'Parties',
  event: 'Events',
  fact: 'Facts',
  claim: 'Claims',
  evidence: 'Evidence',
  document: 'Documents',
  issue: 'Legal issues',
  procedure: 'Procedures',
  authority: 'Authorities',
  action: 'Actions',
};

const KIND_STYLES: Record<TwinKind, { icon: typeof UserRound; dot: string; tint: string; border: string }> = {
  person: { icon: UserRound, dot: 'bg-amber-300', tint: 'text-amber-200 bg-amber-300/10', border: 'border-amber-300/30' },
  party: { icon: UsersRound, dot: 'bg-rose-300', tint: 'text-rose-200 bg-rose-300/10', border: 'border-rose-300/30' },
  event: { icon: Clock3, dot: 'bg-sky-300', tint: 'text-sky-200 bg-sky-300/10', border: 'border-sky-300/30' },
  fact: { icon: FileText, dot: 'bg-indigo-300', tint: 'text-indigo-200 bg-indigo-300/10', border: 'border-indigo-300/30' },
  claim: { icon: Scale, dot: 'bg-emerald-300', tint: 'text-emerald-200 bg-emerald-300/10', border: 'border-emerald-300/30' },
  evidence: { icon: FileText, dot: 'bg-cyan-300', tint: 'text-cyan-200 bg-cyan-300/10', border: 'border-cyan-300/30' },
  document: { icon: FileText, dot: 'bg-orange-300', tint: 'text-orange-200 bg-orange-300/10', border: 'border-orange-300/30' },
  issue: { icon: Landmark, dot: 'bg-violet-300', tint: 'text-violet-200 bg-violet-300/10', border: 'border-violet-300/30' },
  procedure: { icon: GitBranch, dot: 'bg-zinc-400', tint: 'text-zinc-300 bg-zinc-300/10', border: 'border-zinc-400/30' },
  authority: { icon: Landmark, dot: 'bg-cyan-300', tint: 'text-cyan-200 bg-cyan-300/10', border: 'border-cyan-300/30' },
  action: { icon: ArrowUpRight, dot: 'bg-lime-300', tint: 'text-lime-200 bg-lime-300/10', border: 'border-lime-300/30' },
};

const STATUS_STYLES: Record<InformationStatus, string> = {
  user_reported: 'border-slate-500/60 bg-slate-800/70 text-slate-200',
  evidence_supported: 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300',
  system_inferred: 'border-indigo-500/40 bg-indigo-950/60 text-indigo-200',
  assumption: 'border-amber-500/50 border-dashed bg-amber-950/50 text-amber-200',
  conflicting: 'border-rose-500/50 bg-rose-950/60 text-rose-200',
  unknown: 'border-zinc-700/70 bg-zinc-900/80 text-zinc-400',
};

const STATUS_LABELS: Record<InformationStatus, string> = {
  user_reported: 'User reported',
  evidence_supported: 'Evidence supported',
  system_inferred: 'System inferred',
  assumption: 'Assumption',
  conflicting: 'Conflicting',
  unknown: 'Unknown',
};

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value recorded.';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No value recorded.';
  try {
    return JSON.stringify(value) ?? 'Value could not be displayed.';
  } catch {
    return 'Value could not be displayed.';
  }
}

function textProperty(record: TwinNodeRecord, key: string): string | null {
  const value = record.properties[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function legalStatusDetails(record: TwinNodeRecord): Array<{ label: string; value: string }> {
  const details = [
    ['Catalog record status', 'knowledge_status'],
    ['Source identity verification', 'source_verification_status'],
    ['Source freshness', 'source_freshness_status'],
    ['Case applicability', 'source_applicability_status'],
  ] as const;

  return details.map(([label, key]) => ({
    label,
    value: humanize(textProperty(record, key) ?? 'not established'),
  }));
}

function stringListProperty(record: TwinNodeRecord, key: string): string[] {
  const value = record.properties[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function confidenceProperty(record: TwinNodeRecord): ConfidenceLevel | undefined {
  const value = record.properties.confidence;
  return value === 'high' || value === 'medium' || value === 'low' || value === 'unknown'
    ? value
    : undefined;
}

function viewKind(record: TwinNodeRecord): TwinKind {
  switch (record.kind) {
    case 'PERSON': return 'person';
    case 'PARTY': return 'party';
    case 'EVENT': return 'event';
    case 'CLAIM': return record.properties.record_type === 'case_fact' ? 'fact' : 'claim';
    case 'DOCUMENT': return 'document';
    case 'EVIDENCE': return 'evidence';
    case 'LEGAL_ISSUE': return 'issue';
    case 'PROCEDURE': return 'procedure';
    case 'AUTHORITY': return 'authority';
    case 'ACTION': return 'action';
  }
}

function relationLabel(kind: string): string {
  const labels: Record<string, string> = {
    INVOLVES: 'involves',
    OCCURRED_AT: 'occurred at',
    SUPPORTS: 'supports',
    CONTRADICTS: 'conflicts with',
    REFERENCES: 'references',
    RELATES_TO: 'relates to',
    APPLIES_TO: 'applies to',
    LEADS_TO: 'leads to',
    PROCEDURE_AVAILABLE_AT_AUTHORITY: 'available at',
  };
  return labels[kind] ?? humanize(kind);
}

function depthForKind(kind: TwinKind): number {
  if (kind === 'person' || kind === 'party' || kind === 'authority') return 26;
  if (kind === 'event' || kind === 'issue' || kind === 'procedure') return 8;
  return -12;
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getReducedMotionSnapshot(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function getProjectionChanges(previous: TwinSnapshotSummary, next: TwinSnapshotSummary) {
  const previousRecords = new Map<string, string>();
  const nextRecords = new Map<string, string>();
  previous.nodes.forEach((node) => previousRecords.set(`node:${node.id}`, JSON.stringify({
    kind: node.kind,
    label: node.label,
    status: node.status,
    properties: node.properties,
    provenance: node.provenance,
    occurredAt: node.occurredAt,
    recordedAt: node.recordedAt,
  })));
  previous.edges.forEach((edge) => previousRecords.set(`edge:${edge.id}`, JSON.stringify({
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    kind: edge.kind,
    status: edge.status,
    provenance: edge.provenance,
    recordedAt: edge.recordedAt,
  })));
  next.nodes.forEach((node) => nextRecords.set(`node:${node.id}`, JSON.stringify({
    kind: node.kind,
    label: node.label,
    status: node.status,
    properties: node.properties,
    provenance: node.provenance,
    occurredAt: node.occurredAt,
    recordedAt: node.recordedAt,
  })));
  next.edges.forEach((edge) => nextRecords.set(`edge:${edge.id}`, JSON.stringify({
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    kind: edge.kind,
    status: edge.status,
    provenance: edge.provenance,
    recordedAt: edge.recordedAt,
  })));

  const changedRecordIds = new Set<string>();
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [recordKey, signature] of nextRecords) {
    const previousSignature = previousRecords.get(recordKey);
    if (previousSignature === undefined) {
      added += 1;
      changedRecordIds.add(recordKey);
    } else if (previousSignature !== signature) {
      changed += 1;
      changedRecordIds.add(recordKey);
    }
  }
  for (const recordKey of previousRecords.keys()) {
    if (!nextRecords.has(recordKey)) removed += 1;
  }

  const changedNodeKeys = new Set([...changedRecordIds]
    .filter((recordKey) => recordKey.startsWith('node:'))
    .map((recordKey) => recordKey.slice(5)));
  const provenance = next.nodes
    .filter((node) => changedNodeKeys.has(node.id))
    .flatMap((node) => node.provenance)
    .filter((source) => source.sourcePath)
    .map((source) => source.details?.trim() || source.sourcePath);

  return {
    changedRecordIds,
    added,
    changed,
    removed,
    explanation: [...new Set(provenance)].slice(0, 2).join(' · '),
  };
}

function formatCaseDate(value: string | null | undefined): string {
  const parsed = timestamp(value);
  if (parsed === null) return 'Date not available';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed) + ' UTC';
}

function makeActionNodes(caseData: CaseState): TwinNode[] {
  const actions = caseData.analysis?.journey?.nextActions ?? [];
  const actionNodes = actions.map((item): TwinNode => ({
    id: `action:${item.id}`,
    kind: 'action',
    title: item.action,
    subtitle: `${humanize(item.stage)} · Suggested action`,
    summary: [item.reason, item.condition].filter(Boolean).join(' ') || 'No additional reason is recorded.',
    status: 'system_inferred',
    statusLabel: STATUS_LABELS.system_inferred,
    references: [],
    provenance: [{
      sourceId: caseData.id,
      sourceType: 'case_state',
      sourcePath: `analysis/journey/nextActions/${item.id}`,
      status: 'system_inferred',
      confirmedByUser: false,
      details: item.reason,
    }],
    depth: depthForKind('action'),
    temporallyUncertain: true,
  }));

  const decisionAction = caseData.analysis?.decisionScenario?.nextAction.trim();
  if (decisionAction && !actions.some((item) => item.action.trim() === decisionAction)) {
    const reason = caseData.analysis?.decisionScenario?.nextActionReason ?? '';
    actionNodes.push({
      id: `action:decision-scenario:${caseData.id}`,
      kind: 'action',
      title: decisionAction,
      subtitle: 'Decision scenario · Suggested action',
      summary: reason,
      status: 'system_inferred',
      references: [],
      provenance: [{
        sourceId: caseData.id,
      sourceType: 'case_state',
      sourcePath: 'analysis/decisionScenario/nextAction',
      status: 'system_inferred',
      confirmedByUser: false,
      details: reason || 'Action recorded in the CaseState decision scenario.',
      }],
      depth: depthForKind('action'),
      temporallyUncertain: true,
    });
  }

  return actionNodes;
}

function makeGraph(
  snapshot: TwinSnapshotSummary,
  caseData: CaseState | null,
  includeCurrentActions: boolean,
): { nodes: TwinNode[]; edges: TwinEdge[] } {
  const unresolvedNodeIds = new Set(snapshot.unresolvedNodeIds);
  const temporallyUncertainNodeIds = new Set(snapshot.temporallyUncertainNodeIds);
  const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const edges = snapshot.edges
    .filter((edge) => snapshotNodeIds.has(edge.sourceId) && snapshotNodeIds.has(edge.targetId))
    .map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    relation: relationLabel(edge.kind),
    status: edge.status,
    provenance: edge.provenance,
  }));
  const nodes = snapshot.nodes.map((record): TwinNode => {
    const kind = viewKind(record);
    const role = textProperty(record, 'role');
    const relationship = textProperty(record, 'relationship');
    const date = textProperty(record, 'date_value');
    const confidence = confidenceProperty(record);
    const linkedIds = edges
      .filter((edge) => edge.source === record.id || edge.target === record.id)
      .map((edge) => edge.source === record.id ? edge.target : edge.source);
    const recordType = textProperty(record, 'record_type');
    const value = record.properties.value;
    const isLegalKnowledgeRecord = kind === 'authority' || kind === 'procedure';
    const statusLabel = isLegalKnowledgeRecord
      ? `Catalog · ${humanize(textProperty(record, 'knowledge_status') ?? 'not established')}`
      : STATUS_LABELS[record.status];
    let subtitle = statusLabel;
    let summary = record.label;

    if (kind === 'person') {
      subtitle = textProperty(record, 'contact') ?? 'Person record';
      summary = record.provenance[0]?.details ?? 'Person record from the canonical CaseState.';
    } else if (kind === 'party') {
      subtitle = [role, relationship].filter(Boolean).map((item) => humanize(item!)).join(' · ') || statusLabel;
      summary = Object.keys(record.properties.attributes ?? {}).length
        ? `Recorded party attributes: ${safeValue(record.properties.attributes)}`
        : 'Party record from the canonical CaseState.';
    } else if (kind === 'event') {
      subtitle = date ?? 'Date not stated';
      summary = record.label;
    } else if (kind === 'fact') {
      subtitle = `Confidence · ${humanize(confidence ?? 'unknown')}`;
      summary = safeValue(value);
      if (textProperty(record, 'notes')) summary += ` ${textProperty(record, 'notes')}`;
    } else if (kind === 'claim') {
      subtitle = `${humanize(recordType ?? 'claim')} · ${statusLabel}`;
      summary = textProperty(record, 'text') ?? record.label;
    } else if (kind === 'evidence') {
      subtitle = [textProperty(record, 'evidence_type'), textProperty(record, 'source')]
        .filter(Boolean).map((item) => humanize(item!)).join(' · ');
      const processing = textProperty(record, 'processing_status');
      summary = processing ? `Processing status · ${humanize(processing)}` : `Evidence record · ${statusLabel}`;
    } else if (kind === 'document') {
      const processing = textProperty(record, 'processing_status');
      subtitle = processing ? `Document · ${humanize(processing)}` : 'Document record';
      summary = record.provenance[0]?.details ?? 'Document metadata recorded in CaseState.';
    } else if (kind === 'issue') {
      const category = textProperty(record, 'category');
      subtitle = confidence ? `Candidate issue · ${humanize(confidence)}` : statusLabel;
      summary = stringListProperty(record, 'rationale').join(' ') || category || record.label;
    } else {
      subtitle = statusLabel;
      summary = record.provenance[0]?.details ?? `${KIND_LABELS[kind]} record from the Legal Twin.`;
    }

    return {
      id: record.id,
      kind,
      title: record.label,
      subtitle,
      summary,
      status: record.status,
      statusLabel,
      ...(isLegalKnowledgeRecord ? { legalStatusDetails: legalStatusDetails(record) } : {}),
      confidence,
      references: linkedIds,
      provenance: record.provenance,
      depth: depthForKind(kind),
      unresolved: unresolvedNodeIds.has(record.id),
      temporallyUncertain: temporallyUncertainNodeIds.has(record.id),
      ...(kind === 'event' ? { date, datePrecision: textProperty(record, 'date_precision') as TwinTimelineEvent['datePrecision'] } : {}),
    };
  });
  return {
    nodes: [
      ...nodes,
      ...(caseData && includeCurrentActions
        ? makeActionNodes(caseData).filter((action) => !nodes.some((node) => node.id === action.id))
        : []),
    ],
    edges,
  };
}
function sourceLabel(source: EvidenceItem['source']): string {
  if (source === 'user') return 'User reported';
  if (source === 'document') return 'Uploaded document';
  return 'System';
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#384153] bg-[#111827]/65 px-4 py-5 text-sm leading-6 text-[#aeb9d0]">
      {children}
    </div>
  );
}

function CasePillar({
  number,
  title,
  icon: Icon,
  children,
}: {
  number: number;
  title: string;
  icon: typeof FileText;
  children: ReactNode;
}) {
  return (
    <article className="space-y-3 rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 shadow-[0_8px_20px_rgba(0,0,0,0.16)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#252a39] text-[#ffc174]">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="font-serif text-base font-semibold text-[#dee2f6]">{number}. {title}</h3>
        </div>
      </div>
      {children}
    </article>
  );
}

export default function LegalTwinClient({ id }: { id: string }) {
  const router = useRouter();
  const {
    caseState: caseData,
    loading: caseLoading,
    error: caseError,
    revision,
    refreshCaseState,
  } = useCaseState();
  const graphRef = useRef<HTMLDivElement>(null);
  const graphLayerRef = useRef<HTMLDivElement>(null);
  const lastAnimatedSnapshotRef = useRef<string | null>(null);
  const previousSnapshotRef = useRef<TwinSnapshotSummary | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const snapshotRequestRef = useRef(0);
  const graphDragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotation: { x: number; y: number };
  } | null>(null);
  const graphRotationRef = useRef({ x: -5, y: 0 });
  const [legalTwin, setLegalTwin] = useState<LegalTwinSummary | null>(null);
  const [snapshot, setSnapshot] = useState<TwinSnapshotSummary | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotRetryKey, setSnapshotRetryKey] = useState(0);
  const [twinError, setTwinError] = useState<{ message: string; revision: number } | null>(null);
  const [twinRetryKey, setTwinRetryKey] = useState(0);
  const [twinRevision, setTwinRevision] = useState(-1);
  const [selectedAsOf, setSelectedAsOf] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [changedRecordIds, setChangedRecordIds] = useState<Set<string>>(() => new Set());
  const [changeSummary, setChangeSummary] = useState<string | null>(null);
  const [filter, setFilter] = useState<TwinKind | 'all'>('all');
  const [isPlaying, setIsPlaying] = useState(false);
  const [graphWidth, setGraphWidth] = useState(0);
  const [graphColumns, setGraphColumns] = useState(2);
  const selectedAsOfRef = useRef(selectedAsOf);
  const legalTwinRef = useRef(legalTwin);
  const initialRevisionForCaseRef = useRef<{ caseId: string; revision: number } | null>(null);
  const hasCurrentCase = caseData?.id === id;
  const currentTwinError = twinError?.revision === revision ? twinError.message : null;
  const twinLoading = hasCurrentCase && twinRevision !== revision && !currentTwinError;
  const retryTwinRefresh = useCallback(() => {
    setTwinError(null);
    setTwinRetryKey((value) => value + 1);
  }, []);
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  useEffect(() => {
    selectedAsOfRef.current = selectedAsOf;
  }, [selectedAsOf]);

  useEffect(() => {
    legalTwinRef.current = legalTwin;
  }, [legalTwin]);

  const acceptProjection = useCallback((nextSnapshot: TwinSnapshotSummary, acceptedRevision: number) => {
    const previousSync = initialRevisionForCaseRef.current;
    const alreadySyncedThisRevision = previousSync?.caseId === nextSnapshot.caseId && previousSync.revision === acceptedRevision;
    if (!alreadySyncedThisRevision) {
      const previous = previousSnapshotRef.current;
      if (previous?.caseId === nextSnapshot.caseId) {
        const changes = getProjectionChanges(previous, nextSnapshot);
        setChangedRecordIds(changes.changedRecordIds);
        if (changes.added || changes.changed || changes.removed) {
          const parts = [
            changes.added ? `${changes.added} added` : '',
            changes.changed ? `${changes.changed} changed` : '',
            changes.removed ? `${changes.removed} removed` : '',
          ].filter(Boolean);
          setChangeSummary(`Updated from the saved CaseState · ${parts.join(', ')}.${changes.explanation ? ` Source detail: ${changes.explanation}` : ''}`);
        } else {
          setChangeSummary('Twin refreshed from the saved CaseState. The returned projection contains no graph record changes.');
        }
        if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setChangedRecordIds(new Set()), 2400);
      } else {
        setChangedRecordIds(new Set());
        setChangeSummary(null);
      }
      initialRevisionForCaseRef.current = { caseId: nextSnapshot.caseId, revision: acceptedRevision };
    }
    previousSnapshotRef.current = nextSnapshot;
  }, []);

  useEffect(() => {
    if (!hasCurrentCase) return;
    let mounted = true;
    const controller = new AbortController();
    const previousTwin = legalTwinRef.current;
    const previousSelection = selectedAsOfRef.current;
    const followsLatest = !previousTwin || previousSelection === null ||
      timestamp(previousSelection) === timestamp(previousTwin.snapshot.asOf);
    void getLegalTwin(id, controller.signal)
      .then((twin) => {
        if (!mounted || controller.signal.aborted) return;
        if (twin.caseId !== id) throw new Error('The Legal Twin response belongs to a different case.');
        setTwinError(null);
        setSnapshotError(null);
        setLegalTwin(twin);
        if (followsLatest) {
          acceptProjection(twin.snapshot, revision);
          setSnapshot(twin.snapshot);
          setSelectedAsOf(twin.snapshot.asOf);
        } else {
          setSnapshot(null);
        }
        setTwinRevision(revision);
      })
      .catch((loadError: unknown) => {
        if (mounted && !controller.signal.aborted) {
          setTwinError({
            message: loadError instanceof Error ? loadError.message : 'The Legal Twin could not be refreshed.',
            revision,
          });
        }
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [acceptProjection, hasCurrentCase, id, revision, twinRetryKey]);

  useEffect(() => {
    const element = graphRef.current;
    if (!element) return;
    const updateLayout = () => {
      const width = element.getBoundingClientRect().width;
      setGraphWidth((current) => current === width ? current : width);
      const columns = width >= 1120 ? 4 : width >= 760 ? 3 : 2;
      setGraphColumns((current) => current === columns ? current : columns);
    };
    const observer = new ResizeObserver(updateLayout);
    observer.observe(element);
    updateLayout();
    return () => observer.disconnect();
  }, []);

  const timelineEvents = useMemo(() => legalTwin?.timeline ?? [], [legalTwin?.timeline]);
  const datedEvents = useMemo(
    () => timelineEvents
      .filter((event) => event.datePrecision === 'exact' && timestamp(event.occurredAt) !== null)
      .sort((left, right) => (timestamp(left.occurredAt) ?? 0) - (timestamp(right.occurredAt) ?? 0)),
    [timelineEvents],
  );
  const datedMilestones = useMemo(() => {
    const eventsByTime = new Map<number, TwinTimelineEvent>();
    datedEvents.forEach((event) => {
      const eventTime = timestamp(event.occurredAt);
      if (eventTime !== null) eventsByTime.set(eventTime, event);
    });
    return [...eventsByTime].map(([at, event]) => ({ at, event }));
  }, [datedEvents]);
  const unresolvedTimelineEvents = useMemo(
    () => {
      const datedIds = new Set(datedEvents.map((event) => event.id));
      return timelineEvents.filter((event) => !datedIds.has(event.id));
    },
    [datedEvents, timelineEvents],
  );
  const selectedTimestamp = timestamp(selectedAsOf);
  const datedTimestamps = datedEvents.flatMap((event) => {
    const value = timestamp(event.occurredAt);
    return value === null ? [] : [value];
  });
  const snapshotTimestamp = timestamp(legalTwin?.snapshot.asOf);
  const snapshotHasMilestone = snapshotTimestamp !== null && datedTimestamps.includes(snapshotTimestamp);
  const availableTimestamps = snapshotTimestamp === null ? datedTimestamps : [...datedTimestamps, snapshotTimestamp];
  const rangeMinimum = datedTimestamps.length ? Math.min(...availableTimestamps) : null;
  const rangeMaximum = datedTimestamps.length
    ? Math.max(...availableTimestamps)
    : null;
  const rangeStep = rangeMinimum !== null && rangeMaximum !== null && rangeMaximum > rangeMinimum
    ? Math.max(1, Math.floor((rangeMaximum - rangeMinimum) / 240))
    : 1;
  const activeEvent = selectedTimestamp === null
    ? null
    : datedEvents.reduce<TwinTimelineEvent | null>((latest, event) => {
      const eventTime = timestamp(event.occurredAt);
      return eventTime !== null && eventTime <= selectedTimestamp ? event : latest;
    }, null);

  useEffect(() => {
    if (!selectedAsOf || !id || !legalTwin || twinRevision !== revision) return;
    const selectedTime = timestamp(selectedAsOf);
    if (selectedTime === null || timestamp(snapshot?.asOf) === selectedTime) return;

    let cancelled = false;
    const requestNumber = ++snapshotRequestRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getTwinSnapshot(id, selectedAsOf, controller.signal)
        .then((nextSnapshot) => {
          if (cancelled || requestNumber !== snapshotRequestRef.current) return;
          if (nextSnapshot.caseId !== id || timestamp(nextSnapshot.asOf) !== selectedTime) {
            throw new Error('The snapshot response did not match the requested case and date.');
          }
          acceptProjection(nextSnapshot, revision);
          setSnapshot(nextSnapshot);
        })
        .catch((snapshotLoadError) => {
          if (!cancelled && !controller.signal.aborted && requestNumber === snapshotRequestRef.current) {
            setSnapshotError(snapshotLoadError instanceof Error ? snapshotLoadError.message : 'The snapshot could not be loaded.');
          }
        });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [acceptProjection, id, legalTwin, revision, selectedAsOf, snapshot?.asOf, snapshotRetryKey, twinRevision]);

  const snapshotMatchesDate = twinRevision === revision && selectedTimestamp !== null && timestamp(snapshot?.asOf) === selectedTimestamp;
  const includeCurrentActions = snapshotMatchesDate && snapshotTimestamp !== null && selectedTimestamp === snapshotTimestamp;
  const isCurrentCaseProjection = includeCurrentActions;
  useEffect(() => () => {
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
  }, []);
  useEffect(() => {
    if (!snapshot || !snapshotMatchesDate) return;
    const previousSnapshot = lastAnimatedSnapshotRef.current;
    lastAnimatedSnapshotRef.current = snapshot.asOf;
    if (previousSnapshot === snapshot.asOf || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    graphLayerRef.current?.animate([{ opacity: previousSnapshot ? 0.55 : 0.78 }, { opacity: 1 }], {
      duration: previousSnapshot ? 260 : 320,
      easing: 'ease-out',
    });
  }, [snapshot, snapshotMatchesDate]);
  const graph = useMemo(
    () => (snapshot ? makeGraph(snapshot, caseData, includeCurrentActions) : { nodes: [], edges: [] }),
    [caseData, includeCurrentActions, snapshot],
  );
  const setTimelineDate = useCallback((value: string | null, event?: TwinTimelineEvent, pausePlayback = true) => {
    if (pausePlayback) setIsPlaying(false);
    setSnapshotError(null);
    setSelectedAsOf(value);
    const eventNodeId = event?.relatedNodeIds.find((nodeId) => graph.nodes.some((node) => node.id === nodeId));
    if (eventNodeId) setSelectedNodeId(eventNodeId);
  }, [graph.nodes]);
  const activeMilestoneIndex = selectedTimestamp === null
    ? -1
    : datedMilestones.reduce((lastIndex, milestone, index) => milestone.at <= selectedTimestamp ? index : lastIndex, -1);

  useEffect(() => {
    if (!isPlaying || reducedMotion || datedMilestones.length < 2) return;
    const nextMilestoneIndex = activeMilestoneIndex + 1;
    if (nextMilestoneIndex >= datedMilestones.length) return;
    const nextEvent = datedMilestones[nextMilestoneIndex].event;
    const timer = window.setTimeout(() => {
      setTimelineDate(nextEvent.occurredAt ?? null, nextEvent, false);
      if (nextMilestoneIndex === datedMilestones.length - 1) setIsPlaying(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [activeMilestoneIndex, datedMilestones, isPlaying, reducedMotion, setTimelineDate]);

  const baseNodeOrder = useMemo(() => {
    const nodes = legalTwin?.snapshot.nodes ?? [];
    const ids = [...nodes]
      .sort((left, right) => KIND_ORDER.indexOf(viewKind(left)) - KIND_ORDER.indexOf(viewKind(right)) || left.id.localeCompare(right.id))
      .map((node) => node.id);
    return new Map(ids.map((nodeId, index) => [nodeId, index]));
  }, [legalTwin?.snapshot.nodes]);

  const activeEventNodeId = useMemo(
    () => activeEvent?.relatedNodeIds.find((nodeId) => graph.nodes.some((node) => node.id === nodeId)) ?? null,
    [activeEvent, graph.nodes],
  );
  const visibleNodes = useMemo(
    () => [...(filter === 'all' ? graph.nodes : graph.nodes.filter((node) => node.kind === filter))]
      .sort((left, right) => (baseNodeOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (baseNodeOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)),
    [baseNodeOrder, filter, graph.nodes],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [graph.edges, visibleNodeIds],
  );
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId)
      ?? graph.nodes.find((node) => node.id === activeEventNodeId)
      ?? graph.nodes[0]
      ?? null,
    [activeEventNodeId, graph.nodes, selectedNodeId],
  );
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const relatedEdges = useMemo(
    () => selectedNode
      ? graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      : [],
    [graph.edges, selectedNode],
  );
  const actionNodes = useMemo(() => graph.nodes.filter((node) => node.kind === 'action'), [graph.nodes]);
  const actionNodeIndexes = useMemo(
    () => new Map(actionNodes.map((node, index) => [node.id, baseNodeOrder.size + index])),
    [actionNodes, baseNodeOrder.size],
  );
  const visibleNodeIndexes = useMemo(() => new Map(visibleNodes.map((node) => [
    node.id,
    baseNodeOrder.get(node.id) ?? actionNodeIndexes.get(node.id) ?? baseNodeOrder.size,
  ])), [actionNodeIndexes, baseNodeOrder, visibleNodes]);
  const occupiedRows = useMemo(
    () => [...visibleNodeIndexes.values()].map((index) => Math.floor(index / graphColumns) + 1),
    [graphColumns, visibleNodeIndexes],
  );
  const graphRows = Math.max(
    1,
    filter === 'all'
      ? Math.ceil((baseNodeOrder.size + actionNodes.length) / graphColumns)
      : Math.max(...occupiedRows, 1),
  );
  const graphHeight = Math.max(236, graphRows * 126 + 4);
  const graphViewWidth = graphWidth || 1000;
  const gridGap = 14;
  const gridColumnWidth = (graphViewWidth - gridGap * (graphColumns - 1)) / graphColumns;
  const hasLocation = Boolean(
    caseData?.jurisdiction.city || caseData?.jurisdiction.state || caseData?.jurisdiction.district || caseData?.jurisdiction.country,
  );
  const locationLabel = caseData
    ? [caseData.jurisdiction.city, caseData.jurisdiction.state, caseData.jurisdiction.country]
      .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
      .join(', ')
    : '';

  if (caseLoading || (!caseData && twinLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e1321] text-[#bcc7de]">
        <div className="flex items-center gap-3 text-sm">
          <LoaderCircle className="h-5 w-5 animate-spin text-[#ffc174]" />
          Loading case records…
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e1321] px-6 text-[#dee2f6]">
        <div className="w-full max-w-md rounded-2xl border border-rose-400/20 bg-[#161b2a] p-7 text-center">
          <CircleAlert className="mx-auto h-8 w-8 text-rose-300" />
          <h1 className="mt-4 font-serif text-2xl">Case unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-[#aeb9d0]">{caseError || 'The requested case is unavailable.'}</p>
          <button
            onClick={() => void refreshCaseState().catch(() => undefined)}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#ffc174] px-4 text-sm font-semibold text-[#2a1700] transition hover:bg-[#ffcf91]"
          >
            <ArrowLeft className="h-4 w-4" /> Retry case load
          </button>
        </div>
      </div>
    );
  }

  if (!legalTwin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e1321] px-6 text-[#dee2f6]">
        <div className="w-full max-w-md rounded-2xl border border-amber-300/20 bg-[#161b2a] p-7 text-center">
          <CircleAlert className="mx-auto h-8 w-8 text-amber-200" />
          <h1 className="mt-4 font-serif text-2xl">Legal Twin unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-[#aeb9d0]">{currentTwinError || 'The Twin projection is not available yet.'}</p>
          <button type="button" onClick={retryTwinRefresh} className="mt-6 min-h-11 rounded-lg bg-[#ffc174] px-4 text-sm font-semibold text-[#2a1700]">Retry Twin refresh</button>
        </div>
      </div>
    );
  }

  const onGraphPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!snapshotMatchesDate) return;
    if ((event.target as HTMLElement).closest('button')) return;
    graphDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotation: graphRotationRef.current,
    };
    if (graphLayerRef.current) graphLayerRef.current.style.transition = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onGraphPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = graphDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    const rotation = {
      x: Math.max(-26, Math.min(26, drag.rotation.x - deltaY * 0.35)),
      y: Math.max(-32, Math.min(32, drag.rotation.y + deltaX * 0.35)),
    };
    graphRotationRef.current = rotation;
    graphDragRef.current = { ...drag, x: event.clientX, y: event.clientY, rotation };
    if (graphLayerRef.current) {
      graphLayerRef.current.style.transform = `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`;
    }
  };

  const onGraphPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (graphDragRef.current?.pointerId !== event.pointerId) return;
    graphDragRef.current = null;
    if (graphLayerRef.current) graphLayerRef.current.style.transition = '';
  };

  const filteredEmptyMessage = filter === 'procedure'
    ? 'No procedure record is supported by the current CaseState and verified legal sources.'
      : filter === 'document'
      ? 'No document records are present in this Legal Twin snapshot.'
      : filter === 'all'
        ? 'No records are present in this Legal Twin snapshot yet.'
        : `No ${KIND_LABELS[filter].toLowerCase()} are present in this snapshot.`;

  const activeProgress = rangeMinimum !== null && rangeMaximum !== null && rangeMaximum > rangeMinimum && selectedTimestamp !== null
    ? Math.min(100, Math.max(0, ((selectedTimestamp - rangeMinimum) / (rangeMaximum - rangeMinimum)) * 100))
    : 0;
  const previousMilestone = selectedTimestamp === null
    ? null
    : [...datedEvents].reverse().find((event) => (timestamp(event.occurredAt) ?? 0) < selectedTimestamp) ?? null;
  const nextMilestone = selectedTimestamp === null
    ? datedEvents[0] ?? null
    : datedEvents.find((event) => (timestamp(event.occurredAt) ?? 0) > selectedTimestamp) ?? null;

  return (
    <div className="min-h-screen bg-[#0e1321] text-[#dee2f6]">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0e1321]/90 shadow-[0_1px_8px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
          <div className="flex min-h-[72px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#ffc174]/20 bg-[#ffc174]/10 text-[#ffc174]">
                <Scale className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-lg font-semibold tracking-tight text-[#ffc174]">LawSense</span>
                  <span className="rounded border border-[#303444] bg-[#252a39] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#bcc7de]">Legal Twin</span>
                </div>
                <div className="truncate font-mono text-[10px] text-[#8e9ab1]">CASE · {caseData.id}</div>
              </div>
            </div>
            <button
              onClick={() => router.push(`/case/${encodeURIComponent(caseData.id)}`)}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-[#3e495d] bg-[#161b2a] px-3 text-xs font-semibold text-[#d8e3fb] transition hover:border-[#ffc174]/50 hover:text-[#ffc174] sm:px-4 sm:text-sm"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Case Workspace</span>
              <span className="sm:hidden">Case</span>
            </button>
          </div>
          <div className="flex min-h-9 items-center justify-between gap-3 pb-2 sm:pb-3">
            <div className="flex min-w-0 items-center gap-2 rounded-full bg-[#161b2a] px-2.5 py-1 text-xs text-[#bcc7de]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span className="truncate">{caseData.title?.trim() || 'Untitled case'}</span>
            </div>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-[#ffc174] sm:text-[10px]">
              {hasLocation ? locationLabel : 'Jurisdiction not established'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pb-12 pt-4 sm:gap-5 sm:px-6 sm:pt-6">
        <TrustNotice variant="dark" />
        {caseError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs leading-5 text-amber-100">
            <span>Showing the last saved CaseState. Refresh failed: {caseError}</span>
            <button type="button" onClick={() => void refreshCaseState().catch(() => undefined)} className="min-h-9 rounded-lg border border-amber-200/20 px-3 font-semibold hover:bg-amber-200/[0.06]">Retry case refresh</button>
          </div>
        )}
        {twinLoading && legalTwin && (
          <p role="status" aria-live="polite" className="rounded-xl border border-[#ffc174]/15 bg-[#ffc174]/[0.035] px-4 py-3 text-xs text-[#ffddb8]">
            Syncing the Twin projection to the latest CaseState. The old graph stays hidden until its returned snapshot is ready.
          </p>
        )}
        {currentTwinError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300/15 bg-rose-300/[0.035] px-4 py-3 text-xs leading-5 text-rose-100">
            <span>The Twin could not sync to the latest CaseState: {currentTwinError}</span>
            <button type="button" onClick={retryTwinRefresh} className="min-h-9 rounded-lg border border-rose-200/20 px-3 font-semibold hover:bg-rose-200/[0.06]">Retry Twin refresh</button>
          </div>
        )}
        {changeSummary && snapshotMatchesDate && (
          <p role="status" aria-live="polite" className="rounded-xl border border-[#ffc174]/20 bg-[#ffc174]/[0.045] px-4 py-3 text-xs leading-5 text-[#ffddb8]">
            {changeSummary}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#161b2a] px-4 py-3 shadow-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${snapshotMatchesDate ? 'bg-emerald-400' : 'bg-[#ffc174]'}`} />
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[#ffc174] sm:text-xs">
              {snapshotMatchesDate ? 'CaseState record graph · current' : currentTwinError ? 'CaseState record graph · sync required' : 'CaseState record graph · syncing'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#252a39] px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-[#bcc7de] sm:text-[10px]">
            <Waypoints className="h-3.5 w-3.5 text-[#c7c8ff]" />
            Data-driven snapshots
          </div>
        </div>

        <section className="space-y-4 rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.18)] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#252a39] text-[#ffc174]">
                <CalendarClock className="h-[18px] w-[18px]" />
              </div>
              <div>
                <h1 className="font-serif text-[19px] font-medium leading-6 text-[#dee2f6] sm:text-xl">Temporal State Scrubber</h1>
                <p className="mt-0.5 text-[11px] text-[#aeb9d0]">Recorded CaseState events · {hasLocation ? locationLabel : 'Location not established'}</p>
              </div>
            </div>
            <button
              type="button"
              disabled={datedEvents.length < 2 || reducedMotion}
              onClick={() => {
                if (!isPlaying && activeMilestoneIndex >= datedEvents.length - 1 && datedEvents[0]) {
                  setTimelineDate(datedEvents[0].occurredAt ?? null, datedEvents[0]);
                }
                setIsPlaying((playing) => !playing);
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-[#252a39] px-3 text-xs font-semibold text-[#ffc174] shadow-sm transition hover:bg-[#303444] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isPlaying && !reducedMotion ? 'Pause the case timeline' : 'Play the case timeline'}
              title={reducedMotion
                ? 'Automatic playback is disabled by your reduced-motion preference. Manual timeline controls remain available.'
                : 'Steps through dated CaseState projections; this does not simulate a legal outcome.'}
            >
              {isPlaying && !reducedMotion ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isPlaying && !reducedMotion ? 'Pause' : 'Play timeline'}
            </button>
          </div>

          {rangeMinimum !== null && rangeMaximum !== null && selectedAsOf ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#1a1f2e] px-3 py-2.5 shadow-inner">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock3 className="h-4 w-4 shrink-0 text-[#f59e0b]" />
                  <span className="truncate font-mono text-xs font-semibold text-[#ffddb8]">
                    As of {formatCaseDate(selectedAsOf)}
                  </span>
                </div>
                <span className="rounded bg-[#303444] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-[#c7c8ff]">
                  {datedEvents.length} dated milestones
                </span>
              </div>
              {activeEvent && (
                <div className="flex items-start gap-2 rounded-lg bg-[#252a39] px-3 py-2.5">
                  <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-[#38bdf8]" />
                  <div className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#d8c3ad]">Last recorded event by this date · {humanize(activeEvent.kind)}</span>
                    <p className="mt-1 text-sm leading-5 text-[#dee2f6]">{activeEvent.summary}</p>
                  </div>
                </div>
              )}
              <div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-[#303444]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#bcc7de] to-[#f59e0b] transition-[width] duration-300" style={{ width: `${activeProgress}%` }} />
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {datedEvents.map((event) => {
                    const eventTime = timestamp(event.occurredAt);
                    const isActive = event.id === activeEvent?.id;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => setTimelineDate(event.occurredAt ?? null, event)}
                        aria-pressed={isActive}
                        className="group flex min-w-[104px] flex-1 flex-col items-center rounded-lg px-1 py-1 text-center transition hover:bg-[#252a39] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc174]"
                        title={`${formatCaseDate(event.occurredAt)} · ${event.summary}`}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-[#161b2a] transition group-hover:scale-110 ${isActive ? 'bg-[#f59e0b]' : 'bg-[#3e495d]'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-[#2a1700]' : 'bg-[#bcc7de]'}`} />
                        </span>
                        <span className={`mt-1.5 max-w-full truncate font-mono text-[9px] ${isActive ? 'font-semibold text-[#ffc174]' : 'text-[#8e9ab1]'}`}>
                          {eventTime === null ? 'DATE UNKNOWN' : new Date(eventTime).toISOString().slice(0, 10)}
                        </span>
                        <span className={`mt-0.5 max-w-full truncate text-[10px] ${isActive ? 'font-semibold text-[#ffddb8]' : 'text-[#aeb9d0]'}`}>
                          {humanize(event.kind)}
                        </span>
                      </button>
                    );
                  })}
                  {snapshotTimestamp !== null && !snapshotHasMilestone && legalTwin?.snapshot.asOf && (
                    <button
                      type="button"
                      onClick={() => setTimelineDate(legalTwin.snapshot.asOf)}
                      aria-pressed={isCurrentCaseProjection}
                      className={`group flex min-w-[132px] flex-1 flex-col items-center rounded-lg px-1 py-1 text-center transition hover:bg-[#252a39] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc174] ${isCurrentCaseProjection ? 'bg-[#252a39]' : ''}`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-[#161b2a] ${isCurrentCaseProjection ? 'bg-[#f59e0b]' : 'bg-[#3e495d]'}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-[#bcc7de]" />
                      </span>
                      <span className={`mt-1.5 max-w-full truncate font-mono text-[9px] ${isCurrentCaseProjection ? 'font-semibold text-[#ffc174]' : 'text-[#8e9ab1]'}`}>
                        {formatCaseDate(legalTwin.snapshot.asOf)}
                      </span>
                      <span className="mt-0.5 max-w-full truncate text-[10px] text-[#aeb9d0]">Latest CaseState</span>
                    </button>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 px-1">
                  <button
                    type="button"
                    aria-label="Previous dated milestone"
                    disabled={!previousMilestone}
                    onClick={() => previousMilestone && setTimelineDate(previousMilestone.occurredAt ?? null, previousMilestone)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#bcc7de] transition hover:bg-[#252a39] hover:text-[#ffc174] disabled:opacity-30"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="range"
                    min={rangeMinimum}
                    max={rangeMaximum}
                    step={rangeStep}
                    value={Math.min(rangeMaximum, Math.max(rangeMinimum, selectedTimestamp ?? rangeMinimum))}
                    onChange={(event) => setTimelineDate(new Date(Number(event.currentTarget.value)).toISOString())}
                    aria-label="Choose the date for the CaseState projection"
                    aria-valuetext={formatCaseDate(selectedAsOf)}
                    className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#f59e0b] disabled:cursor-not-allowed"
                    disabled={rangeMaximum <= rangeMinimum}
                  />
                  <button
                    type="button"
                    aria-label="Next dated milestone"
                    disabled={!nextMilestone || activeMilestoneIndex === datedEvents.length - 1}
                    onClick={() => nextMilestone && setTimelineDate(nextMilestone.occurredAt ?? null, nextMilestone)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#bcc7de] transition hover:bg-[#252a39] hover:text-[#ffc174] disabled:opacity-30"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-5 text-[#8e9ab1]">
                {snapshotError
                  ? `The projection for ${formatCaseDate(selectedAsOf)} could not be loaded. The previous projection is hidden until a date resolves. Use “Try again” to retry. ${snapshotError}`
                  : !snapshotMatchesDate
                    ? currentTwinError
                      ? `The Twin could not refresh for this CaseState revision. The previous projection stays hidden until a matching snapshot resolves. ${currentTwinError}`
                      : `Loading the CaseState projection for ${formatCaseDate(selectedAsOf)}. The previous projection is hidden until this date resolves.`
                    : `Snapshot as of ${formatCaseDate(snapshot?.asOf)}. ${snapshot?.unresolvedNodeIds.length ?? 0} unresolved records · ${snapshot?.temporallyUncertainNodeIds.length ?? 0} records with uncertain timing. ${snapshot?.limitations[0] ?? ''}`}
              </p>
              {unresolvedTimelineEvents.length > 0 && (
                <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-200">Timeline entries without an exact date</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {unresolvedTimelineEvents.map((event) => (
                      <li key={event.id} className="rounded-md border border-amber-300/15 bg-[#1a1f2e] px-2.5 py-1.5 text-[10px] text-[#d8e3fb]">
                        <span className="text-amber-200">{humanize(event.datePrecision)} date</span>
                        <span className="mx-1 text-[#8e9ab1]">·</span>
                        {event.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <EmptyMessage>
              {timelineEvents.length > 0
                ? 'No exact dated milestones are available for temporal scrubbing. Undated and approximate records remain unresolved in CaseState.'
                : 'No timeline records are present in the Legal Twin response. No dates or milestones are being assumed.'}
              {unresolvedTimelineEvents.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {unresolvedTimelineEvents.map((event) => (
                    <li key={event.id} className="rounded-md border border-amber-300/15 bg-[#1a1f2e] px-3 py-2 text-xs text-[#d8e3fb]">
                      <span className="font-semibold text-amber-200">{humanize(event.datePrecision)} date</span>
                      <span className="mx-1 text-[#8e9ab1]">·</span>
                      {event.summary}
                    </li>
                  ))}
                </ul>
              )}
            </EmptyMessage>
          )}
        </section>

        <section id="legal-twin-graph" className="scroll-mt-32 space-y-4 rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.18)] sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#c7c8ff]" />
                <h2 className="font-serif text-xl font-medium text-[#dee2f6]">3D Relationship Graph</h2>
              </div>
              <p className="mt-1 text-[11px] text-[#aeb9d0]">
                {snapshotMatchesDate
                  ? `${graph.nodes.length} CaseState records · ${graph.edges.length} explicit links · As of ${formatCaseDate(snapshot?.asOf)}`
                  : `Updating projection · last loaded state was as of ${formatCaseDate(snapshot?.asOf)}`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-[#1a1f2e] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wide text-[#bcc7de]">
              <Waypoints className="h-3.5 w-3.5 text-[#bcc7de]" />
              Select a record to inspect
            </div>
          </div>

          <div
            ref={graphRef}
            role="region"
            aria-label="CaseState relationship graph"
            aria-busy={!snapshotMatchesDate}
            onPointerDown={onGraphPointerDown}
            onPointerMove={onGraphPointerMove}
            onPointerUp={onGraphPointerEnd}
            onPointerCancel={onGraphPointerEnd}
            className="relative cursor-grab overflow-hidden rounded-xl border border-white/[0.04] bg-[#090e1c] px-3 py-3 shadow-inner active:cursor-grabbing sm:px-4"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(188,199,222,0.11) 1px, transparent 0)', backgroundSize: '22px 22px', perspective: '1100px', transformStyle: 'preserve-3d', touchAction: 'pan-y' }}
          >
            {visibleNodes.length > 0 ? (
              <div
                ref={graphLayerRef}
                aria-hidden={!snapshotMatchesDate}
                className="relative transition-transform duration-300 ease-out motion-reduce:transition-none"
                style={{
                  height: `${graphHeight}px`,
                  transformStyle: 'preserve-3d',
                  transform: 'rotateX(-5deg) rotateY(0deg)',
                }}
              >
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 z-0 h-full w-full"
                  viewBox={`0 0 ${graphViewWidth} ${graphHeight}`}
                  preserveAspectRatio="none"
                >
                  {visibleEdges.map((edge) => {
                    const sourceIndex = visibleNodeIndexes.get(edge.source);
                    const targetIndex = visibleNodeIndexes.get(edge.target);
                    if (sourceIndex === undefined || targetIndex === undefined) return null;
                    const sourceColumn = sourceIndex % graphColumns;
                    const sourceRow = Math.floor(sourceIndex / graphColumns);
                    const targetColumn = targetIndex % graphColumns;
                    const targetRow = Math.floor(targetIndex / graphColumns);
                    const x1 = sourceColumn * (gridColumnWidth + gridGap) + gridColumnWidth / 2;
                    const y1 = sourceRow * 126 + 52;
                    const x2 = targetColumn * (gridColumnWidth + gridGap) + gridColumnWidth / 2;
                    const y2 = targetRow * 126 + 52;
                    const isChanged = changedRecordIds.has(`edge:${edge.id}`);
                    const stroke = isChanged
                      ? '#ffc174'
                      : edge.status === 'conflicting' || edge.relation === 'conflicts with'
                      ? '#fb7185'
                      : edge.status === 'unknown' || edge.status === 'assumption'
                        ? '#fbbf24'
                        : edge.relation === 'supports'
                        ? '#34d399'
                        : edge.relation === 'involves'
                          ? '#ffc174'
                          : '#8291aa';
                    return (
                      <path
                        key={edge.id}
                        d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - 12} ${x2} ${y2}`}
                        fill="none"
                        stroke={stroke}
                        strokeOpacity={isChanged ? '0.95' : edge.status === 'unknown' || edge.status === 'assumption' ? '0.72' : '0.56'}
                        strokeWidth={isChanged ? '2.5' : edge.status === 'conflicting' ? '2' : '1.5'}
                        strokeDasharray={edge.status === 'assumption' || edge.status === 'unknown' || edge.relation === 'source' || edge.relation === 'document reference' ? '4 4' : undefined}
                      >
                        <title>{`${edge.relation} · ${STATUS_LABELS[edge.status]} · ${edge.provenance.length} provenance record${edge.provenance.length === 1 ? '' : 's'}`}</title>
                      </path>
                    );
                  })}
                </svg>

                <div
                  role="group"
                  aria-label="Keyboard accessible CaseState records; WebGL is not required"
                  className="relative z-10 grid"
                  style={{ gridTemplateColumns: `repeat(${graphColumns}, minmax(0, 1fr))`, columnGap: `${gridGap}px`, rowGap: '22px' }}
                >
                  {visibleNodes.map((node, index) => {
                    const kindStyle = KIND_STYLES[node.kind];
                    const Icon = kindStyle.icon;
                    const slotIndex = visibleNodeIndexes.get(node.id) ?? index;
                    const isActiveEvent = node.kind === 'event' && Boolean(activeEvent?.relatedNodeIds.includes(node.id));
                    const isSelected = node.id === selectedNode?.id;
                    return (
                      <button
                        type="button"
                        key={node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        disabled={!snapshotMatchesDate}
                        aria-pressed={isSelected}
                        aria-label={`${KIND_LABELS[node.kind]}: ${node.title}${node.status ? ` · ${STATUS_LABELS[node.status]}` : ''}${node.unresolved ? ' · unresolved' : ''}${node.temporallyUncertain ? ' · timing uncertain' : ''}`}
                        style={{
                          gridColumn: (slotIndex % graphColumns) + 1,
                          gridRow: Math.floor(slotIndex / graphColumns) + 1,
                          transform: `translateZ(${node.depth}px)`,
                          transformStyle: 'preserve-3d',
                        }}
                        className={`group flex h-[104px] min-w-0 flex-col justify-between rounded-lg border bg-[#1a1f2e]/95 p-2.5 text-left shadow-[0_8px_18px_rgba(0,0,0,0.22)] transition-[border-color,background-color,box-shadow,transform] duration-300 ease-out motion-reduce:transition-none hover:-translate-y-0.5 hover:bg-[#252a39] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffc174] ${isSelected ? 'border-[#ffc174]/75 ring-1 ring-[#ffc174]/25' : kindStyle.border} ${isActiveEvent ? 'ring-1 ring-sky-300/50' : ''} ${node.status === 'conflicting' ? 'border-rose-400/70' : ''} ${node.status === 'unknown' || node.status === 'assumption' ? 'border-amber-300/55 border-dashed' : ''} ${changedRecordIds.has(`node:${node.id}`) ? 'ring-2 ring-[#ffc174]/65' : ''}`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-1.5">
                          <span className={`inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] ${kindStyle.tint}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${kindStyle.dot}`} />
                            <span className="truncate">{KIND_LABELS[node.kind]}</span>
                          </span>
                          <span className="flex min-w-0 items-center justify-end gap-1">
                            {node.temporallyUncertain && (
                              <span className="max-w-[44%] truncate rounded border border-amber-300/35 bg-amber-950/50 px-1 py-0.5 text-[7px] text-amber-200" title="This record has uncertain timing in the CaseState snapshot">Time ?</span>
                            )}
                            {node.status ? (
                              <span className={`max-w-[48%] truncate rounded border px-1.5 py-0.5 text-[8px] ${STATUS_STYLES[node.status]}`}>
                                {STATUS_LABELS[node.status]}
                              </span>
                            ) : node.confidence ? (
                              <span className="max-w-[45%] truncate font-mono text-[8px] uppercase text-[#8e9ab1]">{humanize(node.confidence)}</span>
                            ) : null}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${kindStyle.tint}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-[#dee2f6]">{node.title}</span>
                            <span className="mt-0.5 block truncate text-[9px] text-[#aeb9d0]">{node.subtitle || KIND_LABELS[node.kind]}</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="min-h-[180px] content-center">
                <EmptyMessage>{filteredEmptyMessage}</EmptyMessage>
              </div>
            )}
            {!snapshotMatchesDate && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#090e1c] px-6 text-center" role="status" aria-live="polite">
                <div className="flex max-w-md flex-col items-center gap-3">
                  <p className="text-sm leading-6 text-[#ffddb8]">
                    {snapshotError
                      ? `Could not load the projection for ${formatCaseDate(selectedAsOf)}. The last loaded graph is hidden while the date is unresolved.`
                      : currentTwinError
                        ? `The Twin could not sync to this CaseState. Retry the Twin refresh to continue. ${currentTwinError}`
                        : `Loading the CaseState projection for ${formatCaseDate(selectedAsOf)}…`}
                  </p>
                  {(snapshotError || currentTwinError) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSnapshotError(null);
                        if (currentTwinError) retryTwinRefresh();
                        else setSnapshotRetryKey((current) => current + 1);
                      }}
                      className="min-h-10 rounded-lg border border-[#ffc174]/30 bg-[#ffc174]/10 px-3 text-xs font-semibold text-[#ffddb8] transition hover:bg-[#ffc174]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffc174]"
                      aria-label={`Retry CaseState projection for ${formatCaseDate(selectedAsOf)}`}
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              aria-pressed={filter === 'all'}
              disabled={!snapshotMatchesDate}
              onClick={() => setFilter('all')}
              className={`min-h-9 shrink-0 rounded-md px-3 font-mono text-[10px] transition disabled:cursor-wait disabled:opacity-45 ${filter === 'all' ? 'bg-[#f59e0b] text-[#2a1700] shadow-sm' : 'bg-[#252a39] text-[#bcc7de] hover:bg-[#303444]'}`}
            >
              All records ({graph.nodes.length})
            </button>
            {KIND_ORDER.map((kind) => {
              const count = graph.nodes.filter((node) => node.kind === kind).length;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={filter === kind}
                  disabled={!snapshotMatchesDate}
                  onClick={() => setFilter(kind)}
                  className={`min-h-9 shrink-0 rounded-md px-3 font-mono text-[10px] transition disabled:cursor-wait disabled:opacity-45 ${filter === kind ? 'bg-[#3e495d] text-[#ffddb8] ring-1 ring-[#ffc174]/35' : 'bg-[#252a39] text-[#bcc7de] hover:bg-[#303444]'}`}
                >
                  {KIND_LABELS[kind]} ({count})
                </button>
              );
            })}
          </div>

          {selectedNode && snapshotMatchesDate && (
            <div className="rounded-lg border border-white/[0.04] bg-[#1a1f2e] p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_STYLES[selectedNode.kind].tint}`}>
                    {(() => {
                      const Icon = KIND_STYLES[selectedNode.kind].icon;
                      return <Icon className="h-4 w-4" />;
                    })()}
                  </div>
                  <div className="min-w-0">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#f59e0b]">Selected record · {KIND_LABELS[selectedNode.kind]}</span>
                    <h3 className="mt-0.5 truncate font-serif text-lg text-[#dee2f6]">{selectedNode.title}</h3>
                    <p className="mt-0.5 text-xs text-[#aeb9d0]">{selectedNode.subtitle}</p>
                  </div>
                </div>
                {selectedNode.status && (
                  <span className={`rounded border px-2 py-1 text-[10px] ${STATUS_STYLES[selectedNode.status]}`}>
                    {STATUS_LABELS[selectedNode.status]}
                  </span>
                )}
              </div>
              <p className="mt-4 text-sm leading-6 text-[#d8e3fb]">{selectedNode.summary}</p>
              {(selectedNode.unresolved || selectedNode.temporallyUncertain) && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Record uncertainty">
                  {selectedNode.unresolved && <span className="rounded border border-amber-300/35 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-200">Unresolved in CaseState</span>}
                  {selectedNode.temporallyUncertain && <span className="rounded border border-amber-300/35 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-200">Timing not established</span>}
                </div>
              )}
              {selectedNode.date !== undefined && (
                <p className="mt-3 text-xs text-[#8e9ab1]">
                  Date precision · {selectedNode.datePrecision ? humanize(selectedNode.datePrecision) : 'Unknown'}
                </p>
              )}
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8e9ab1]">Recorded relationships</span>
                  <span className="font-mono text-[10px] text-[#bcc7de]">{relatedEdges.length}</span>
                </div>
                {relatedEdges.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {relatedEdges.map((edge) => {
                      const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
                      const other = nodeById.get(otherId);
                      return (
                        <li key={edge.id} title={edge.provenance.map((source) => source.sourcePath).join(' · ')} className="rounded-md border border-[#3e495d] bg-[#252a39] px-2.5 py-1.5 text-[10px] text-[#d8e3fb]">
                          <span className="text-[#aeb9d0]">{edge.relation}</span>
                          <span className="mx-1 text-[#8e9ab1]">·</span>
                          {other?.title || 'Linked CaseState record'}
                          <span className={`ml-2 rounded border px-1 py-0.5 text-[8px] ${STATUS_STYLES[edge.status]}`}>{STATUS_LABELS[edge.status]}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[#8e9ab1]">No explicit relationship is recorded for this item.</p>
                )}
              </div>
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8e9ab1]">Source provenance</span>
                  <span className="font-mono text-[10px] text-[#bcc7de]">{selectedNode.provenance.length}</span>
                </div>
                {selectedNode.provenance.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {selectedNode.provenance.map((source, index) => (
                      <li key={`${source.sourceId}-${source.sourcePath}-${index}`} className="rounded-md border border-[#303444] bg-[#252a39]/70 px-2.5 py-2 text-[10px] leading-5">
                        <span className="text-[#d8e3fb]">{humanize(source.sourceType)} · {humanize(source.status)}</span>
                        <span className="block break-all text-[#aeb9d0]">{source.sourcePath} · {source.sourceId}</span>
                        {source.details && <span className="mt-1 block whitespace-pre-wrap text-[#aeb9d0]">{source.details}</span>}
                        {source.confirmedByUser && source.confirmedAt && (
                          <span className="mt-1 block text-emerald-200/80">User confirmed · {new Date(source.confirmedAt).toLocaleString()}</span>
                        )}
                        {(source.pageNumber || source.extractionMethod || source.confidence !== null && source.confidence !== undefined) && (
                          <span className="block text-[#8e9ab1]">
                            {source.pageNumber ? `Page ${source.pageNumber} · ` : ''}
                            {source.extractionMethod ? `${humanize(source.extractionMethod)} · ` : ''}
                            {source.confidence !== null && source.confidence !== undefined ? `${Math.round(source.confidence * 100)}% confidence` : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[#8e9ab1]">No provenance records were supplied for this node.</p>
                )}
              </div>
            </div>
          )}

          <p className="text-[11px] leading-5 text-[#8e9ab1]">
            Use the keyboard accessible record buttons to inspect provenance and explicit links. This DOM and SVG graph works without WebGL. Drag an empty area to adjust the 3D viewpoint; depth does not imply legal importance. The date scrubber loads the CaseState projection for the selected time.
          </p>
        </section>

        {isCurrentCaseProjection ? (
        <>
        <section className="rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.18)] sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-medium text-[#dee2f6]">Evidence records</h2>
              <p className="mt-1 text-[11px] text-[#aeb9d0]">Source records currently attached to this CaseState</p>
            </div>
            <span className="rounded bg-[#1a1f2e] px-2 py-1 font-mono text-[10px] text-[#bcc7de]">{caseData.evidence.length} records</span>
          </div>
          {caseData.evidence.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {caseData.evidence.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setFilter('all');
                    setSelectedNodeId(`evidence:${item.id}`);
                  }}
                  className="group flex min-h-[104px] min-w-0 flex-col justify-between rounded-lg border border-[#303444] bg-[#1a1f2e] p-3 text-left transition hover:border-[#38bdf8]/40 hover:bg-[#252a39]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-[#38bdf8]" />
                      <span className="truncate text-sm font-semibold text-[#dee2f6]">{item.title}</span>
                    </div>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] ${STATUS_STYLES[item.status]}`}>{humanize(item.status)}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#aeb9d0]">
                    <span>{humanize(item.type)} · {sourceLabel(item.source)}</span>
                    <span className="font-mono text-[#8e9ab1]">{item.documentId ? 'DOCUMENT LINKED' : 'CASE RECORD'}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyMessage>
              No evidence records are attached to this CaseState yet. Evidence nodes will appear here when the case contains sourced records.
            </EmptyMessage>
          )}
        </section>

        <section className="space-y-4 pt-1">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h2 className="font-serif text-xl font-medium text-[#dee2f6]">Five pillars of the case record</h2>
              <p className="mt-1 text-[11px] text-[#aeb9d0]">What is present in CaseState, with its recorded provenance and gaps.</p>
            </div>
            <span className="rounded bg-[#1a1f2e] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-[#ffddb8]">Case record view</span>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <CasePillar number={1} title="What is recorded?" icon={FileText}>
              {caseData.facts.length > 0 ? (
                <div className="space-y-2">
                  {caseData.facts.slice(0, 4).map((fact) => (
                    <div key={fact.id} className="rounded-lg bg-[#1a1f2e] px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#dee2f6]">{humanize(fact.key)}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] ${STATUS_STYLES[fact.status]}`}>{STATUS_LABELS[fact.status]}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-5 text-[#d8e3fb]">{safeValue(fact.value)}</p>
                    </div>
                  ))}
                  {caseData.facts.length > 4 && <p className="px-1 text-[10px] text-[#8e9ab1]">{caseData.facts.length - 4} more fact records are available in the graph.</p>}
                </div>
              ) : (
                <EmptyMessage>No structured facts have been extracted into this CaseState yet.</EmptyMessage>
              )}
            </CasePillar>

            <CasePillar number={2} title="When are events recorded?" icon={CalendarClock}>
              {timelineEvents.length > 0 ? (
                <div className="space-y-2">
                  {timelineEvents.slice(0, 4).map((event) => (
                    <div key={event.id} className="flex gap-3 rounded-lg bg-[#1a1f2e] px-3 py-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ffc174]" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-[10px] text-[#ffddb8]">{event.dateValue?.trim() || event.occurredAt?.slice(0, 10) || 'Date not stated'}</span>
                          <span className="text-[9px] text-[#8e9ab1]">· {humanize(event.datePrecision)} precision</span>
                        </div>
                        <p className="mt-0.5 text-xs font-semibold text-[#dee2f6]">{humanize(event.kind)}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#aeb9d0]">{event.summary}</p>
                      </div>
                    </div>
                  ))}
                  {timelineEvents.length > 4 && <p className="px-1 text-[10px] text-[#8e9ab1]">{timelineEvents.length - 4} more event records are available in the timeline.</p>}
                </div>
              ) : (
                <EmptyMessage>No events are recorded in this CaseState yet.</EmptyMessage>
              )}
            </CasePillar>

            <CasePillar number={3} title="Who is identified?" icon={UsersRound}>
              <div className="space-y-2">
                <div className="rounded-lg bg-[#1a1f2e] px-3 py-2.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-[#8e9ab1]">Person record</span>
                  <p className="mt-1 text-sm font-semibold text-[#dee2f6]">{caseData.person.name?.trim() || 'Name not provided'}</p>
                  <p className="mt-0.5 text-xs text-[#aeb9d0]">{caseData.person.contact?.trim() || 'No contact recorded'}</p>
                </div>
                {caseData.parties.length > 0 ? caseData.parties.slice(0, 4).map((party) => (
                  <div key={party.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#1a1f2e] px-3 py-2.5">
                    <span className="min-w-0 truncate text-xs font-semibold text-[#dee2f6]">{party.name?.trim() || 'Unnamed party'}</span>
                    <span className="shrink-0 rounded bg-[#252a39] px-2 py-1 text-[9px] text-[#bcc7de]">{humanize(party.role)}</span>
                  </div>
                )) : <p className="px-1 text-xs text-[#8e9ab1]">No additional party records are present.</p>}
                {caseData.parties.length > 4 && <p className="px-1 text-[10px] text-[#8e9ab1]">{caseData.parties.length - 4} more parties are available in the graph.</p>}
              </div>
            </CasePillar>

            <CasePillar number={4} title="What evidence is attached?" icon={Scale}>
              {caseData.evidence.length > 0 ? (
                <div className="space-y-2">
                  {caseData.evidence.slice(0, 4).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#1a1f2e] px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#dee2f6]">{item.title}</p>
                        <p className="mt-0.5 text-[10px] text-[#aeb9d0]">{humanize(item.type)} · {sourceLabel(item.source)}</p>
                      </div>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] ${STATUS_STYLES[item.status]}`}>{humanize(item.status)}</span>
                    </div>
                  ))}
                  {caseData.evidence.length > 4 && <p className="px-1 text-[10px] text-[#8e9ab1]">{caseData.evidence.length - 4} more evidence records are available in the graph.</p>}
                </div>
              ) : (
                <EmptyMessage>No evidence records are attached to this case yet.</EmptyMessage>
              )}
            </CasePillar>

            <CasePillar number={5} title="What remains unknown?" icon={CircleHelp}>
              {caseData.unknowns.length > 0 || caseData.conflicts.length > 0 ? (
                <div className="space-y-3">
                  {caseData.unknowns.length > 0 && (
                    <div>
                      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-[#fbbf24]">Open questions</p>
                      <ul className="space-y-1.5">
                        {caseData.unknowns.slice(0, 4).map((unknown, index) => <li key={`${index}-${unknown}`} className="flex gap-2 text-xs leading-5 text-[#d8e3fb]"><span className="text-[#fbbf24]">·</span>{unknown}</li>)}
                      </ul>
                    </div>
                  )}
                  {caseData.conflicts.length > 0 && (
                    <div>
                      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-rose-300">Recorded conflicts</p>
                      <ul className="space-y-1.5">
                        {caseData.conflicts.slice(0, 4).map((conflict, index) => <li key={`${index}-${conflict}`} className="flex gap-2 text-xs leading-5 text-[#d8e3fb]"><span className="text-rose-300">·</span>{conflict}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyMessage>No unknowns or conflicts are recorded in this CaseState. This is not a completeness assessment.</EmptyMessage>
              )}
            </CasePillar>
          </div>
        </section>

        {caseData.analysis?.journey && (
          <section className="space-y-3 rounded-xl border border-[#8c9eff]/15 bg-[#161b2a] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.14)] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#b7c2ff]">Journey · same CaseState analysis</p>
                <h2 className="mt-1 font-serif text-lg text-[#dee2f6]">How the case is progressing</h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-[#aeb9d0]">
                  {caseData.analysis.journey.currentSituation || 'Journey steps and status returned for this case.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push(`/case/${encodeURIComponent(caseData.id)}#journey`)}
                className="min-h-9 rounded-lg border border-[#8c9eff]/25 bg-[#8c9eff]/[0.06] px-3 text-xs font-semibold text-[#c7cfff] transition hover:bg-[#8c9eff]/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c9eff]"
              >
                Open case journey <span aria-hidden="true">→</span>
              </button>
            </div>
            {caseData.analysis.journey.steps.length > 0 ? (
              <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {caseData.analysis.journey.steps.slice(0, 6).map((step, index) => (
                  <li key={step.id} className="rounded-lg border border-white/[0.06] bg-[#1a1f2e] px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8e9ab1]">{index + 1} · {humanize(step.stage)}</span>
                      <span className="rounded border border-[#8c9eff]/20 bg-[#8c9eff]/[0.05] px-1.5 py-0.5 text-[8px] uppercase text-[#c7cfff]">{humanize(step.status)}</span>
                    </div>
                    <h3 className="mt-2 text-xs font-semibold text-[#dee2f6]">{step.title}</h3>
                    <p className="mt-1 text-[10px] leading-5 text-[#aeb9d0]">{step.description}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-3 text-xs text-[#8e9ab1]">No journey steps were returned for this CaseState.</p>
            )}
          </section>
        )}

        {caseData.analysis?.decisionScenario ? (
          <section className="space-y-4 rounded-xl border border-[#ffc174]/15 bg-[#161b2a] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.18)] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#252a39] text-[#ffc174]"><Waypoints className="h-5 w-5" /></span>
                <div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#ffc174]">Decision simulator · factual comparison</span>
                  <h2 className="mt-0.5 font-serif text-lg text-[#dee2f6]">{caseData.analysis.decisionScenario.currentState}</h2>
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-[#aeb9d0]">
                    It compares records, unknowns, and candidate options from this CaseState. It does not predict outcomes or establish legal rights.
                  </p>
                </div>
              </div>
              <span className="rounded border border-amber-300/25 bg-amber-300/[0.06] px-2.5 py-1.5 font-mono text-[9px] uppercase text-amber-200">
                {caseData.analysis.decisionScenario.legalInformationStatus}
              </span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <article className="rounded-lg border border-white/[0.06] bg-[#1a1f2e] p-4">
                <h3 className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8e9ab1]">Next information step</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#dee2f6]">{caseData.analysis.decisionScenario.nextAction}</p>
                <p className="mt-1 text-xs leading-5 text-[#aeb9d0]">{caseData.analysis.decisionScenario.nextActionReason}</p>
              </article>
              <article className="rounded-lg border border-white/[0.06] bg-[#1a1f2e] p-4">
                <h3 className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8e9ab1]">Current evidence gaps</h3>
                {caseData.analysis.decisionScenario.unknowns.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {caseData.analysis.decisionScenario.unknowns.slice(0, 4).map((item) => (
                      <li key={item.id} className="text-xs leading-5 text-[#d8e3fb]">· {item.question}</li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-xs leading-5 text-[#aeb9d0]">No additional questions were returned by the simulator.</p>}
              </article>
            </div>

            {caseData.analysis.decisionScenario.paths.length > 0 && (
              <div>
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#8e9ab1]">Candidate options · verification required</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {caseData.analysis.decisionScenario.paths.map((path) => (
                    <article key={path.id} className="rounded-lg border border-white/[0.06] bg-[#1a1f2e] px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-semibold text-[#dee2f6]">{path.label}</h4>
                        <span className="shrink-0 rounded border border-amber-300/20 px-1.5 py-0.5 text-[8px] uppercase text-amber-200">{humanize(path.status)}</span>
                      </div>
                      <p className="mt-1 text-[10px] leading-5 text-[#aeb9d0]">{path.description}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {caseData.analysis.legalKnowledge.status === 'empty' && (
              <p className="text-[10px] leading-5 text-[#8e9ab1]">No matching source was returned for this issue. The local source catalog has limited coverage; an empty lookup does not mean that no law applies.</p>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 text-xs leading-5 text-[#aeb9d0]">
            The simulator has no stored analysis for this older CaseState. Refresh through the current case intake flow to create an updated analysis snapshot.
          </section>
        )}
        </>
        ) : snapshotMatchesDate ? (
          <section className="rounded-xl border border-amber-300/15 bg-[#161b2a] p-4 text-xs leading-5 text-[#aeb9d0]">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-200">Historical projection selected</h2>
            <p className="mt-2">The evidence overview, case summary, and decision analysis describe the latest CaseState and are hidden at this earlier date. The graph above shows the records available in the selected projection.</p>
          </section>
        ) : (
          <section className="rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 text-xs leading-5 text-[#aeb9d0]" role="status" aria-live="polite">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#ffddb8]">CaseState projection pending</h2>
            <p className="mt-2">Current case summaries stay hidden until the selected date has a matching projection.</p>
          </section>
        )}

        {isCurrentCaseProjection && caseData.analysis?.legalKnowledge.records.length ? (
          <section className="rounded-xl border border-white/[0.06] bg-[#161b2a] p-4 text-xs leading-5 text-[#aeb9d0] sm:p-5">
            <LegalSourceCandidates
              caseData={caseData}
              records={caseData.analysis.legalKnowledge.records}
              variant="dark"
            />
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { kind: 'person' as const, description: 'Intake person record' },
            { kind: 'party' as const, description: 'Named parties and roles' },
            { kind: 'event' as const, description: 'CaseState chronology' },
            { kind: 'claim' as const, description: 'Recorded claims and sources' },
            { kind: 'evidence' as const, description: 'Evidence and provenance' },
            { kind: 'document' as const, description: 'Evidence document references' },
            { kind: 'issue' as const, description: 'Candidate legal issues' },
            { kind: 'procedure' as const, description: 'Retrieved procedure records with status shown' },
            { kind: 'authority' as const, description: 'Authority records with source status shown' },
            { kind: 'action' as const, description: 'Current CaseState actions; historical dates are not supplied' },
          ].map(({ kind, description }) => {
            const count = graph.nodes.filter((node) => node.kind === kind).length;
            const Icon = KIND_STYLES[kind].icon;
            return (
              <button
                key={kind}
                type="button"
                disabled={!snapshotMatchesDate}
                onClick={() => {
                  setFilter(kind);
                  document.getElementById('legal-twin-graph')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex min-h-[74px] items-center gap-3 rounded-xl border border-white/[0.06] bg-[#161b2a] px-3 py-3 text-left transition hover:border-[#ffc174]/30 hover:bg-[#1a1f2e] disabled:cursor-wait disabled:opacity-45"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_STYLES[kind].tint}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-[#dee2f6]">{KIND_LABELS[kind]}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#8e9ab1]">{description}</span>
                </span>
                <span className="font-mono text-xs text-[#ffc174]">{snapshotMatchesDate ? count : '—'}</span>
              </button>
            );
          })}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-[#8e9ab1]">
          <span>Source · CaseState {caseData.id}</span>
          <span className="font-mono uppercase tracking-[0.08em]">No outcome or procedural state is inferred</span>
        </div>
      </main>
    </div>
  );
}
