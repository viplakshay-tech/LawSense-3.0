import { BadgeCheck, ExternalLink, Globe2, Phone } from 'lucide-react';
import { SafetySurface } from './SafetySurface';
import { safetyActionCopy, safetyCategoryLabel } from './copy';
import type { SafetyLanguage, SafetySupportAssessment, SafetySupportResource } from './types';

function secureWebUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safePhone(value: string | null | undefined): string | null {
  if (!value?.trim() || !/^\+?[\d\s().-]{3,24}$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 20) return null;
  return `${value.trim().startsWith('+') ? '+' : ''}${digits}`;
}

function isDisplayableResource(resource: SafetySupportResource, categories: string[]): boolean {
  return Boolean(
    resource.official === true &&
      resource.verification_status === 'verified_official' &&
      resource.name?.trim() &&
      resource.category &&
      categories.includes(resource.category),
  );
}

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
    resourcesUpdating: string;
  };
}) {
  const categories = assessment?.resource_categories ?? [];
  const resources = (assessment?.resources ?? []).filter((item) =>
    isDisplayableResource(item, categories),
  );

  return (
    <SafetySurface id="verified-safety-resources" tabIndex={-1} className="scroll-mt-6 outline-none focus-visible:ring-2 focus-visible:ring-teal-100/50">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100/10 bg-indigo-100/[0.045] text-indigo-100/75">
          <Globe2 aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-100/65">{copy.categoriesEyebrow}</p>
          <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">{copy.categoriesTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{copy.categoriesDescription}</p>
        </div>
      </div>

      {categories.length > 0 ? (
        <ul className="mt-5 flex flex-wrap gap-2">
          {categories.map((category) => (
            <li key={category} className="rounded-lg border border-indigo-100/[0.09] bg-indigo-100/[0.035] px-3 py-2 text-xs text-zinc-300">
              {safetyCategoryLabel(category, language)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm leading-6 text-zinc-500">
          {copy.noCategories}
        </p>
      )}

      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <div className="flex items-center gap-2">
          <BadgeCheck aria-hidden="true" className="size-4 text-teal-100/70" />
          <h3 className="text-sm font-medium text-zinc-200">{copy.verifiedResources}</h3>
        </div>
        {resources.length > 0 ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {resources.map((resource, index) => (
              <ResourceCard key={`${resource.category}-${resource.name}-${index}`} resource={resource} language={language} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-white/[0.06] bg-black/10 px-4 py-3 text-sm leading-6 text-zinc-500">
            {copy.noResources}
          </p>
        )}
      </div>
    </SafetySurface>
  );
}

function ResourceCard({ resource, language }: { resource: SafetySupportResource; language: SafetyLanguage }) {
  const url = secureWebUrl(resource.url);
  const phone = safePhone(resource.phone);
  const category = resource.category ? safetyCategoryLabel(resource.category, language) : '';
  const actionCopy = safetyActionCopy[language];

  return (
    <li className="rounded-xl border border-white/[0.075] bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-zinc-100">{resource.name}</h4>
          {category && <p className="mt-1 text-[11px] text-zinc-500">{category}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-teal-100/10 bg-teal-100/[0.04] px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-teal-100/65">
          <BadgeCheck aria-hidden="true" className="size-3" />
          {language === 'hi' ? 'आधिकारिक' : language === 'hinglish' ? 'Official' : 'Official'}
        </span>
      </div>
      {resource.description?.trim() && <p className="mt-3 text-xs leading-5 text-zinc-400">{resource.description}</p>}
      {resource.jurisdiction?.trim() && <p className="mt-3 text-[10px] text-zinc-500">{resource.jurisdiction}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/70"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            {actionCopy.openWebsite}
          </a>
        )}
        {phone && (
          <a
            href={`tel:${phone}`}
            aria-label={`${actionCopy.callResource} ${resource.name} · ${resource.phone}`}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/70"
          >
            <Phone aria-hidden="true" className="size-3.5" />
            {actionCopy.callResource} · {resource.phone}
          </a>
        )}
      </div>
      {phone && <p className="mt-3 text-[10px] leading-4 text-zinc-500">{actionCopy.callDisclosure}</p>}
    </li>
  );
}
