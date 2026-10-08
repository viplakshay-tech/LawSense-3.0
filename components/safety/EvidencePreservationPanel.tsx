import { FileLock2, LockKeyhole } from 'lucide-react';
import { SafetySurface } from './SafetySurface';

export function EvidencePreservationPanel({
  guidance,
  expanded,
  onToggle,
  copy,
}: {
  guidance: string[];
  expanded: boolean;
  onToggle: () => void;
  copy: {
    evidenceEyebrow: string;
    evidenceTitle: string;
    evidenceDescription: string;
    evidenceCaveat: string;
    evidenceNone: string;
    evidenceAction: string;
    hideEvidenceAction: string;
  };
}) {
  return (
    <SafetySurface id="evidence-preservation-guidance" tabIndex={-1} className="scroll-mt-6 outline-none focus-visible:ring-2 focus-visible:ring-teal-100/50">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-sky-100/10 bg-sky-100/[0.045] text-sky-100/75">
          <FileLock2 aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-100/65">{copy.evidenceEyebrow}</p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">{copy.evidenceTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{copy.evidenceDescription}</p>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="evidence-guidance-list"
        onClick={onToggle}
        className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-100/50"
      >
        {expanded ? copy.hideEvidenceAction : copy.evidenceAction}
      </button>
      <div id="evidence-guidance-list" hidden={!expanded}>
        {guidance.length > 0 ? (
          <ul className="mt-5 space-y-3">
            {guidance.map((item, index) => (
              <li key={`${index}-${item}`} className="flex gap-3 text-sm leading-6 text-zinc-300">
                <span aria-hidden="true" className="mt-[9px] size-1.5 shrink-0 rounded-full bg-sky-100/55" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-sm leading-6 text-zinc-500">{copy.evidenceNone}</p>
        )}
      </div>
      <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/10 px-3.5 py-3 text-xs leading-5 text-zinc-500">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <p>{copy.evidenceCaveat}</p>
      </div>
    </SafetySurface>
  );
}
