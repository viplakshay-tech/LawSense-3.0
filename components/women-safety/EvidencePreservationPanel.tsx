import { FileLock2, LockKeyhole } from 'lucide-react';
import { SafetySectionHeading, SafetySurface } from '@/components/safety';

const suggestions = [
  'If safe, keep original messages, emails, photos, call logs, or documents in their original form.',
  'You may note dates, times, usernames, and context. Keep full screenshots or links when possible.',
  'Consider whether a device, account, or backup is shared before saving anything there.',
  'Do not put yourself at risk to collect information, access someone else’s account, or start contact.',
];

export function EvidencePreservationPanel({ className }: { className?: string }) {
  return (
    <SafetySurface className={className}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-teal-100/10 bg-teal-100/[0.05] text-teal-100/75">
          <FileLock2 aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <SafetySectionHeading
            eyebrow="Only if it feels safe"
            title="Keeping information private"
            description="These are optional ideas for information you already have. Your immediate wellbeing comes first."
          />
          <ul className="space-y-3">
            {suggestions.map((suggestion) => (
              <li key={suggestion} className="flex gap-3 text-sm leading-6 text-zinc-300">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-200/60"
                />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/10 px-3.5 py-3 text-xs leading-5 text-zinc-500">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
            <p>This panel does not upload or save files.</p>
          </div>
        </div>
      </div>
    </SafetySurface>
  );
}
