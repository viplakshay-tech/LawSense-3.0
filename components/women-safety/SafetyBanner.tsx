import { ShieldCheck } from 'lucide-react';
import { SafetySurface } from '@/components/safety';
import { cn } from '@/lib/utils';

export function SafetyBanner({ className }: { className?: string }) {
  return (
    <SafetySurface
      role="note"
      className={cn(
        'relative overflow-hidden border-teal-100/[0.11] bg-[linear-gradient(115deg,rgba(28,44,50,0.92),rgba(16,19,27,0.98)_62%)]',
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-teal-100/10 bg-teal-200/[0.07] text-teal-100/80">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </span>
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-100">A note about safety</p>
          <p className="max-w-3xl text-sm leading-6 text-zinc-300">
            Some of what you&apos;ve described may indicate a potentially unsafe situation. This is
            not a diagnosis or a finding about anyone&apos;s actions. You can skip any step and choose
            what feels safe for you.
          </p>
        </div>
      </div>
    </SafetySurface>
  );
}
