import { Info, ShieldCheck } from 'lucide-react';
import { SafetySurface } from './SafetySurface';
import { safetyCategoryLabel } from './copy';
import type { SafetyLanguage, SafetySupportAssessment } from './types';

export function SafetyContextSummary({
  assessment,
  fallbackTopics = [],
  language,
  copy,
}: {
  assessment: SafetySupportAssessment | null;
  fallbackTopics?: string[];
  language: SafetyLanguage;
  copy: {
    contextEyebrow: string;
    contextTitle: string;
    contextDescription: string;
    contextCaveat: string;
    uncertaintyLabel: string;
    noSignal: string;
    possibleTopics: string;
  };
}) {
  const topics = assessment?.situations ?? fallbackTopics;
  const hasSignal = assessment
    ? assessment.context !== 'none' && assessment.context !== 'sensitive'
    : fallbackTopics.length > 0;

  return (
    <SafetySurface className="border-rose-100/[0.12] bg-[linear-gradient(135deg,rgba(47,29,37,0.64),rgba(17,19,25,0.98))]">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-rose-200/15 bg-rose-200/[0.06] text-rose-100/80">
          {hasSignal ? <ShieldCheck aria-hidden="true" className="size-5" /> : <Info aria-hidden="true" className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100/70">
            {copy.contextEyebrow}
          </p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100 sm:text-xl">
            {copy.contextTitle}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
            {assessment?.context === 'none' ? copy.noSignal : copy.contextDescription}
          </p>

          {topics.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                {copy.possibleTopics}
              </p>
              <ul className="flex flex-wrap gap-2">
                {topics.map((topic) => (
                  <li
                    key={topic}
                    className="rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-1.5 text-xs text-zinc-300"
                  >
                    {safetyCategoryLabel(topic, language)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assessment?.uncertainty && assessment.uncertainty.length > 0 && (
            <ul aria-label={copy.uncertaintyLabel} className="mt-4 space-y-2">
              {assessment.uncertainty.map((item, index) => (
                <li key={`${index}-${item}`} className="flex gap-2 text-xs leading-5 text-zinc-400">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-zinc-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs leading-5 text-zinc-500">
            {copy.contextCaveat}
          </p>
        </div>
      </div>
    </SafetySurface>
  );
}
