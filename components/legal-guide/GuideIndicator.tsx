import { GUIDE_STATE_LABELS } from './types';
import type { GuideStateName } from './types';
import styles from './LegalGuide.module.css';

export interface GuideIndicatorProps {
  state: GuideStateName;
  detail?: string;
}

export function GuideIndicator({ state, detail }: GuideIndicatorProps) {
  const isUrgent = state === 'error' || state === 'safety_warning';

  return (
    <div
      className={styles.indicator}
      data-state={state}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-label={`${GUIDE_STATE_LABELS[state]}${detail ? `. ${detail}` : ''}`}
    >
      <span className={styles.indicatorDot} />
      <span className={styles.indicatorText}>
        <span className={styles.stateLabel}>{GUIDE_STATE_LABELS[state]}</span>
        {detail && <span className={styles.stateDetail}>{detail}</span>}
      </span>
    </div>
  );
}
