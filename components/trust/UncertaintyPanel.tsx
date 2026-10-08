import { CircleHelp } from 'lucide-react';
import { SourceBadge } from './SourceBadge';

export interface UncertaintyPanelProps {
  items?: readonly string[] | null;
  title?: string;
}

export function UncertaintyPanel({ items, title = 'What remains unknown' }: UncertaintyPanelProps) {
  const hasItems = Boolean(items?.length);

  return (
    <section aria-label={title} className="rounded-2xl border border-amber-200/15 bg-amber-200/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CircleHelp aria-hidden="true" className="h-4 w-4 text-amber-100" />
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        </div>
        <SourceBadge status="UNKNOWN" />
      </div>
      {hasItems ? (
        <ul className="mt-3 space-y-2">
          {items?.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-5 text-zinc-300">
              <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-100/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-400">No information about unknowns or open questions was supplied.</p>
      )}
    </section>
  );
}
