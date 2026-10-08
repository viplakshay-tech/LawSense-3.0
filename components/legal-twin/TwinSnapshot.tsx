import { formatTwinTime, parseTwinTime } from './semantics';
import type { TwinSnapshotData } from './types';

export interface TwinSnapshotProps {
  snapshot: TwinSnapshotData;
  selected?: boolean;
  onSelect?: (snapshot: TwinSnapshotData) => void;
}

export function TwinSnapshot({ snapshot, selected = false, onSelect }: TwinSnapshotProps) {
  const snapshotTime = parseTwinTime(snapshot.at);
  const contents = (
    <>
      <span className="block text-sm font-medium text-slate-100">{snapshot.label}</span>
      <time
        className="mt-1 block text-xs text-slate-400"
        dateTime={snapshotTime === null ? undefined : new Date(snapshotTime).toISOString()}
      >
        {formatTwinTime(snapshot.at)}
      </time>
      {snapshot.description && (
        <span className="mt-2 block text-xs leading-5 text-slate-400">{snapshot.description}</span>
      )}
      {snapshot.graph && (
        <span className="mt-2 block text-[11px] text-slate-500">
          {snapshot.graph.nodes.length} nodes · {snapshot.graph.edges.length} relationships
        </span>
      )}
    </>
  );

  return onSelect ? (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(snapshot)}
      className={`min-w-44 rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
        selected
          ? 'border-cyan-400/50 bg-cyan-400/[0.08]'
          : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      {contents}
    </button>
  ) : (
    <article
      className={`min-w-44 rounded-xl border p-3 ${
        selected ? 'border-cyan-400/50 bg-cyan-400/[0.08]' : 'border-white/[0.08] bg-white/[0.02]'
      }`}
    >
      {contents}
    </article>
  );
}
