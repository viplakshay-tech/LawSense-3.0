import { ArrowUpRight, HandHeart } from 'lucide-react';
import { SafetySurface } from './SafetySurface';

export function SafetyPathway({
  options,
  copy,
}: {
  options: string[];
  copy: {
    pathwayEyebrow: string;
    pathwayTitle: string;
    pathwayDescription: string;
    noPathway: string;
  };
}) {
  return (
    <SafetySurface>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-100/10 bg-rose-100/[0.045] text-rose-100/75">
          <HandHeart aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100/65">{copy.pathwayEyebrow}</p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">{copy.pathwayTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{copy.pathwayDescription}</p>
        </div>
      </div>
      {options.length > 0 ? (
        <ol className="mt-5 space-y-2.5">
          {options.map((option, index) => (
            <li key={`${index}-${option}`} className="flex gap-3 rounded-xl border border-white/[0.065] bg-white/[0.02] px-4 py-3.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-white/[0.1] text-[10px] text-zinc-500">
                {index + 1}
              </span>
              <p className="min-w-0 flex-1 text-sm leading-6 text-zinc-300">{option}</p>
              <ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-zinc-600" />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm leading-6 text-zinc-500">
          {copy.noPathway}
        </p>
      )}
    </SafetySurface>
  );
}
