import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  Heart,
  HeartHandshake,
  Shield,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { verifiedOfficialResourceUrl } from '@/lib/officialResources';

const sources = {
  domesticViolence: {
    name: 'Protection of Women from Domestic Violence Act, 2005',
    url: 'https://indiacode.gov.in/handle/123456789/496007',
    provisions: 'Sections 3, 17, 18 and 20 are indexed in the local verified-source catalogue.',
    scope: 'Central legislation · India',
    status: 'Official India Code URL is catalogued as verified; source freshness is unknown.',
  },
  posh: {
    name: 'Sexual Harassment of Women at Workplace Act, 2013 (POSH)',
    url: 'https://indiacode.gov.in/handle/123456789/496008',
    provisions: 'Sections 3, 4, 6 and 9 are indexed in the local verified-source catalogue.',
    scope: 'Central legislation · workplace-specific',
    status: 'Official India Code URL is catalogued as verified; the local record notes text through 31 Aug 2021, so currentness is unknown.',
  },
  cyber: {
    name: 'National Cyber Crime Reporting Portal',
    url: 'https://cybercrime.gov.in/',
    provisions: 'Official reporting information includes a Women/Children Related Crime section.',
    scope: 'Government of India · cybercrime reporting information',
    status: 'Official government portal link; LawSense has not independently validated an individual filing route.',
  },
  legalAid: {
    name: 'National Legal Services Authority (NALSA)',
    url: 'https://nalsa.gov.in/promoting-inclusive-legal-system/',
    provisions: 'Information about inclusive legal services and access to legal aid.',
    scope: 'National legal services institutions · India',
    status: 'Official NALSA information page; eligibility and local service details should be checked with the relevant authority.',
  },
} as const;

function OfficialSource({ source }: { source: (typeof sources)[keyof typeof sources] }) {
  const href = verifiedOfficialResourceUrl(source.url);
  return (
    <div className="mt-5 rounded-2xl border border-rose-200/80 bg-white/75 p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8f4561]">Official source</p>
      <p className="mt-2 font-semibold leading-6 text-[#34232d]">{source.name}</p>
      <p className="mt-1 text-sm leading-6 text-[#66535e]">{source.provisions}</p>
      <dl className="mt-4 grid gap-2 text-xs leading-5 text-[#66535e] sm:grid-cols-2">
        <div><dt className="font-semibold text-[#49323e]">Scope</dt><dd>{source.scope}</dd></div>
        <div><dt className="font-semibold text-[#49323e]">Source status</dt><dd>{source.status}</dd></div>
      </dl>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-[#b85e7e]/35 bg-[#fff8fa] px-4 text-sm font-semibold text-[#813952] transition hover:bg-[#fbeaf0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f4561] motion-reduce:transition-none">
          Open official source <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      ) : (
        <p className="mt-4 text-sm text-[#813952]">This source link did not pass the official-domain check.</p>
      )}
    </div>
  );
}

function TopicCard({
  id,
  icon: Icon,
  eyebrow,
  title,
  description,
  nextStep,
  source,
  tone = 'rose',
}: {
  id: string;
  icon: typeof Heart;
  eyebrow: string;
  title: string;
  description: string;
  nextStep: string;
  source?: (typeof sources)[keyof typeof sources];
  tone?: 'rose' | 'berry';
}) {
  const accent = tone === 'berry' ? 'bg-[#7a3450] text-white' : 'bg-[#f8dfe8] text-[#803d57]';
  return (
    <article id={id} className="scroll-mt-8 rounded-[1.65rem] border border-[#ecd8df] bg-[#fffdfd] p-5 shadow-[0_18px_55px_rgba(94,44,64,0.07)] sm:p-7">
      <div className="flex items-start gap-4">
        <span className={'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ' + accent}>
          <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a667a]">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[#33232c] sm:text-2xl">{title}</h2>
        </div>
      </div>
      <p className="mt-5 max-w-3xl text-sm leading-7 text-[#5e4c55] sm:text-[15px]">{description}</p>
      <div className="mt-4 rounded-xl border-l-2 border-[#c87996] bg-[#fcf4f6] px-4 py-3 text-sm leading-6 text-[#59434e]">
        <span className="font-semibold text-[#71364d]">A careful next step · </span>{nextStep}
      </div>
      {source ? <OfficialSource source={source} /> : (
        <div className="mt-5 rounded-2xl border border-dashed border-[#d8bdc7] bg-[#fdf8fa] p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8f4561]">Coverage limit</p>
          <p className="mt-2 text-sm leading-6 text-[#66535e]">A matching statute, provision, scope and current official source have not been validated in this sprint. No section, process or deadline is asserted here.</p>
        </div>
      )}
    </article>
  );
}

export default function WomenLawsPage() {
  const nalsaUrl = verifiedOfficialResourceUrl(sources.legalAid.url);
  const cyberUrl = verifiedOfficialResourceUrl(sources.cyber.url);

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_rgba(243,211,222,0.74),_transparent_44%),linear-gradient(145deg,#fff9fb_0%,#f9edf1_48%,#fffdfc_100%)] text-[#33232c]">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-7 sm:pt-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex min-h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold text-[#65384b] transition hover:bg-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f4561]">
            <ArrowLeft size={16} aria-hidden="true" /> LawSense
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#d6afbe] bg-white/65 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#784257]">
            <HeartHandshake size={15} aria-hidden="true" /> Women &amp; Laws
          </span>
        </header>

        <section className="relative mt-8 overflow-hidden rounded-[2rem] border border-[#ebd4dd] bg-white/75 px-5 py-9 shadow-[0_25px_80px_rgba(95,41,62,0.08)] sm:mt-12 sm:px-10 sm:py-12 lg:px-14">
          <div className="absolute -right-14 -top-20 h-64 w-64 rounded-full border border-[#e7c5d1]/70" aria-hidden="true" />
          <div className="absolute -right-2 -top-8 h-40 w-40 rounded-full border border-[#e7c5d1]/50" aria-hidden="true" />
          <div className="relative max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-[#f7e5eb] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#87435d]">
              <Heart size={13} aria-hidden="true" /> A calm place to begin
            </p>
            <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.04em] text-[#35232d] sm:text-5xl">Women&apos;s rights, with sources and open questions in view.</h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#66535e] sm:text-base">
              Explore a few starting points for India. Each card distinguishes an official source from what still needs checking. This page offers legal information, not a decision about your situation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#domestic-violence" className="rounded-full bg-[#7a3450] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#64283f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a3450]">Browse topics</a>
              {nalsaUrl && <a href={nalsaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[#ba8297] bg-white px-4 py-2.5 text-sm font-semibold text-[#773950] transition hover:bg-[#fff4f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a3450]">Legal aid information <ArrowUpRight size={14} aria-hidden="true" /></a>}
            </div>
          </div>
        </section>

        <section aria-label="Women's rights topics" className="mt-7 grid gap-5 lg:grid-cols-2">
          <TopicCard
            id="domestic-violence"
            icon={Heart}
            eyebrow="Home and relationships"
            title="Domestic violence and dowry concerns"
            description="The Protection of Women from Domestic Violence Act is one central-law starting point for domestic violence concerns. Whether it fits depends on the relationship, conduct, location and current facts."
            nextStep="Keep a private note of what feels safe to record. A support worker or legal service can help identify which facts and protections apply."
            source={sources.domesticViolence}
          />
          <TopicCard
            id="sexual-violence"
            icon={Shield}
            eyebrow="Personal safety"
            title="Sexual violence, stalking and harassment"
            description="These situations can involve different laws and urgent safety needs. The applicable route depends on the conduct, age, location and immediate risk."
            nextStep="If it is safe, consider reaching a trusted person or a local support service. For urgent help, use a trusted local emergency service; LawSense does not place calls or contact anyone."
          />
          <TopicCard
            id="workplace-posh"
            icon={BriefcaseBusiness}
            eyebrow="At work"
            title="Workplace sexual harassment · POSH"
            description="The POSH Act addresses sexual harassment at work. Who handles a complaint and whether a particular process applies depends on workplace details and facts not captured on this general page."
            nextStep="Check whether an Internal Committee or Local Committee is available, the relevant workplace and dates, and the current official text before relying on a process or deadline."
            source={sources.posh}
            tone="berry"
          />
          <TopicCard
            id="cyber-safety"
            icon={Smartphone}
            eyebrow="Online safety"
            title="Cyber harassment and image-based abuse"
            description="For non-consensual images, online threats or harassment, the official portal below provides reporting information. This link is optional and opens only when you choose it."
            nextStep="Before opening a reporting service, consider device privacy and whether you want a trusted person with you. LawSense will not submit a report or contact a third party."
            source={sources.cyber}
          />
          <TopicCard
            id="child-marriage-maternity"
            icon={BookOpen}
            eyebrow="Family and health"
            title="Child marriage and maternity-related rights"
            description="These topics can involve protections, services and time-sensitive facts. The relevant law may depend on age, location, employment status and dates."
            nextStep="A local legal services institution can help check the current rules and the right authority for your circumstances."
          />
        </section>

        <section className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[1.65rem] border border-[#e8cfd8] bg-[#fffdfd] p-5 shadow-[0_18px_55px_rgba(94,44,64,0.06)] sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f8e8ee] text-[#813d57]"><BookOpen size={18} aria-hidden="true" /></span>
              <h2 className="text-lg font-semibold text-[#35232d]">Need help finding legal aid?</h2>
            </div>
            <p className="mt-4 text-sm leading-7 text-[#66535e]">NALSA provides information about legal services in India. Local availability, eligibility and the right office depend on your situation; check directly with the service.</p>
            <OfficialSource source={sources.legalAid} />
          </div>
          <aside className="rounded-[1.65rem] border border-[#dfbfcb] bg-[#f7e9ee] p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#843c56]"><TriangleAlert size={18} aria-hidden="true" /></span>
              <h2 className="text-lg font-semibold text-[#35232d]">You stay in control</h2>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[#594650]">
              <li>Official links open only after you choose them.</li>
              <li>LawSense does not call, file a report or contact an employer, authority or other person.</li>
              <li>Source status and missing details stay visible; no outcome or deadline is promised.</li>
            </ul>
            {cyberUrl && <a href={cyberUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#7a3450] px-4 text-sm font-semibold text-white transition hover:bg-[#64283f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a3450]">Open cybercrime portal <ArrowUpRight size={14} aria-hidden="true" /></a>}
            <Link href="/" className="mt-4 flex min-h-10 w-fit items-center gap-2 rounded-full px-1 text-sm font-semibold text-[#773950] hover:text-[#4f2436] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a3450]">
              <ArrowLeft size={15} aria-hidden="true" /> Return to LawSense
            </Link>
          </aside>
        </section>

        <footer className="mt-8 flex items-start gap-3 border-t border-[#e2cbd4] pt-5 text-xs leading-5 text-[#725d67]">
          <TriangleAlert className="mt-0.5 shrink-0 text-[#944b66]" size={15} aria-hidden="true" />
          <p>Legal information can change and may not fit every case. Confirm the current law and local process with an official source or qualified legal service. <span className="font-semibold">If you need immediate help, use a trusted local emergency service.</span></p>
        </footer>
      </div>
    </main>
  );
}
