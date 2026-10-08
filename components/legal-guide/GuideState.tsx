import { useId } from 'react';
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  FileSearch,
  FileText,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import type { GuideStateName } from './types';
import styles from './LegalGuide.module.css';

function StateMark({ state }: { state: GuideStateName }) {
  const iconProps = { 'aria-hidden': true as const, size: 14, strokeWidth: 2.1 };

  switch (state) {
    case 'extracting':
      return <FileSearch {...iconProps} />;
    case 'asking':
      return <CircleHelp {...iconProps} />;
    case 'evidence_review':
      return <FileText {...iconProps} />;
    case 'safety_warning':
      return <ShieldAlert {...iconProps} />;
    case 'legal_verification':
      return <Scale {...iconProps} />;
    case 'journey_action':
      return <ArrowUpRight {...iconProps} />;
    case 'completion':
      return <Check {...iconProps} />;
    default:
      return null;
  }
}

/** State-driven portrait and marker; the surrounding status text names the case phase. */
export function GuideState({ state }: { state: GuideStateName }) {
  const gradientId = `guide-background-${useId().replace(/:/g, '')}`;
  const clothingId = `guide-clothing-${useId().replace(/:/g, '')}`;

  return (
    <div className={styles.visual} data-state={state} aria-hidden="true">
      <span className={styles.halo} />
      <svg className={styles.portrait} viewBox="0 0 160 160" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#dce5ff" />
            <stop offset="100%" stopColor="#f4e6dc" />
          </linearGradient>
          <linearGradient id={clothingId} x1="0" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#263653" />
            <stop offset="100%" stopColor="#121d31" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r="78" fill={`url(#${gradientId})`} />
        <path
          d="M35 151c3-27 19-43 45-43s42 16 45 43H35Z"
          fill={`url(#${clothingId})`}
        />
        <path d="M67 104h26v21c-7 8-19 8-26 0v-21Z" fill="#c98268" />
        <path
          d="M47 67c0-29 13-46 34-46 23 0 35 20 33 47l-4 32c-2 16-15 26-30 26-17 0-30-11-31-28l-2-31Z"
          fill="#292239"
        />
        <path
          d="M57 64c0-20 10-32 24-32 17 0 25 12 25 31v25c0 16-10 26-25 26-14 0-24-11-24-26V64Z"
          fill="#d99579"
        />
        <path d="M55 65c1-22 12-36 29-36 14 0 24 8 29 25-10-1-18-7-23-15-7 12-20 20-35 21Z" fill="#292239" />
        <path d="M57 57c-8 15-7 43-2 58-12-8-17-23-17-42 0-27 16-47 39-51-11 8-17 19-20 35Z" fill="#292239" />
        <path d="M106 53c7 17 7 43 2 61 11-7 17-22 17-41 0-22-10-39-27-47 4 7 7 16 8 27Z" fill="#292239" />
        <path d="M66 75c3-2 7-2 10 0M86 75c3-2 7-2 10 0" fill="none" stroke="#513a3e" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M77 94c3 2 7 2 10 0" fill="none" stroke="#9d554e" strokeWidth="2" strokeLinecap="round" />
        <path d="m65 117 15 18 15-18" fill="none" stroke="#e5e9f2" strokeWidth="4" strokeLinejoin="round" />
        <path d="M79 135h2l6 16H73l6-16Z" fill="#b4c1dd" />
      </svg>
      <span className={styles.stateMark} data-state={state}>
        <StateMark state={state} />
      </span>
      {state === 'extracting' && <span className={styles.scanLine} />}
    </div>
  );
}
