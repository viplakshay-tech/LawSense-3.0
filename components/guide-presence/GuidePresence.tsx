'use client';

import Image from 'next/image';
import { useReducedMotion } from 'framer-motion';
import './GuidePresence.css';
import { GUIDE_PRESENCE_LABELS } from './types';
import type { GuidePresenceProps } from './types';
import { canonicalGuidePresenceState } from './presentation-contract';

export function GuidePresence({
  state,
  detail,
  accessibleLabel,
  speechState,
  size = 'regular',
  reducedMotion = false,
  className,
}: GuidePresenceProps) {
  const systemReducedMotion = useReducedMotion() ?? false;
  const shouldReduceMotion = reducedMotion || systemReducedMotion;
  const label = accessibleLabel ?? GUIDE_PRESENCE_LABELS[state];
  const canonicalState = canonicalGuidePresenceState(state);
  const rootClassName = ['ls-guide-presence__presence', className].filter(Boolean).join(' ');

  return (
    <section
      className={rootClassName}
      data-state={canonicalState}
      data-size={size}
      data-speech-state={speechState ?? 'idle'}
      data-reduced-motion={shouldReduceMotion ? 'true' : undefined}
      role={canonicalState === 'IMMEDIATE_DANGER' ? 'alert' : 'status'}
      aria-live={canonicalState === 'IMMEDIATE_DANGER' ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label={`${label}${detail ? `. ${detail}` : ''}`}
    >
      <div className="ls-guide-presence__stage" aria-hidden="true">
        <div className="ls-guide-presence__portrait">
          <Image
            src="/guide/lawsense-guide-feminine.webp"
            alt=""
            fill
            priority={size === 'hero'}
            sizes={size === 'compact' ? '80px' : '(max-width: 768px) 55vw, 280px'}
            className="ls-guide-presence__portraitImage"
          />
          <span className="ls-guide-presence__portraitHalo" />
          <span className="ls-guide-presence__portraitStatus" />
        </div>
        {size !== 'compact' && (
          <span className="ls-guide-presence__stageCaption">YOUR LAWSENSE AI GUIDE</span>
        )}
      </div>
      <div className="ls-guide-presence__caption">
        <span className="ls-guide-presence__eyebrow">LAWSENSE · GUIDE</span>
        <span className="ls-guide-presence__stateLabel">{label}</span>
        {detail && <span className="ls-guide-presence__detail">{detail}</span>}
      </div>
    </section>
  );
}

export default GuidePresence;
