import { useId } from 'react';
import { categoryColor, TWIN_COLORS } from './semantics';
import { TWIN_NODE_CATEGORIES, type TwinNodeCategory } from './types';

const CATEGORY_LABELS: Record<TwinNodeCategory, string> = {
  PERSON: 'Person',
  PARTY: 'Party',
  EVENT: 'Event / system',
  CLAIM: 'Claim',
  DOCUMENT: 'Document',
  EVIDENCE: 'Evidence',
  LEGAL_ISSUE: 'Legal issue',
  PROCEDURE: 'Procedure',
  AUTHORITY: 'Authority',
  ACTION: 'Action',
};

const STATUS_ITEMS = [
  { label: 'Supported', color: TWIN_COLORS.supported },
  { label: 'User reported', color: TWIN_COLORS.userReported },
  { label: 'Uncertain', color: TWIN_COLORS.uncertain },
  { label: 'Conflicting', color: TWIN_COLORS.conflict },
  { label: 'Unknown', color: TWIN_COLORS.unknown },
] as const;

export function TwinLegend({ className = '' }: { className?: string }) {
  const headingId = `twin-legend-heading-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-2xl border border-white/[0.08] bg-[#090d16] p-4 ${className}`}
    >
      <h2 id={headingId} className="text-sm font-semibold text-slate-100">
        Legend
      </h2>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2.5">
        {TWIN_NODE_CATEGORIES.map((category) => (
          <li key={category} className="flex items-center gap-2 text-xs text-slate-300">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10"
              style={{ backgroundColor: categoryColor(category) }}
            />
            {CATEGORY_LABELS[category]}
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-white/[0.07] pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Evidence and review status
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2.5">
          {STATUS_ITEMS.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-xs text-slate-300">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
