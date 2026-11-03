import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, ExternalLink, HeartHandshake, ShieldAlert } from 'lucide-react';
import { verifiedOfficialResourceUrl } from '@/lib/officialResources';

type RegistryResource = {
  resource_id: string;
  name: string;
  categories: string[];
  jurisdiction: string;
  jurisdiction_scope: string;
  verification_status: string;
  url?: string;
  phone?: string;
  phone_purpose?: string;
  description?: string;
  availability_note?: string;
  accessibility_options?: string;
  source_url?: string;
  verified_on?: string;
  excluded_states?: string[];
};

async function readResourceCatalog(): Promise<RegistryResource[]> {
  'use cache';

  const registryPaths = [
    // Public repository checkout: frontend and API live side by side.
    resolve(process.cwd(), 'api/app/engines/safety_support/data/india_official_resources.json'),
    // Backward compatibility for older apps/api + apps/web workspace layouts.
    resolve(process.cwd(), '../../apps/api/app/engines/safety_support/data/india_official_resources.json'),
  ];

  for (const registryPath of registryPaths) {
    try {
      const registryText = await readFile(registryPath, 'utf8');
      const parsed: unknown = JSON.parse(registryText);
      if (Array.isArray(parsed)) return parsed as RegistryResource[];
    } catch {
      // Try the other known repository layout. If neither exists, fail closed
      // with no listings rather than fabricating emergency contacts.
    }
  }
  return [];
}

function verifiedIndiaResources(catalog: RegistryResource[]): RegistryResource[] {
  return catalog.filter((resource) =>
    resource.jurisdiction === 'IN' &&
    resource.jurisdiction_scope === 'countrywide' &&
    resource.verification_status === 'verified_official' &&
    resource.resource_id &&
    (resource.categories.includes('emergency') ||
      resource.categories.some((category) => [
        'women_child_protection',
        'workplace_safeguarding',
        'cybercrime',
        'cyber_safety',
        'legal_aid',
      ].includes(category))),
  );
}

function categoryName(resource: RegistryResource): string {
  if (resource.categories.includes('emergency')) return 'Immediate emergency';
  if (resource.categories.includes('women_child_protection')) return 'Women’s support';
  if (resource.categories.includes('workplace_safeguarding')) return 'Workplace support';
  if (resource.categories.some((category) => category === 'cybercrime' || category === 'cyber_safety')) return 'Online safety';
  if (resource.categories.includes('legal_aid')) return 'Legal aid';
  return 'Official support';
}

function ResourceCard({ resource }: { resource: RegistryResource }) {
  const url = verifiedOfficialResourceUrl(resource.url);
  const sourceUrl = verifiedOfficialResourceUrl(resource.source_url);
  const verifiedEmergencyPhone = resource.categories.includes('emergency') ? resource.phone : null;
  const purposePhone = resource.phone_purpose ? resource.phone : null;

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-200/75">{categoryName(resource)}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{resource.name}</h2>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-200/20 bg-emerald-100/[0.06] px-2.5 py-1 text-[10px] font-medium text-emerald-100/90">
          Verified official listing
        </span>
      </div>

      {resource.description && <p className="mt-3 text-sm leading-6 text-zinc-300">{resource.description}</p>}
      {resource.availability_note && (
        <p className="mt-3 rounded-xl border border-amber-100/10 bg-amber-50/[0.035] px-3 py-2.5 text-xs leading-5 text-amber-100/85">
          {resource.availability_note}
        </p>
      )}
      {resource.accessibility_options && (
        <p className="mt-3 text-xs leading-5 text-zinc-400">{resource.accessibility_options}</p>
      )}
      {resource.verified_on && (
        <p className="mt-3 text-[10px] text-zinc-500">Registry verification recorded · {resource.verified_on} · India</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {verifiedEmergencyPhone && (
          <a
            href={'tel:' + verifiedEmergencyPhone}
            aria-label={'Call emergency response at ' + verifiedEmergencyPhone}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-200 px-4 text-sm font-bold text-[#32151f] transition hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100 motion-reduce:transition-none"
          >
            Call · {verifiedEmergencyPhone}
          </a>
        )}
        {purposePhone && (
          <a
            href={'tel:' + purposePhone}
            aria-label={'Call ' + resource.name + ' at ' + purposePhone + ' · ' + resource.phone_purpose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200/25 bg-rose-100/[0.07] px-4 text-sm font-semibold text-rose-50 transition hover:bg-rose-100/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100 motion-reduce:transition-none"
          >
            Call · {purposePhone} <span className="ml-1 text-xs font-normal text-rose-100/75">({resource.phone_purpose})</span>
          </a>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100 motion-reduce:transition-none"
          >
            Open official service <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        {sourceUrl && sourceUrl !== url && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-medium text-zinc-400 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100 motion-reduce:transition-none"
          >
            Check source <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>
      {(verifiedEmergencyPhone || purposePhone) && (
        <p className="mt-3 text-[10px] leading-4 text-zinc-500">Choosing Call opens your device’s calling app. LawSense does not place a call.</p>
      )}
    </article>
  );
}

export default async function WomenSafetyPage() {
  const resources = verifiedIndiaResources(await readResourceCatalog());
  const emergencyResource = resources.find((resource) => resource.categories.includes('emergency'));
  const supportResources = resources.filter((resource) => !resource.categories.includes('emergency'));

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_rgba(112,48,69,0.23),_transparent_48%),linear-gradient(150deg,#100d11_0%,#171017_55%,#100e13_100%)] text-zinc-100">
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
          <Link href="/" aria-label="Return to LawSense homepage" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100 motion-reduce:transition-none">
            <ArrowLeft size={16} aria-hidden="true" /> LawSense
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-rose-200/20 bg-rose-100/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-100/90">
            <HeartHandshake size={14} aria-hidden="true" /> Women &amp; Safety
          </span>
        </header>

        <section aria-labelledby="safety-title" className="mt-7 rounded-[1.75rem] border border-rose-200/20 bg-[linear-gradient(125deg,rgba(91,39,58,0.55),rgba(25,18,25,0.96)_68%)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.22)] sm:mt-10 sm:p-9">
          <p className="inline-flex items-center gap-2 rounded-full border border-rose-100/15 bg-black/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-100/85">
            <ShieldAlert size={13} aria-hidden="true" /> No case needed
          </p>
          <h1 id="safety-title" className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">
            Women &amp; Safety
          </h1>
          <p className="mt-3 text-lg font-medium text-rose-100 sm:text-xl">Immediate safety guidance &amp; official support</p>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-zinc-300 sm:text-base">
            If you may be in immediate danger, use a safe way to reach emergency help or someone you trust. Choose an official option below when it feels safe to do so. You do not need to describe what happened or start a case first.
          </p>

          <div className="mt-6 rounded-2xl border border-rose-100/20 bg-black/20 p-4 sm:p-5">
            <p className="text-sm font-semibold text-white">Your choices stay yours.</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              LawSense does not automatically contact police, family, an employer, or anyone else. Opening a number launches your device’s calling app; opening a website does not submit a report from LawSense.
            </p>
          </div>

          {emergencyResource && <div className="mt-5 max-w-2xl"><ResourceCard resource={emergencyResource} /></div>}
        </section>

        <section aria-labelledby="official-options-title" className="mt-8">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-100/65">Verified resource registry</p>
              <h2 id="official-options-title" className="mt-1 text-xl font-semibold text-white sm:text-2xl">Other official support options</h2>
            </div>
            <p className="max-w-lg text-xs leading-5 text-zinc-400">These listings are from LawSense’s verified India resource catalog. Coverage and availability notes are shown where recorded; check the official source for your location.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {supportResources.map((resource) => <ResourceCard key={resource.resource_id} resource={resource} />)}
          </div>
        </section>

        <div className="mt-8 flex flex-col gap-3 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-zinc-500">If using this device or continuing this page feels unsafe, stop here. You can return to the LawSense case workflow later if you choose.</p>
          <Link href="/#your-story" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-100 motion-reduce:transition-none">
            Start a case when ready <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </main>
  );
}
