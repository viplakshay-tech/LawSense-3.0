'use client';

import { useMemo } from 'react';
import { GuidePresence, type GuidePresenceState } from '@/components/guide-presence';
import type { GuideActionCommand } from '@/components/guide-actions';
import {
  createInitialGuideRuntime,
  deriveGuideState,
  orchestrateGuideEvent,
  type GuideAction,
  type GuideRuntimeSnapshot,
} from '@/components/guide-runtime';
import type { CaseState, InformationStatus, TwinProvenance } from '@/lib/api';

export type TwinGuideNodeKind =
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

export interface TwinGuideNodeContext {
  id: string;
  kind: TwinGuideNodeKind;
  title: string;
  subtitle: string;
  summary: string;
  status: InformationStatus;
  references: readonly string[];
  provenance: readonly TwinProvenance[];
  unresolved: boolean;
  temporallyUncertain: boolean;
}

export interface TwinGuideEdgeContext {
  id: string;
  relation: string;
  status: InformationStatus;
  source: { id: string; title: string; kind: TwinGuideNodeKind };
  target: { id: string; title: string; kind: TwinGuideNodeKind };
  provenance: readonly TwinProvenance[];
}

export interface TwinGuideTimelineContext {
  at: string | null;
  currentAt: string | null;
  isCurrent: boolean;
  projectionReady: boolean;
  activeEvent: { title: string; summary: string } | null;
}

export interface TwinGuideCompanionProps {
  caseState: CaseState | null;
  node: TwinGuideNodeContext | null;
  edge: TwinGuideEdgeContext | null;
  timeline: TwinGuideTimelineContext;
  onActionRequested: (action: GuideAction | GuideActionCommand) => void;
}

interface CompanionAction {
  action: GuideAction | GuideActionCommand;
  label: string;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayDate(value: string | null): string {
  if (!value) return 'an unspecified time';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(timestamp) + ' UTC';
}

function isTwinId(recordId: string, twinIds: readonly string[], kind: string): boolean {
  return twinIds.includes(recordId) || twinIds.includes(`${kind}:${recordId}`);
}

function provenanceNote(provenance: readonly TwinProvenance[]): string | null {
  const source = provenance.find((item) => item.sourcePath || item.details);
  if (!source) return null;
  const detail = source.details?.trim();
  const path = source.sourcePath.trim();
  return detail && path ? `${detail} Source: ${path}.` : detail ?? `Source: ${path}.`;
}

function nodeExplanation(
  node: TwinGuideNodeContext,
  caseState: CaseState | null,
  isCurrent: boolean,
): string {
  if (node.status === 'unknown' || node.unresolved) {
    return `We don't have enough information to establish ${node.title} yet. The Twin keeps it unresolved until the case record supports a clearer account.`;
  }

  if (node.status === 'conflicting') {
    return `${node.title} has a recorded conflict. I’ll keep that conflict visible instead of treating this record as settled.${provenanceNote(node.provenance) ? ` ${provenanceNote(node.provenance)}` : ''}`;
  }

  if (node.kind === 'evidence') {
    const evidence = caseState?.evidence.find((item) =>
      isTwinId(item.id, [node.id, ...node.references], 'evidence'),
    );
    const source = node.provenance.find((item) => item.confirmedByUser && item.pageNumber !== null && item.pageNumber !== undefined);
    const document = evidence?.documentId
      ? caseState?.documents.find((item) => item.id === evidence.documentId)
      : undefined;

    if (source?.pageNumber !== null && source?.pageNumber !== undefined) {
      const location = document?.filename ? `of ${document.filename}` : 'of the linked document';
      return isCurrent
        ? `This evidence is user-confirmed and comes from page ${source.pageNumber} ${location}. Its recorded status is ${humanize(node.status)}.`
        : `This historical evidence record is user-confirmed and cites page ${source.pageNumber}. Its historical status is ${humanize(node.status)}. The linked filename${document?.filename ? ` (${document.filename})` : ''} comes from current CaseState metadata, outside this dated projection.`;
    }

    const sourceDescription = provenanceNote(node.provenance);
    return `This evidence is recorded as ${humanize(node.status)}. ${sourceDescription ?? 'The Twin does not include a page-level source reference for this record.'}`;
  }

  if (node.kind === 'document') {
    const document = caseState?.documents.find((item) =>
      isTwinId(item.id, [node.id, ...node.references], 'document') ||
      node.provenance.some((source) => source.sourceId === item.id),
    );
    if (!document) {
      return `This document record is present in the Twin as ${humanize(node.status)}. Its saved document metadata could not be matched to this record.`;
    }
    return isCurrent
      ? `${document.filename} is recorded as ${humanize(document.processingStatus)} with review status ${humanize(document.reviewStatus)}. It has ${document.pageCount} page${document.pageCount === 1 ? '' : 's'}.`
      : `Current CaseState metadata lists ${document.filename} as ${humanize(document.processingStatus)} with review status ${humanize(document.reviewStatus)} and ${document.pageCount} page${document.pageCount === 1 ? '' : 's'}. These current document details are outside the selected historical projection.`;
  }

  if (node.kind === 'authority' || node.kind === 'procedure') {
    const description = node.kind === 'procedure'
      ? 'This procedure is recorded in the selected Twin projection.'
      : 'This source is linked to the selected Twin projection.';
    return `${description} Its applicability still depends on your jurisdiction, the established facts, timing, and source verification. The Twin records its status as ${humanize(node.status)}.`;
  }

  if (node.kind === 'event') {
    return `This event is recorded in the case timeline as ${humanize(node.status)}. ${node.summary}${node.temporallyUncertain ? ' Its timing is marked uncertain.' : ''}`;
  }

  if (node.kind === 'fact' || node.kind === 'claim') {
    return `${node.kind === 'fact' ? 'This fact' : 'This claim'} is recorded as ${humanize(node.status)}: ${node.summary}${node.temporallyUncertain ? ' Its timing is not established.' : ''}`;
  }

  if (node.kind === 'person' || node.kind === 'party') {
    return `${node.kind === 'person' ? 'This person' : 'This party'} is recorded as ${humanize(node.status)}. ${node.summary}`;
  }

  if (node.kind === 'action') {
    return `This is a suggested next action from the current case analysis, not a completed step. ${node.summary}`;
  }

  return `${node.title} is recorded as ${humanize(node.status)}. ${node.summary}${provenanceNote(node.provenance) ? ` ${provenanceNote(node.provenance)}` : ''}`;
}

function edgeExplanation(edge: TwinGuideEdgeContext): string {
  const meaning: Record<string, string> = {
    involves: 'The case record links these people or parties to the event.',
    'occurred at': 'The case record places the event at this time or point.',
    supports: 'The source record is linked as support for the connected claim or fact.',
    'conflicts with': 'The source record is explicitly linked as conflicting with the connected record.',
    references: 'One record explicitly refers to the other.',
    'relates to': 'The case record links these items without a more specific relationship.',
    'applies to': 'The source is linked to this item; that link alone does not establish legal applicability.',
    'leads to': 'The case record links this item to a later step or result.',
    'available at': 'The procedure is linked to the named authority.',
  };
  const explanation = meaning[edge.relation.toLowerCase()] ?? 'This is an explicit relationship stored in the Twin.';
  const conflict = edge.status === 'conflicting'
    ? ' The relationship is marked conflicting.'
    : '';
  const uncertainty = edge.status === 'unknown' || edge.status === 'assumption' || edge.status === 'system_inferred'
    ? ` The relationship is marked ${humanize(edge.status)}, so it should not be treated as established.`
    : '';
  const source = provenanceNote(edge.provenance);
  return `${edge.source.title} ${edge.relation} ${edge.target.title}. ${explanation} Its recorded status is ${humanize(edge.status)}.${conflict}${uncertainty}${source ? ` ${source}` : ''}`;
}

function buildResponse(
  caseState: CaseState | null,
  node: TwinGuideNodeContext | null,
  edge: TwinGuideEdgeContext | null,
  timeline: TwinGuideTimelineContext,
) {
  const time = displayDate(timeline.at);
  if (!timeline.projectionReady) {
    return {
      id: `twin:${caseState?.id ?? 'case'}:loading:${timeline.at ?? 'current'}`,
      text: `The Twin is loading the saved case state for ${time}. I’ll explain the selected records after that dated projection is available.`,
    };
  }

  const timeExplanation = timeline.isCurrent
    ? `The Twin is showing the latest saved case state as of ${time}.`
    : `The timeline is showing the case state as of ${time}${timeline.activeEvent ? `, with ${timeline.activeEvent.title} as the latest dated event in view` : ''}. This is a historical view of the saved record. Guide status and any linked document details refer to the latest CaseState, outside this dated projection.`;
  const subject = edge
    ? edgeExplanation(edge)
    : node
      ? nodeExplanation(node, caseState, timeline.isCurrent)
      : timeline.activeEvent
        ? `${timeline.activeEvent.title} is the latest dated event in this view. ${timeline.activeEvent.summary}`
        : 'Select a person, fact, event, evidence record, legal source, procedure, or relationship and I’ll explain what the saved Twin records.';

  return {
    id: `twin:${caseState?.id ?? 'case'}:${edge?.id ?? node?.id ?? 'overview'}:${timeline.at ?? 'current'}:${timeline.isCurrent ? 'current' : 'historical'}`,
    text: `${subject} ${timeExplanation}`,
  };
}

function availableContextActions(
  snapshot: GuideRuntimeSnapshot,
  caseState: CaseState | null,
  node: TwinGuideNodeContext | null,
  edge: TwinGuideEdgeContext | null,
  timeline: TwinGuideTimelineContext,
): CompanionAction[] {
  if (!caseState) return [];
  const available = snapshot.availableActions;
  const selectionIds = [
    ...(node ? [node.id, ...node.references] : []),
    ...(edge ? [edge.source.id, edge.target.id] : []),
  ];
  const selectedKinds = new Set([
    ...(node ? [node.kind] : []),
    ...(edge ? [edge.source.kind, edge.target.kind] : []),
  ]);
  const actions: CompanionAction[] = [];
  const evidenceAction = available.find((action) => action.type === 'SHOW_EVIDENCE');
  const relatedEvidence = caseState.evidence.filter((item) =>
    isTwinId(item.id, selectionIds, 'evidence'),
  );
  const relatedDocumentIds = new Set<string>();

  relatedEvidence.forEach((item) => {
    if (item.documentId) relatedDocumentIds.add(item.documentId);
  });

  const relatedDocuments = caseState.documents.filter((document) =>
    isTwinId(document.id, selectionIds, 'document') ||
    node?.provenance.some((source) => source.sourceId === document.id) ||
    relatedDocumentIds.has(document.id),
  );
  const selectedEvidence = relatedEvidence.find((item) => node && isTwinId(item.id, [node.id], 'evidence'))
    ?? relatedEvidence[0];
  const selectedEvidenceDocument = selectedEvidence?.documentId
    ? relatedDocuments.find((document) => document.id === selectedEvidence.documentId)
    : undefined;

  if (evidenceAction && selectedEvidence) {
    actions.push({
      action: selectedEvidenceDocument
        ? { type: 'openDocument', documentId: selectedEvidenceDocument.id }
        : { type: 'openEvidence', evidenceId: selectedEvidence.id },
      label: 'Inspect evidence',
    });
  }

  const relatedDocument = selectedEvidenceDocument ?? relatedDocuments[0];
  if (relatedDocument && !actions.some((item) => 'type' in item.action && item.action.type === 'openDocument' && item.action.documentId === relatedDocument.id)) {
    actions.push({
      action: { type: 'openDocument', documentId: relatedDocument.id },
      label: 'Open document',
    });
  }

  if (selectedKinds.has('authority') || selectedKinds.has('procedure') || selectedKinds.has('issue')) {
    const legalGrounding = available.find((action) => action.type === 'SHOW_LEGAL_GROUNDING');
    if (legalGrounding) actions.push({ action: legalGrounding, label: 'Open legal grounding' });
  }

  if (selectedKinds.has('event') || selectedKinds.has('procedure') || selectedKinds.has('action')) {
    const journey = available.find((action) => action.type === 'OPEN_JOURNEY');
    if (journey) actions.push({ action: journey, label: 'Inspect journey' });
  }

  if (!timeline.isCurrent && timeline.projectionReady) {
    actions.push({ action: { type: 'openTwin' }, label: 'Return to current state' });
  }

  return actions;
}

function presenceFor(
  snapshot: GuideRuntimeSnapshot,
  caseState: CaseState | null,
  node: TwinGuideNodeContext | null,
  edge: TwinGuideEdgeContext | null,
  timeline: TwinGuideTimelineContext,
): GuidePresenceState {
  const caseStateName = deriveGuideState(caseState).name;
  if (caseStateName === 'safety') return 'SAFETY';
  if (!timeline.projectionReady) return 'PROCESSING';

  const status = edge?.status ?? node?.status;
  if (status === 'conflicting') return 'CONFLICT';
  if (caseStateName === 'conflict') return 'CONFLICT';
  if (status === 'unknown' || node?.unresolved) return 'ASKING';
  if (caseStateName === 'asking') return 'ASKING';
  if (status === 'assumption' || status === 'system_inferred' || node?.temporallyUncertain) return 'UNCERTAIN';
  if (caseStateName === 'uncertain') return 'UNCERTAIN';
  if (node?.kind === 'evidence') return 'EVIDENCE';
  if (node?.kind === 'authority') return 'UNCERTAIN';

  return snapshot.state.name === 'action' || snapshot.state.name === 'completion'
    ? 'EXPLAINING'
    : snapshot.state.name.toUpperCase() as GuidePresenceState;
}

function presenceDetail(
  node: TwinGuideNodeContext | null,
  edge: TwinGuideEdgeContext | null,
  timeline: TwinGuideTimelineContext,
): string {
  const subject = edge
    ? 'Relationship selected'
    : node
      ? `${humanize(node.kind)} selected`
      : 'Following the Twin';
  return `${subject} · ${timeline.isCurrent ? 'Current saved state' : 'Historical state'}`;
}

export function TwinGuideCompanion({
  caseState,
  node,
  edge,
  timeline,
  onActionRequested,
}: TwinGuideCompanionProps) {
  const response = useMemo(
    () => buildResponse(caseState, node, edge, timeline),
    [caseState, edge, node, timeline],
  );
  const runtimeSnapshot = useMemo(() => {
    const initial = createInitialGuideRuntime(caseState);
    return orchestrateGuideEvent(initial, { type: 'GUIDE_RESPONSE_READY', response }).snapshot;
  }, [caseState, response]);

  const actions = useMemo(
    () => availableContextActions(runtimeSnapshot, caseState, node, edge, timeline),
    [caseState, edge, node, runtimeSnapshot, timeline],
  );
  const presence = presenceFor(runtimeSnapshot, caseState, node, edge, timeline);

  function selectAction(action: GuideAction | GuideActionCommand) {
    if (!('payload' in action)) {
      onActionRequested(action);
      return;
    }
    const result = orchestrateGuideEvent(runtimeSnapshot, { type: 'GUIDE_ACTION_SELECTED', action });
    if (result.emissions.some((emission) => emission.type === 'action_requested')) {
      onActionRequested(action);
    }
  }

  return (
    <aside
      aria-label="Living Legal Twin Guide"
      className="h-full rounded-xl border border-cyan-100/10 bg-[#101827] p-4 shadow-none"
    >
      <div>
        <GuidePresence
          state={presence}
          detail={presenceDetail(node, edge, timeline)}
          size="compact"
          className="!w-full !max-w-none !rounded-lg !border-0 !bg-transparent !p-0 !shadow-none"
        />
        <p className="mt-2 text-[10px] text-slate-400">Living Twin Guide · grounded in the saved case record</p>
      </div>

      <p className="mt-4 text-sm leading-6 text-[#d8e3fb]">{runtimeSnapshot.response?.text ?? response.text}</p>

      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Contextual Guide actions">
          {actions.map(({ action, label }) => (
            <button
              key={`${action.type}:${JSON.stringify(action)}`}
              type="button"
              onClick={() => selectAction(action)}
              className="min-h-9 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.05] px-3 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/30 hover:bg-cyan-200/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
