import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';

export function SafetySurface({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return (
    <section
      {...props}
      className={cn(
        'rounded-2xl border border-white/[0.08] bg-[#10131b] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.18)] sm:p-6',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SafetySectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5 space-y-2">
      {eyebrow && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
          {eyebrow}
        </p>
      )}
      <h2 className="text-lg font-medium tracking-tight text-zinc-100 sm:text-xl">{title}</h2>
      {description && <p className="max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>}
    </div>
  );
}

export const safetyQuietText = 'text-sm leading-6 text-zinc-400';
