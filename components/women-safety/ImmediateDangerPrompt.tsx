'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SafetySectionHeading, SafetySurface } from '@/components/safety';
import { cn } from '@/lib/utils';

const choices = ['YES', 'NO', 'NOT SURE'] as const;
type ImmediateDangerChoice = (typeof choices)[number];

const guidance: Record<ImmediateDangerChoice, string> = {
  YES: 'If you can, consider moving to a place that feels safer. You decide whether to contact someone you trust or local emergency services.',
  NO: 'Thank you. You can continue at your own pace and choose only the steps that feel useful.',
  'NOT SURE': 'You do not need to be certain to take a pause. Consider what would help you feel safer in this moment.',
};

export function ImmediateDangerPrompt({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ImmediateDangerChoice | null>(null);

  return (
    <SafetySurface className={cn('border-amber-100/[0.11]', className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-100/10 bg-amber-200/[0.06] text-amber-100/80">
          <AlertTriangle aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <SafetySectionHeading
            eyebrow="Your safety comes first"
            title="Are you in immediate danger right now?"
            description="Choose the answer that feels closest. It is okay if you are unsure."
          />
          <div aria-label="Immediate danger choices" className="flex flex-wrap gap-2" role="group">
            {choices.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={choice === option}
                onClick={() => setChoice(option)}
                className={cn(
                  'min-h-11 rounded-xl border px-4 text-xs font-semibold tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#10131b]',
                  choice === option
                    ? 'border-teal-100/40 bg-teal-100/[0.1] text-teal-50'
                    : 'border-white/[0.1] bg-white/[0.025] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05]',
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="mt-4 min-h-6 text-sm leading-6 text-zinc-300">
            {choice ? guidance[choice] : 'Your choice will show a gentle next step here.'}
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            This choice stays in this panel while it is open. It does not contact anyone.
          </p>
        </div>
      </div>
    </SafetySurface>
  );
}
