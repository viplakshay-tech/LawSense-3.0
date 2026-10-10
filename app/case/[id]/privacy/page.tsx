import Link from 'next/link';
import { ArrowLeft, Check, CircleHelp, FileCheck2, LockKeyhole, ShieldAlert } from 'lucide-react';

export const instant = false;

const dataItems = [
  ['Story', 'The account you choose to enter in the case workspace.'],
  ['Confirmed facts', 'Details you review and explicitly confirm into the case record.'],
  ['Uploaded evidence', 'Files and extracted details you choose to add.'],
  ['Generated documents', 'Drafts created from the current case record for your review.'],
  ['Optional voice / transcript data', 'Only when you choose to use Guide voice input. The screen reports whether recognition is on-device or provided by the browser.'],
];

const provenance = [
  ['USER REPORTED', 'Entered or confirmed by the user; not independently verified.'],
  ['EVIDENCE SUPPORTED', 'Linked to evidence in the case record; this label does not assess legal strength.'],
  ['VERIFIED SOURCE', 'A source verification status was returned. Check the source version, commencement and applicability.'],
  ['UNKNOWN', 'Not established in the current record.'],
  ['CONFLICT', 'The current record contains inconsistent information that needs review.'],
  ['ASSUMPTION', 'A working assumption that must not be treated as a confirmed fact.'],
];

export default async function PrivacyControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const casePath = `/case/${encodeURIComponent(id)}`;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-slate-100 sm:px-6 sm:py-8">
      <header className="rounded-3xl border border-white/[0.08] bg-[linear-gradient(135deg,#1c1820,#111821_65%)] p-5 sm:p-7">
        <Link href={casePath} className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-slate-400 hover:text-white"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />Back to Understand</Link>
        <p className="mt-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#e8c7b5]"><LockKeyhole aria-hidden="true" className="h-3.5 w-3.5" />Control your case information</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Privacy &amp; Control</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Choose what to add, what to review and which next steps to take. This page describes this build; it is not a security certification or a promise of confidentiality.</p>
      </header>

      <section className="rounded-2xl border border-amber-200/15 bg-[#191712] p-5 sm:p-6" aria-labelledby="prototype-heading">
        <h2 id="prototype-heading" className="flex items-center gap-2 text-sm font-semibold text-amber-100"><ShieldAlert aria-hidden="true" className="h-4 w-4" />Local synthetic prototype</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">This build is a local synthetic prototype. It has not been hardened or assessed for production security. Do not treat this interface as a production-grade security or privacy guarantee.</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Information and purpose">
        <article className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-200">What may be provided</h2>
          <ul className="mt-4 space-y-3">
            {dataItems.map(([title, description]) => <li key={title} className="flex gap-3"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 text-slate-300"><Check aria-hidden="true" className="h-3 w-3" /></span><span><strong className="block text-sm font-medium text-slate-100">{title}</strong><span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span></span></li>)}
          </ul>
        </article>
        <article className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-200">Why LawSense uses it</h2>
          <ul className="mt-4 grid gap-2 text-sm text-slate-300">
            {['Case organization', 'Evidence organization', 'Legal grounding from returned sources', 'Document preparation', 'Next-step guidance'].map((reason) => <li key={reason} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">{reason}</li>)}
          </ul>
          <p className="mt-4 text-xs leading-5 text-slate-500">Voice recognition and spoken replies depend on the browser or on-device Android services available on this device. Check the Guide voice status before recording; typed messages remain available.</p>
        </article>
      </section>

      <section className="rounded-2xl border border-rose-200/15 bg-[#171519] p-5 sm:p-6" aria-labelledby="automation-heading">
        <h2 id="automation-heading" className="text-sm font-semibold uppercase tracking-[0.13em] text-rose-100">What LawSense does not automatically do</h2>
        <ul className="mt-4 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
          {['Contact authorities', 'Contact an employer', 'Contact police', 'Contact family or coworkers', 'Submit complaints or reports', 'Decide guilt', 'Guarantee outcomes', 'Treat user statements as verified evidence'].map((item) => <li key={item} className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">{item}</li>)}
        </ul>
        <p className="mt-4 text-xs leading-5 text-slate-400">Opening an official resource, using a phone link or submitting a form is your choice. LawSense never submits anything automatically.</p>
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6" aria-labelledby="provenance-heading">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-100/10 bg-sky-100/[0.04] text-sky-100"><FileCheck2 aria-hidden="true" className="h-4 w-4" /></span>
          <div><h2 id="provenance-heading" className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-200">Information labels</h2><p className="mt-1 text-xs leading-5 text-slate-400">Labels preserve where information came from and whether it remains uncertain.</p></div>
        </div>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {provenance.map(([label, description]) => <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><dt className="text-[10px] font-bold tracking-[0.12em] text-slate-200">{label}</dt><dd className="mt-1.5 text-xs leading-5 text-slate-400">{description}</dd></div>)}
        </dl>
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-[#10161f] p-5 sm:p-6" aria-labelledby="production-heading">
        <h2 id="production-heading" className="text-sm font-semibold uppercase tracking-[0.13em] text-slate-200">Before production deployment</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">A production service would need, at minimum:</p>
        <ul className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
          <li className="rounded-lg border border-white/[0.06] px-3 py-2.5">Authentication</li>
          <li className="rounded-lg border border-white/[0.06] px-3 py-2.5">Case ownership authorization</li>
          <li className="rounded-lg border border-white/[0.06] px-3 py-2.5">Retention and deletion controls</li>
          <li className="rounded-lg border border-white/[0.06] px-3 py-2.5">Additional security hardening and assessment</li>
        </ul>
        <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-slate-500"><CircleHelp aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />This demo does not provide user-facing case deletion controls or a production retention policy.</p>
      </section>
    </main>
  );
}
