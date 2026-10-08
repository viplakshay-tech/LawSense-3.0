import type { GuideMessageProps } from './types';
import styles from './LegalGuide.module.css';

/** Presentational message surface. No messages are created by the runtime. */
export function GuideMessage({ message, kind = 'guide', speaker }: GuideMessageProps) {
  return (
    <article className={styles.message} data-kind={kind}>
      {speaker && <p className={styles.speaker}>{speaker}</p>}
      <div className={styles.messageContent}>{message}</div>
    </article>
  );
}
