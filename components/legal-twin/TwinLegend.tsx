import { useId } from 'react';
import { categoryColor } from './semantics';
import { TWIN_NODE_CATEGORIES, type TwinNodeCategory } from './types';
import { InformationStatusPill, type InformationDisplayStatus } from '@/components/design-system/InformationStatusPill';

const CATEGORY_LABELS: Record<TwinNodeCategory, string> = {
  PERSON: 'Person',
  PARTY: 'Party',
  EVENT: 'Event / system',
  FACT: 'Fact',
  CLAIM: 'Claim',
  DOCUMENT: 'Document',
  EVIDENCE: 'Evidence',
  LEGAL_ISSUE: 'Legal issue',
  LAW: 'Law',
  PROCEDURE: 'Procedure',
  AUTHORITY: 'Authority',
  ACTION: 'Action',
};

const STATUS_ITEMS: Array<{ status: InformationDisplayStatus; detail: string }> = [
  { status: 'user_reported', detail: 'Reported by the user; not independently confirmed.' },
  { status: 'evidence_supported', detail: 'A source is linked; authenticity and truth are not established by the label.' },
  { status: 'uncertain', detail: 'Available information does not establish this detail.' },
  { status: 'conflicting', detail: 'Recorded information disagrees; the conflict is unresolved.' },
  { status: 'unknown', detail: 'Not supplied or not established.' },
  { status: 'verification_required', detail: 'Check the source identity and current text before relying on it.' },
  { status: 'applicability_not_established', detail: 'A source match does not establish fit to these facts or jurisdiction.' },
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
          <li key={category} className="flex items-center gap-2 text-sm text-slate-200">
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
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Evidence and review status
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STATUS_ITEMS.map(({ status, detail }) => (
            <li key={status} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <InformationStatusPill status={status} />
              <p className="mt-2 text-sm leading-5 text-slate-300">{detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
