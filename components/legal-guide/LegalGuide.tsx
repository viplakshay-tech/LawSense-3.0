'use client';

import type { ReactNode } from 'react';
import { useLegalGuide } from '@/hooks/legal-guide/useLegalGuide';
import { GuideAction } from './GuideAction';
import { GuideIndicator } from './GuideIndicator';
import { GuideMessage } from './GuideMessage';
import { GuideState } from './GuideState';
import type {
  GuideActionEvent,
  GuideActionItem,
  GuideMessageKind,
  GuideStateChangeEvent,
  GuideStateName,
  LegalGuideEvent,
} from './types';
import styles from './LegalGuide.module.css';

export interface LegalGuideProps {
  /** When provided, the integrating application owns the guide's state. */
  state?: GuideStateName;
  initialState?: GuideStateName;
  label?: string;
  detail?: string;
  /** Marks the guide region as actively fetching or processing its case state. */
  busy?: boolean;
  /** Caller-provided content. Omitted messages leave the message area empty. */
  message?: string;
  messageKind?: GuideMessageKind;
  messageSpeaker?: string;
  actions?: GuideActionItem[];
  actionsLabel?: string;
  children?: ReactNode;
  className?: string;
  onStateChange?: (event: GuideStateChangeEvent) => void;
  onAction?: (event: GuideActionEvent) => void;
  onEvent?: (event: LegalGuideEvent) => void;
}

/**
 * Animated, local-only guide interface. The app supplies messages, state, actions,
 * and integrations; this component contains no advice or AI behavior.
 */
export function LegalGuide({
  state: controlledState,
  initialState = 'idle',
  label = 'Legal guide',
  detail,
  busy,
  message,
  messageKind = 'guide',
  messageSpeaker,
  actions = [],
  actionsLabel = 'Guide actions',
  children,
  className,
  onStateChange,
  onAction,
  onEvent,
}: LegalGuideProps) {
  const { state, transitionTo } = useLegalGuide({
    state: controlledState,
    initialState,
    onStateChange: (event) => {
      onStateChange?.(event);
      onEvent?.(event);
    },
  });

  function handleAction(action: GuideActionItem) {
    const event: GuideActionEvent = {
      type: 'action',
      actionId: action.id,
      label: action.label,
      state,
    };

    onAction?.(event);
    onEvent?.(event);
    if (action.nextState) transitionTo(action.nextState);
  }

  return (
    <section
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      data-state={state}
      aria-label={label}
      aria-busy={busy ?? state === 'extracting'}
    >
      <div className={styles.header}>
        <div className={styles.statusBlock}>
          <p className={styles.eyebrow}>{label}</p>
          <GuideIndicator state={state} detail={detail} />
        </div>
        <GuideState state={state} />
      </div>

      {message !== undefined && message.length > 0 && (
        <GuideMessage message={message} kind={messageKind} speaker={messageSpeaker} />
      )}

      {actions.length > 0 && (
        <div className={styles.actions} role="group" aria-label={actionsLabel}>
          {actions.map((action) => (
            <GuideAction key={action.id} action={action} onAction={handleAction} />
          ))}
        </div>
      )}

      {children && <div className={styles.extension}>{children}</div>}
    </section>
  );
}
