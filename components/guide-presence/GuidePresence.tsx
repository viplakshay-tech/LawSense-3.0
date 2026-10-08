import styles from './GuidePresence.module.css';
import { AvatarSurface } from './avatar/AvatarSurface';
import { GUIDE_PRESENCE_LABELS } from './types';
import type { GuidePresenceProps } from './types';
import { canonicalGuidePresenceState, getGuideStatePresentation } from './presentation-contract';

const URGENT_STATES = new Set(['SAFETY', 'ERROR']);

export function GuidePresence({
  state,
  detail,
  accessibleLabel,
  visual,
  avatarAdapter,
  speechState,
  speechTiming,
  emotion,
  context,
  gazeTarget,
  gestureHint,
  size = 'regular',
  reducedMotion = false,
  className,
}: GuidePresenceProps) {
  const label = accessibleLabel ?? GUIDE_PRESENCE_LABELS[state];
  const canonicalState = canonicalGuidePresenceState(state);
  const presentation = getGuideStatePresentation(canonicalState);
  const isUrgent = URGENT_STATES.has(canonicalState);
  const rootClassName = [styles.presence, className].filter(Boolean).join(' ');
  const rendererIsIllustrated = (avatarAdapter?.kind ?? 'illustrated') === 'illustrated';

  return (
    <section
      className={rootClassName}
      data-state={canonicalState}
      data-size={size}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label={`${label}${detail ? `. ${detail}` : ''}`}
    >
      <div className={styles.stage} aria-hidden="true">
        {visual ?? (
          <>
            <AvatarSurface
              adapter={avatarAdapter}
              visualState={canonicalState}
              size={size}
              speechState={speechState ?? (canonicalState === 'SPEAKING' ? 'speaking' : 'idle')}
              speechTiming={speechTiming}
              expression={presentation.expression}
              emotion={emotion ?? presentation.emotion}
              context={context ?? presentation.context}
              gazeTarget={gazeTarget ?? presentation.attention.gaze}
              gestureHint={gestureHint ?? presentation.headMovement.gestureHint}
              reducedMotion={reducedMotion}
            />
            {rendererIsIllustrated && (
              <span className={styles.illustrationLabel}>
                {size === 'compact' ? 'ILLUSTRATED' : 'ILLUSTRATED GUIDE'}
              </span>
            )}
          </>
        )}
      </div>
      <div className={styles.caption}>
        <span className={styles.eyebrow}>LAWSENSE · GUIDE</span>
        <span className={styles.stateLabel}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
    </section>
  );
}

export default GuidePresence;
