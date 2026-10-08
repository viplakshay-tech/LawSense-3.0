import { Info } from 'lucide-react';
import { SafetySectionHeading, SafetySurface } from '@/components/safety';

export const SAFETY_CONTEXT_TOPICS = [
  'sexual-violence',
  'rape',
  'sexual-harassment',
  'domestic-violence',
  'dowry',
  'stalking',
  'threats',
  'coercion',
  'blackmail',
  'sexual-extortion',
  'workplace-harassment',
  'cyber-abuse',
] as const;

export type SafetyContextTopic = (typeof SAFETY_CONTEXT_TOPICS)[number];

const topicLabels: Record<SafetyContextTopic, string> = {
  'sexual-violence': 'Sexual violence',
  rape: 'Rape',
  'sexual-harassment': 'Sexual harassment',
  'domestic-violence': 'Domestic violence',
  dowry: 'Dowry',
  stalking: 'Stalking',
  threats: 'Threats',
  coercion: 'Coercion',
  blackmail: 'Blackmail',
  'sexual-extortion': 'Sexual extortion',
  'workplace-harassment': 'Workplace harassment',
  'cyber-abuse': 'Cyber abuse',
};

export function SafetyContextSummary({
  topics = [],
  className,
}: {
  topics?: readonly SafetyContextTopic[];
  className?: string;
}) {
  return (
    <SafetySurface className={className}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025] text-zinc-300">
          <Info aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <SafetySectionHeading
            eyebrow="Your context"
            title="Topics chosen for this conversation"
            description="Some of what you’ve described may indicate a potentially unsafe situation."
          />
          {topics.length > 0 ? (
            <ul aria-label="Topics chosen for this conversation" className="flex flex-wrap gap-2">
              {topics.map((topic) => (
                <li
                  key={topic}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs text-zinc-300"
                >
                  {topicLabels[topic]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No topics have been selected.</p>
          )}
          <p className="mt-4 text-xs leading-5 text-zinc-500">
            These topics reflect what you chose to share. They are not a diagnosis or a legal finding about anyone.
          </p>
        </div>
      </div>
    </SafetySurface>
  );
}
