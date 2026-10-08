'use client';

import type { GuideActionItem } from './types';
import styles from './LegalGuide.module.css';

export interface GuideActionProps {
  action: GuideActionItem;
  onAction?: (action: GuideActionItem) => void;
}

/** Button primitive for caller-defined guide actions. */
export function GuideAction({ action, onAction }: GuideActionProps) {
  const variant = action.variant ?? 'secondary';

  return (
    <button
      className={`${styles.action} ${styles[variant]}`}
      type="button"
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      onClick={() => onAction?.(action)}
    >
      {action.label}
    </button>
  );
}
