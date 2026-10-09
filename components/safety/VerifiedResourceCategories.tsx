import { Globe2 } from 'lucide-react';
import { SafetySurface } from './SafetySurface';
import { safetyCategoryLabel } from './copy';
import { OfficialResourceList } from './OfficialResourceList';
import type { SafetyLanguage, SafetySupportAssessment } from './types';

export function VerifiedResourceCategories({
  assessment,
  language,
  copy,
}: {
  assessment: SafetySupportAssessment | null;
  language: SafetyLanguage;
  copy: {
    categoriesEyebrow: string;
    categoriesTitle: string;
    categoriesDescription: string;
    noCategories: string;
    verifiedResources: string;
    noResources: string;
  };
}) {
  const categories = assessment?.resource_categories ?? [];

  return (
    <SafetySurface id="verified-safety-resources" tabIndex={-1} className="scroll-mt-6 outline-none focus-visible:ring-2 focus-visible:ring-rose-100/50">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-100/10 bg-rose-100/[0.045] text-rose-100/75">
          <Globe2 aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-100/65">{copy.categoriesEyebrow}</p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">{copy.categoriesTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{copy.categoriesDescription}</p>
        </div>
      </div>

      {categories.length > 0 ? (
        <ul className="mt-5 flex flex-wrap gap-2">
          {categories.map((category) => (
            <li key={category} className="rounded-lg border border-rose-100/[0.09] bg-rose-100/[0.035] px-3 py-2 text-xs text-zinc-300">
              {safetyCategoryLabel(category, language)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm leading-6 text-zinc-500">{copy.noCategories}</p>
      )}

      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-200">{copy.verifiedResources}</h3>
        </div>
        <OfficialResourceList
          assessment={assessment}
          language={language}
          noResourcesLabel={copy.noResources}
        />
      </div>
    </SafetySurface>
  );
}
