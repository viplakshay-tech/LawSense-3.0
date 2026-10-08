import { ArrowUpRight, Pause, Route, Sparkles } from 'lucide-react';
import { SafetySectionHeading, SafetySurface } from '@/components/safety';

const steps = [
  {
    title: 'Pause and check in',
    description: 'Take a moment to notice what would help you feel safer right now.',
    icon: Pause,
  },
  {
    title: 'Choose what comes next',
    description: 'You may talk with someone you trust, explore support, or take no action today.',
    icon: ArrowUpRight,
  },
  {
    title: 'Keep your choices open',
    description: 'You can pause, skip a step, or return to this information whenever you want.',
    icon: Sparkles,
  },
];

export function SafetyPathway({ className }: { className?: string }) {
  return (
    <SafetySurface className={className}>
      <SafetySectionHeading
        eyebrow="At your pace"
        title="A few possible next steps"
        description="There is no single right order. Use only what feels appropriate to you."
      />
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map(({ title, description, icon: Icon }, index) => (
          <li
            key={title}
            className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-lg border border-teal-100/[0.09] bg-teal-100/[0.045] text-teal-100/75">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="text-[10px] font-medium tracking-[0.16em] text-zinc-600">
                0{index + 1}
              </span>
            </div>
            <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{description}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
        <Route aria-hidden="true" className="size-3.5 shrink-0" />
        You remain in control of whether to continue.
      </p>
    </SafetySurface>
  );
}
