import { useId } from 'react';
import { formatTwinTime } from './semantics';
import type { TwinEdgeData, TwinNodeData, TwinTemporalValue } from './types';

export interface TwinInspectorProps {
  nodes: readonly TwinNodeData[];
  edges: readonly TwinEdgeData[];
  selectedNode?: string | null;
  selectedEdge?: string | null;
  currentTime?: TwinTemporalValue | null;
  className?: string;
}

type MetadataEntry = {
  key: string;
  value: unknown;
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
}

function humanize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Not provided';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function metadataEntries(
  values: TwinNodeData['metadata'] | TwinEdgeData['metadata'],
): MetadataEntry[] {
  if (!values || Object.keys(values).length === 0) return [];

  return Object.entries(values).map(([key, value]) => ({
    key,
    value,
  }));
}

function findMetadataValue(
  values: TwinNodeData['metadata'] | TwinEdgeData['metadata'] | undefined,
  aliases: string[],
): unknown {
  if (!values) return undefined;

  const normalizedAliases = new Set(aliases.map(normalizeKey));

  for (const [key, value] of Object.entries(values)) {
    if (normalizedAliases.has(normalizeKey(key))) {
      return value;
    }
  }

  return undefined;
}

function StatusPill({
  value,
  tone = 'neutral',
}: {
  value: unknown;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200'
      : tone === 'warning'
        ? 'border-amber-300/20 bg-amber-300/[0.06] text-amber-200'
        : tone === 'danger'
          ? 'border-rose-300/20 bg-rose-300/[0.06] text-rose-200'
          : 'border-white/10 bg-white/[0.04] text-slate-300';

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[10px] capitalize ${toneClass}`}
    >
      <span className="truncate">{displayValue(value)}</span>
    </span>
  );
}

function inferStatusTone(value: unknown): 'neutral' | 'good' | 'warning' | 'danger' {
  const normalized = String(value ?? '').toLowerCase();

  if (
    normalized.includes('supported') ||
    normalized.includes('verified') ||
    normalized.includes('confirmed') ||
    normalized.includes('applicable') ||
    normalized === 'true'
  ) {
    return 'good';
  }

  if (
    normalized.includes('conflict') ||
    normalized.includes('unsafe') ||
    normalized.includes('inapplicable') ||
    normalized.includes('not_applicable') ||
    normalized === 'false'
  ) {
    return 'danger';
  }

  if (
    normalized.includes('unknown') ||
    normalized.includes('unresolved') ||
    normalized.includes('uncertain') ||
    normalized.includes('possible') ||
    normalized.includes('potential') ||
    normalized.includes('assumption')
  ) {
    return 'warning';
  }

  return 'neutral';
}

function LegalGrounding({
  metadata,
}: {
  metadata: TwinNodeData['metadata'] | TwinEdgeData['metadata'];
}) {
  const sourceId = findMetadataValue(metadata, [
    'source_id',
    'sourceId',
    'authority_id',
    'authorityId',
  ]);

  const sourceType = findMetadataValue(metadata, [
    'source_type',
    'sourceType',
    'legal_source_type',
  ]);

  const sourcePath = findMetadataValue(metadata, [
    'source_path',
    'sourcePath',
    'source',
    'citation',
    'source_url',
    'sourceUrl',
  ]);

  const jurisdiction = findMetadataValue(metadata, [
    'jurisdiction',
    'jurisdiction_name',
    'jurisdictionName',
  ]);

  const applicability = findMetadataValue(metadata, [
    'applicability',
    'applicability_status',
    'applicabilityStatus',
    'legal_applicability',
  ]);

  const verification = findMetadataValue(metadata, [
    'verification',
    'verification_status',
    'verificationStatus',
    'verification_state',
  ]);

  const provision = findMetadataValue(metadata, [
    'provision',
    'provision_name',
    'provisionName',
    'section',
    'section_name',
    'sectionName',
    'legal_provision',
  ]);

  const authority = findMetadataValue(metadata, [
    'authority',
    'authority_name',
    'authorityName',
  ]);

  const hasGrounding =
    sourceId !== undefined ||
    sourceType !== undefined ||
    sourcePath !== undefined ||
    jurisdiction !== undefined ||
    applicability !== undefined ||
    verification !== undefined ||
    provision !== undefined ||
    authority !== undefined;

  if (!hasGrounding) return null;

  return (
    <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-200/80">
            Legal grounding
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Source-linked information supplied by the case record.
          </p>
        </div>
        <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-cyan-200">
          Evidence first
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {provision !== undefined && (
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Provision
            </p>
            <p className="mt-1 break-words text-xs font-medium text-slate-200">
              {displayValue(provision)}
            </p>
          </div>
        )}

        {authority !== undefined && (
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Authority
            </p>
            <p className="mt-1 break-words text-xs font-medium text-slate-200">
              {displayValue(authority)}
            </p>
          </div>
        )}

        {jurisdiction !== undefined && (
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Jurisdiction
            </p>
            <p className="mt-1 break-words text-xs font-medium text-slate-200">
              {displayValue(jurisdiction)}
            </p>
          </div>
        )}

        {sourceType !== undefined && (
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Source type
            </p>
            <p className="mt-1 break-words text-xs font-medium text-slate-200">
              {humanize(String(sourceType))}
            </p>
          </div>
        )}

        {applicability !== undefined && (
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Applicability
            </p>
            <div className="mt-1">
              <StatusPill
                value={applicability}
                tone={inferStatusTone(applicability)}
              />
            </div>
          </div>
        )}

        {verification !== undefined && (
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Verification
            </p>
            <div className="mt-1">
              <StatusPill
                value={verification}
                tone={inferStatusTone(verification)}
              />
            </div>
          </div>
        )}
      </div>

      {(sourceId !== undefined || sourcePath !== undefined) && (
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
          <p className="text-[9px] uppercase tracking-wide text-slate-500">
            Source reference
          </p>

          {sourcePath !== undefined && (
            <p className="mt-1 break-all text-xs leading-5 text-slate-300">
              {displayValue(sourcePath)}
            </p>
          )}

          {sourceId !== undefined && (
            <p className="mt-1 break-all font-mono text-[9px] text-slate-500">
              {displayValue(sourceId)}
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-5 text-slate-500">
        Presence in the Twin does not by itself establish that a provision
        applies to the user&apos;s situation. Applicability must remain grounded in
        jurisdiction, facts, timing, and authoritative source information.
      </p>
    </section>
  );
}

function Metadata({
  values,
}: {
  values: TwinNodeData['metadata'] | TwinEdgeData['metadata'];
}) {
  const entries = metadataEntries(values);

  if (entries.length === 0) return null;

  return (
    <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] px-3">
      {entries.map(({ key, value }) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 py-2.5"
        >
          <dt className="break-words text-xs text-slate-500">
            {humanize(key)}
          </dt>
          <dd className="break-words text-right text-xs text-slate-200">
            {displayValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TimeRange({
  from,
  to,
}: {
  from?: TwinTemporalValue;
  to?: TwinTemporalValue;
}) {
  if (from === undefined && to === undefined) return null;

  return (
    <p className="mt-3 text-xs text-slate-400">
      Active {from === undefined ? 'from the start' : `from ${formatTwinTime(from)}`}
      {to === undefined ? ' onward' : ` until ${formatTwinTime(to)}`}
    </p>
  );
}

function ProvenanceSummary({
  metadata,
}: {
  metadata: TwinNodeData['metadata'] | TwinEdgeData['metadata'];
}) {
  const provenanceStatus = findMetadataValue(metadata, [
    'provenance_status',
    'provenanceStatus',
    'status',
  ]);

  const confirmedByUser = findMetadataValue(metadata, [
    'confirmed_by_user',
    'confirmedByUser',
    'user_confirmed',
    'userConfirmed',
  ]);

  const confidence = findMetadataValue(metadata, [
    'confidence',
    'source_confidence',
  ]);

  const extractionMethod = findMetadataValue(metadata, [
    'extraction_method',
    'extractionMethod',
  ]);

  const pageNumber = findMetadataValue(metadata, [
    'page_number',
    'pageNumber',
    'page',
  ]);

  const hasAny =
    provenanceStatus !== undefined ||
    confirmedByUser !== undefined ||
    confidence !== undefined ||
    extractionMethod !== undefined ||
    pageNumber !== undefined;

  if (!hasAny) return null;

  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Provenance state
        </p>
        {provenanceStatus !== undefined && (
          <StatusPill
            value={provenanceStatus}
            tone={inferStatusTone(provenanceStatus)}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {confirmedByUser !== undefined && (
          <StatusPill
            value={
              String(confirmedByUser).toLowerCase() === 'true'
                ? 'User confirmed'
                : 'Not user confirmed'
            }
            tone={
              String(confirmedByUser).toLowerCase() === 'true'
                ? 'good'
                : 'warning'
            }
          />
        )}

        {confidence !== undefined && (
          <StatusPill
            value={`Confidence ${displayValue(confidence)}`}
            tone="neutral"
          />
        )}

        {extractionMethod !== undefined && (
          <StatusPill
            value={`Method ${humanize(String(extractionMethod))}`}
            tone="neutral"
          />
        )}

        {pageNumber !== undefined && (
          <StatusPill value={`Page ${displayValue(pageNumber)}`} tone="neutral" />
        )}
      </div>
    </section>
  );
}

export function TwinInspector({
  nodes,
  edges,
  selectedNode = null,
  selectedEdge = null,
  currentTime,
  className = '',
}: TwinInspectorProps) {
  const headingId = `twin-inspector-heading-${useId().replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  )}`;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const node = nodes.find((item) => item.id === selectedNode);
  const edge = edges.find((item) => item.id === selectedEdge);
  const source = edge ? nodeById.get(edge.source) : undefined;
  const target = edge ? nodeById.get(edge.target) : undefined;

  const selectedMetadata = node?.metadata ?? edge?.metadata;

  return (
    <aside
      aria-labelledby={headingId}
      aria-live="polite"
      className={`rounded-2xl border border-white/[0.08] bg-[#090d16] p-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-slate-100">
            Inspector
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {currentTime === null || currentTime === undefined
              ? 'Current time is not constrained'
              : `At ${formatTwinTime(currentTime)}`}
          </p>
        </div>

        {selectedMetadata && (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-slate-500">
            Traceable
          </span>
        )}
      </div>

      {!node && !edge ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs leading-5 text-slate-500">
          Select a graph node or relationship to inspect its supplied details,
          legal grounding, provenance, and explicit links.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {node && (
            <section aria-label="Selected node" className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {humanize(node.category)}
                </p>

                <h3 className="mt-1 break-words text-base font-semibold text-slate-100">
                  {node.label}
                </h3>

                {node.status && (
                  <div className="mt-2">
                    <StatusPill value={node.status} tone={inferStatusTone(node.status)} />
                  </div>
                )}
              </div>

              {node.description && (
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {node.description}
                </p>
              )}

              {node.occurredAt !== undefined && (
                <p className="text-xs text-slate-400">
                  Occurred {formatTwinTime(node.occurredAt)}
                </p>
              )}

              <TimeRange from={node.validFrom} to={node.validTo} />

              {node.metadata && (
                <>
                  <LegalGrounding metadata={node.metadata} />
                  <ProvenanceSummary metadata={node.metadata} />
                  <Metadata values={node.metadata} />
                </>
              )}
            </section>
          )}

          {edge && (
            <section
              aria-label="Selected relationship"
              className={node ? 'border-t border-white/[0.07] pt-4' : ''}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Relationship
              </p>

              <h3 className="mt-1 break-words text-base font-semibold text-slate-100">
                {edge.label}
              </h3>

              {(source || target) && (
                <p className="mt-2 break-words text-xs leading-5 text-slate-300">
                  {source?.label ?? edge.source}{' '}
                  {edge.directed === false ? '↔' : '→'}{' '}
                  {target?.label ?? edge.target}
                </p>
              )}

              {edge.status && (
                <div className="mt-2">
                  <StatusPill value={edge.status} tone={inferStatusTone(edge.status)} />
                </div>
              )}

              {edge.description && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {edge.description}
                </p>
              )}

              <TimeRange from={edge.validFrom} to={edge.validTo} />

              {edge.metadata && (
                <>
                  <LegalGrounding metadata={edge.metadata} />
                  <ProvenanceSummary metadata={edge.metadata} />
                  <Metadata values={edge.metadata} />
                </>
              )}

              {(source || target) && (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Graph context
                  </p>

                  <div className="mt-2 space-y-2">
                    <div>
                      <span className="text-[9px] uppercase tracking-wide text-slate-600">
                        From
                      </span>
                      <p className="mt-0.5 break-words text-xs text-slate-300">
                        {source?.label ?? edge.source}
                      </p>
                    </div>

                    <div>
                      <span className="text-[9px] uppercase tracking-wide text-slate-600">
                        To
                      </span>
                      <p className="mt-0.5 break-words text-xs text-slate-300">
                        {target?.label ?? edge.target}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
