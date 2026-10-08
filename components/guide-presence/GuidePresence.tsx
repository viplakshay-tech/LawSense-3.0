import styles from './GuidePresence.module.css';
import { GUIDE_PRESENCE_LABELS } from './types';
import type { GuidePresenceProps, GuidePresenceState } from './types';

const WAVEFORM_STATES: GuidePresenceState[] = ['LISTENING', 'SPEAKING'];
const URGENT_STATES: GuidePresenceState[] = ['SAFETY', 'ERROR'];

function StateGraphic({ state }: { state: GuidePresenceState }) {
  return (
    <div className={styles.instrument} data-state={state} aria-hidden="true">
      <div className={styles.halo} />
      <div className={styles.orbit}>
        <span className={styles.orbitPoint} />
        <span className={styles.orbitPoint} />
        <span className={styles.orbitPoint} />
      </div>
      <div className={styles.innerOrbit} />

      {state === 'PROCESSING' && <div className={styles.processingArc} />}

      {state === 'EVIDENCE' && (
        <div className={styles.evidenceMap}>
          <span className={styles.evidenceLine} />
          <span className={`${styles.evidenceNode} ${styles.evidenceNodePrimary}`} />
          <span className={`${styles.evidenceNode} ${styles.evidenceNodeSecondary}`} />
          <span className={`${styles.evidenceNode} ${styles.evidenceNodeTertiary}`} />
        </div>
      )}

      {state === 'CONFLICT' && <div className={styles.conflictSeam} />}
      {state === 'SAFETY' && <div className={styles.safetyBoundary} />}

      <div className={styles.core}>
        <span className={styles.coreGlow} />
        {WAVEFORM_STATES.includes(state) ? (
          <span className={styles.waveform}>
            {Array.from({ length: 15 }, (_, index) => (
              <span className={styles.waveBar} key={index} />
            ))}
          </span>
        ) : state === 'ERROR' ? (
          <span className={styles.errorMark}>
            <span />
            <span />
          </span>
        ) : state === 'GROUNDED' ? (
          <span className={styles.groundedMark} />
        ) : state === 'ASKING' ? (
          <span className={styles.askingMark}>?</span>
        ) : (
          <span className={styles.corePoint} />
        )}
      </div>
    </div>
  );
}

export function GuidePresence({
  state,
  detail,
  accessibleLabel,
  visual,
  size = 'regular',
  reducedMotion = false,
  className,
}: GuidePresenceProps) {
  const label = accessibleLabel ?? GUIDE_PRESENCE_LABELS[state];
  const urgent = URGENT_STATES.includes(state);
  const rootClassName = [styles.presence, className].filter(Boolean).join(' ');

  return (
    <section
      className={rootClassName}
      data-state={state}
      data-size={size}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label={`${label}${detail ? `. ${detail}` : ''}`}
    >
      <div className={styles.stage} aria-hidden="true">
        {visual ?? <StateGraphic state={state} />}
      </div>
      <div className={styles.caption}>
        <span className={styles.eyebrow}>GUIDE PRESENCE</span>
        <span className={styles.stateLabel}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
    </section>
  );
}

export default GuidePresence;
