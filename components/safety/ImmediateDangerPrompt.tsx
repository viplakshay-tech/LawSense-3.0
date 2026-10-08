import { AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SafetySurface } from './SafetySurface';
import type { ImmediateDangerAnswer } from './types';

export function ImmediateDangerPrompt({
  choice,
  busy,
  urgent,
  disabled = false,
  prompt,
  copy,
  onChoose,
}: {
  choice: ImmediateDangerAnswer | null;
  busy: boolean;
  urgent?: boolean;
  disabled?: boolean;
  prompt?: string | null;
  copy: {
    dangerEyebrow: string;
    dangerTitle: string;
    dangerDescription: string;
    dangerChoicesLabel: string;
    yes: string;
    no: string;
    notSure: string;
    choiceUpdating: string;
    choiceSelected: string;
    choiceSentNotice: string;
    urgencyLabel: string;
    yesPriority: string;
  };
  onChoose: (choice: ImmediateDangerAnswer) => void;
}) {
  const options: Array<{ value: ImmediateDangerAnswer; label: string }> = [
    { value: 'yes', label: copy.yes },
    { value: 'no', label: copy.no },
    { value: 'not_sure', label: copy.notSure },
  ];
  const isUrgent = choice === 'yes' || urgent === true;

  return (
    <SafetySurface
      aria-labelledby="immediate-danger-title"
      className={cn(
        'relative overflow-hidden border p-5 shadow-[0_22px_70px_rgba(0,0,0,0.3)] sm:p-7',
        isUrgent
          ? 'border-amber-200/30 bg-[linear-gradient(120deg,rgba(55,43,31,0.58),rgba(20,22,28,0.98)_70%)]'
          : 'border-amber-100/20 bg-[linear-gradient(120deg,rgba(37,37,34,0.64),rgba(18,22,29,0.98)_70%)]',
      )}
    >
      <div className="absolute inset-y-5 left-0 w-px bg-gradient-to-b from-transparent via-amber-100/50 to-transparent sm:inset-y-7" />
      <div className="flex items-start gap-4">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-amber-100/20 bg-amber-100/[0.07] text-amber-100/90">
          <AlertCircle aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100/75">
              {copy.dangerEyebrow}
            </p>
            {isUrgent && (
              <span className="rounded-full border border-amber-100/20 bg-amber-100/[0.06] px-2 py-1 text-[10px] text-amber-50/80">
                {copy.urgencyLabel}
              </span>
            )}
          </div>
          <h2 id="immediate-danger-title" className="mt-2 text-xl font-medium tracking-tight text-white sm:text-2xl">
            {copy.dangerTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">{copy.dangerDescription}</p>

          <div aria-label={copy.dangerChoicesLabel} className="mt-5 flex flex-wrap gap-2.5" role="group">
            {options.map((option) => {
              const selected = choice === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChoose(option.value)}
                  className={cn(
                    'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold tracking-[0.12em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#13161d]',
                    selected
                      ? 'border-teal-100/45 bg-teal-100/[0.12] text-teal-50 shadow-[0_0_22px_rgba(111,212,199,0.08)]'
                      : 'border-white/[0.12] bg-white/[0.035] text-zinc-200 hover:border-white/25 hover:bg-white/[0.07]',
                    disabled && 'cursor-not-allowed opacity-45 hover:border-white/[0.12] hover:bg-white/[0.035]',
                  )}
                >
                  {selected && <Check aria-hidden="true" className="size-3.5" />}
                  {option.label}
                </button>
              );
            })}
          </div>

          {(choice === 'yes' || (choice === 'not_sure' && urgent)) && (
            <p className="mt-4 rounded-xl border border-amber-100/15 bg-amber-100/[0.035] px-3.5 py-3 text-xs leading-5 text-amber-50/80">
              {copy.yesPriority}
            </p>
          )}

          <p aria-live="polite" className="mt-4 min-h-5 text-xs leading-5 text-zinc-400">
            {busy ? copy.choiceUpdating : prompt || (choice ? copy.choiceSelected : '')}
          </p>
          <p className="mt-3 max-w-3xl border-t border-white/[0.07] pt-3 text-xs leading-5 text-zinc-500">
            {copy.choiceSentNotice}
          </p>
        </div>
      </div>
    </SafetySurface>
  );
}
