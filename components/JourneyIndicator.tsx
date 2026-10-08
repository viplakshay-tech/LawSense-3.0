import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const STAGES = [
  'UNDERSTAND',
  'FACTS',
  'EVIDENCE',
  'LAW',
  'OPTIONS',
  'NEXT_STEP',
] as const;

const STAGE_LABELS: Record<JourneyStage, string> = {
  UNDERSTAND: 'What happened',
  FACTS: 'What we know',
  EVIDENCE: 'What supports it',
  LAW: 'What the law may implicate',
  OPTIONS: 'Possible paths',
  NEXT_STEP: 'What to do next',
};

export type JourneyStage = (typeof STAGES)[number];

export function JourneyIndicator({
  activeStage = 'UNDERSTAND',
  completedStages = [],
}: {
  activeStage?: JourneyStage;
  completedStages?: JourneyStage[];
}) {
  const activeIndex = STAGES.indexOf(activeStage);

  return (
    <div className="w-full overflow-x-auto pb-4 scrollbar-hide">
      <div className="flex items-center min-w-max">
        {STAGES.map((stage, index) => {
          const isActive = index === activeIndex;
          const isComplete = completedStages.includes(stage);
          const isPast = isComplete && !isActive;
          const stageLabel = STAGE_LABELS[stage];

          return (
            <div key={stage} className="flex items-center">
              <div className="flex flex-col items-center gap-2 relative">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 z-10 bg-white dark:bg-[#111]",
                    isActive && "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500",
                    isPast && "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-black",
                    !isActive && !isPast && "border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
                  )}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`${stageLabel}: ${isActive ? 'active' : isPast ? 'complete' : 'upcoming'}`}
                >
                  {isPast ? <Check className="w-4 h-4" /> : index + 1}
                </div>
                <span
                  className={cn(
                    "text-[10px] leading-4 tracking-wide font-semibold absolute top-10 w-28 text-center sm:w-32",
                    isActive && "text-blue-600 dark:text-blue-500",
                    isPast && "text-zinc-800 dark:text-zinc-200",
                    !isActive && !isPast && "text-zinc-400 dark:text-zinc-600"
                  )}
                >
                  {stageLabel}
                </span>
              </div>

              {index < STAGES.length - 1 && (
                <div
                  className={cn(
                    "w-12 h-[2px] mx-2 mt-[-24px]", // align with circle centers
                    isComplete ? "bg-zinc-800 dark:bg-zinc-200" : "bg-zinc-200 dark:bg-zinc-800"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
