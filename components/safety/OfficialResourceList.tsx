import { BadgeCheck, ExternalLink, Phone } from 'lucide-react';
import { safetyCategoryLabel } from './copy';
import type {
  SafetyLanguage,
  SafetyResourceEligibility,
  SafetySupportAssessment,
  SafetySupportResource,
} from './types';
import { verifiedOfficialResourceUrl } from '@/lib/officialResources';

const labels: Record<SafetyLanguage, {
  officialSource: string;
  openResource: string;
  checkSource: string;
  call: string;
  otherPhone: string;
  sourceChecked: string;
  callDisclosure: string;
  noResources: string;
  uncertainAvailability: string;
  stateNotApplicable: string;
  wrongJurisdiction: string;
  unavailable: string;
}> = {
  en: {
    officialSource: 'Official source',
    openResource: 'Open official service',
    checkSource: 'Check official source',
    call: 'Call',
    otherPhone: 'Other phone option',
    sourceChecked: 'Source checked',
    callDisclosure: 'Selecting a number opens your device’s calling app. LawSense does not place a call.',
    noResources: 'No verified resource listing is available for the recorded location. Check an official government or district directory for local options.',
    uncertainAvailability: 'Availability could not be verified for the recorded location. Check the official source before using this service.',
    stateNotApplicable: 'The official registry marks this listing as not applicable to the recorded state. Check its source for current coverage and alternatives.',
    wrongJurisdiction: 'This official listing is for a different jurisdiction. Check a government or district directory for the recorded location.',
    unavailable: 'No verified official listing is available for this category and location.',
  },
  hi: {
    officialSource: 'आधिकारिक स्रोत',
    openResource: 'आधिकारिक सेवा खोलें',
    checkSource: 'आधिकारिक स्रोत देखें',
    call: 'कॉल करें',
    otherPhone: 'दूसरा फ़ोन विकल्प',
    sourceChecked: 'स्रोत जाँच की तारीख',
    callDisclosure: 'नंबर चुनने पर आपके डिवाइस का कॉल ऐप खुलेगा। LawSense कॉल नहीं करता।',
    noResources: 'दर्ज स्थान के लिए कोई सत्यापित सूची उपलब्ध नहीं है। स्थानीय विकल्पों के लिए सरकारी या ज़िला निर्देशिका देखें।',
    uncertainAvailability: 'दर्ज स्थान के लिए उपलब्धता सत्यापित नहीं हो सकी। सेवा इस्तेमाल करने से पहले आधिकारिक स्रोत देखें।',
    stateNotApplicable: 'आधिकारिक रजिस्ट्री इस सूची को दर्ज राज्य पर लागू नहीं बताती। कवरेज और विकल्पों के लिए स्रोत देखें।',
    wrongJurisdiction: 'यह आधिकारिक सूची किसी दूसरे अधिकार-क्षेत्र के लिए है। दर्ज स्थान की सरकारी या ज़िला निर्देशिका देखें।',
    unavailable: 'इस श्रेणी और स्थान के लिए कोई सत्यापित आधिकारिक सूची उपलब्ध नहीं है।',
  },
  hinglish: {
    officialSource: 'Official source',
    openResource: 'Official service kholein',
    checkSource: 'Official source dekhein',
    call: 'Call karein',
    otherPhone: 'Doosra phone option',
    sourceChecked: 'Source check ki tareekh',
    callDisclosure: 'Number chunne par aapke device ka call app khulega. LawSense call nahi karta.',
    noResources: 'Recorded location ke liye koi verified listing nahi mili. Local options ke liye official government ya district directory dekhein.',
    uncertainAvailability: 'Recorded location ke liye availability verify nahi hui. Service use karne se pehle official source dekhein.',
    stateNotApplicable: 'Official registry is listing ko recorded state par lagu nahi batati. Coverage aur alternatives ke liye source dekhein.',
    wrongJurisdiction: 'Yeh official listing kisi doosre jurisdiction ke liye hai. Recorded location ki official directory dekhein.',
    unavailable: 'Is category aur location ke liye koi verified official listing available nahi hai.',
  },
};

function safePhone(value: string | null | undefined): string | null {
  if (!value?.trim() || !/^\+?[\d\s().-]{3,24}$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 20) return null;
  return `${value.trim().startsWith('+') ? '+' : ''}${digits}`;
}

function isDisplayableResource(resource: SafetySupportResource, categories: string[]): boolean {
  const resourceCategories = resource.categories?.length
    ? resource.categories
    : resource.category ? [resource.category] : [];
  return Boolean(
    resource.official === true &&
      resource.verification_status === 'verified_official' &&
      resource.name?.trim() &&
      resource.resource_id?.trim() &&
      resourceCategories.some((category) => categories.includes(category)),
  );
}

function statusMessage(item: SafetyResourceEligibility, language: SafetyLanguage): string {
  const copy = labels[language];
  if (item.status === 'state_not_applicable') return copy.stateNotApplicable;
  if (item.status === 'jurisdiction_mismatch') return copy.wrongJurisdiction;
  if (item.status === 'unavailable') return copy.unavailable;
  return copy.uncertainAvailability;
}

function ResourceCard({ resource, language }: { resource: SafetySupportResource; language: SafetyLanguage }) {
  const copy = labels[language];
  const url = verifiedOfficialResourceUrl(resource.url);
  const sourceUrl = verifiedOfficialResourceUrl(resource.source_url);
  const phone = safePhone(resource.phone);
  const alternatePhone = safePhone(resource.alternate_phone);

  return (
    <li className="rounded-xl border border-white/[0.075] bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-zinc-100">{resource.name}</h4>
          {resource.category && <p className="mt-1 text-[11px] text-zinc-500">{safetyCategoryLabel(resource.category, language)}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-100/10 bg-rose-100/[0.04] px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-rose-100/65">
          <BadgeCheck aria-hidden="true" className="size-3" />{copy.officialSource}
        </span>
      </div>
      {resource.description?.trim() && <p className="mt-3 text-xs leading-5 text-zinc-400">{resource.description}</p>}
      {resource.availability_note?.trim() && <p className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2 text-[11px] leading-5 text-zinc-300">{resource.availability_note}</p>}
      {resource.accessibility_options?.trim() && <p className="mt-3 text-[11px] leading-5 text-zinc-400">{resource.accessibility_options}</p>}
      {resource.jurisdiction?.trim() && <p className="mt-3 text-[10px] text-zinc-500">Jurisdiction · {resource.jurisdiction}</p>}
      {resource.verified_on?.trim() && <p className="mt-1 text-[10px] text-zinc-500">{copy.sourceChecked} · {resource.verified_on}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/70">
            <ExternalLink aria-hidden="true" className="size-3.5" />{copy.openResource}
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`} aria-label={`${copy.call} ${resource.name} · ${resource.phone}${resource.phone_purpose ? ` · ${resource.phone_purpose}` : ''}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/70">
            <Phone aria-hidden="true" className="size-3.5" />{copy.call} · {resource.phone}{resource.phone_purpose ? ` · ${resource.phone_purpose}` : ''}
          </a>
        )}
        {alternatePhone && (
          <a href={`tel:${alternatePhone}`} aria-label={`${copy.otherPhone} · ${resource.alternate_phone}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/70">
            <Phone aria-hidden="true" className="size-3.5" />{copy.otherPhone} · {resource.alternate_phone}
          </a>
        )}
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/70">
            <ExternalLink aria-hidden="true" className="size-3.5" />{copy.checkSource}
          </a>
        )}
      </div>
      {(phone || alternatePhone) && <p className="mt-3 text-[10px] leading-4 text-zinc-500">{copy.callDisclosure}</p>}
    </li>
  );
}

function EligibilityNotice({ item, language }: { item: SafetyResourceEligibility; language: SafetyLanguage }) {
  const copy = labels[language];
  const sourceUrl = verifiedOfficialResourceUrl(item.source_url);
  return (
    <li className="rounded-xl border border-amber-100/10 bg-amber-100/[0.025] p-4">
      <p className="text-sm font-medium text-zinc-200">{item.name} · {safetyCategoryLabel(item.category, language)}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{statusMessage(item, language)}</p>
      {item.availability_note?.trim() && <p className="mt-2 text-xs leading-5 text-zinc-300">{item.availability_note}</p>}
      <p className="mt-2 text-[10px] text-zinc-500">Jurisdiction · {item.jurisdiction}{item.state ? ` · ${item.state}` : ''}{item.verified_on ? ` · ${copy.sourceChecked} ${item.verified_on}` : ''}</p>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-xs font-medium text-zinc-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/70">
          <ExternalLink aria-hidden="true" className="size-3.5" />{copy.checkSource}
        </a>
      )}
    </li>
  );
}

export function OfficialResourceList({
  assessment,
  language,
  noResourcesLabel,
}: {
  assessment: SafetySupportAssessment | null;
  language: SafetyLanguage;
  noResourcesLabel: string;
}) {
  const requestedCategories = assessment?.resource_categories ?? [];
  const resources = (assessment?.resources ?? []).filter((resource) =>
    isDisplayableResource(resource, requestedCategories),
  );
  const restricted = (assessment?.resource_eligibility ?? []).filter((item) =>
    item.status !== 'verified_official',
  );

  return (
    <div className="space-y-3">
      {resources.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {resources.map((resource) => <ResourceCard key={resource.resource_id} resource={resource} language={language} />)}
        </ul>
      ) : (
        <p className="rounded-xl border border-white/[0.06] bg-black/10 px-4 py-3 text-sm leading-6 text-zinc-500">{noResourcesLabel || labels[language].noResources}</p>
      )}
      {restricted.length > 0 && (
        <section aria-label="Resources requiring location confirmation">
          <h4 className="text-xs font-medium text-zinc-300">Location or availability needs confirmation</h4>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {restricted.map((item) => <EligibilityNotice key={item.resource_id} item={item} language={language} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
