import { HeartHandshake, MessageCircle, Scale, UsersRound } from 'lucide-react';
import { SafetySectionHeading, SafetySurface } from '@/components/safety';

const options = [
  {
    title: 'Someone you trust',
    description: 'If it feels safe, choose a person and a way to communicate that works for you.',
    icon: UsersRound,
  },
  {
    title: 'Emotional or health support',
    description: 'A counselor or health professional may be an option if that would help.',
    icon: HeartHandshake,
  },
  {
    title: 'Local support or legal information',
    description: 'You may look for a local support organization or legal aid provider, where available.',
    icon: Scale,
  },
];

export function SupportPathway({ className }: { className?: string }) {
  return (
    <SafetySurface className={className}>
      <SafetySectionHeading
        eyebrow="Support, if you want it"
        title="You can decide who to involve"
        description="You may choose one option, several, or none. Nothing here contacts a person or service for you."
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map(({ title, description, icon: Icon }) => (
          <li
            key={title}
            className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"
          >
            <span className="mb-3 flex size-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-zinc-300">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{description}</p>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-zinc-500">
        <MessageCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        You can ask someone to listen without deciding what to do next.
      </p>
    </SafetySurface>
  );
}
