import { FileLock2, LockKeyhole } from 'lucide-react';
import { SafetySurface } from './SafetySurface';

export function EvidencePreservationPanel({
  guidance,
  copy,
}: {
  guidance: string[];
  copy: {
    evidenceEyebrow: string;
    evidenceTitle: string;
    evidenceDescription: string;
    evidenceCaveat: string;
    evidenceNone: string;
  };
}) {
  return (
    <SafetySurface>
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
      <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/10 px-3.5 py-3 text-xs leading-5 text-zinc-500">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <p>{copy.evidenceCaveat}</p>
      </div>
    </SafetySurface>
  );
}
