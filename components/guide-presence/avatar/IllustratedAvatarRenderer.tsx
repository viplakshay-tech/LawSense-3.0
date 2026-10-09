import { useId } from 'react';
import type { AvatarSurfaceProps, AvatarViseme } from './types';
import styles from './IllustratedAvatarRenderer.module.css';

const GAZE_POSITION = {
  camera: [0, 0],
  user: [0, 0],
  evidence: [-3, 2],
  'case-record': [-2, 3],
  'side-panel': [3, 0],
  below: [0, 3],
} as const;

const BROW_PATHS: Record<AvatarSurfaceProps['expression'], [string, string]> = {
  calm: ['M93 131 Q105 126 117 131', 'M163 131 Q175 126 187 131'],
  attentive: ['M93 128 Q105 122 117 129', 'M163 129 Q175 122 187 128'],
  thoughtful: ['M93 132 Q104 126 117 130', 'M163 130 Q176 126 187 132'],
  curious: ['M93 126 Q105 119 117 128', 'M163 130 Q175 124 187 130'],
  warm: ['M93 130 Q105 124 117 130', 'M163 130 Q175 124 187 130'],
  grounded: ['M93 130 Q105 127 117 130', 'M163 130 Q175 127 187 130'],
  uncertain: ['M93 128 Q104 122 117 132', 'M163 132 Q176 122 187 128'],
  concerned: ['M93 132 Q104 123 117 130', 'M163 130 Q176 123 187 132'],
  compassionate: ['M93 131 Q104 125 117 131', 'M163 131 Q176 125 187 131'],
  steady: ['M93 130 Q105 127 117 130', 'M163 130 Q175 127 187 130'],
  apologetic: ['M93 132 Q104 126 117 132', 'M163 132 Q176 126 187 132'],
};

const REST_MOUTH_PATHS: Record<AvatarSurfaceProps['expression'], string> = {
  calm: 'M119 197 Q140 202 161 197',
  attentive: 'M120 197 Q140 200 160 197',
  thoughtful: 'M121 198 Q140 199 159 198',
  curious: 'M123 198 Q140 201 157 198',
  warm: 'M117 195 Q140 211 163 195',
  grounded: 'M119 196 Q140 205 161 196',
  uncertain: 'M119 200 Q139 196 162 200',
  concerned: 'M118 200 Q140 194 162 200',
  compassionate: 'M117 197 Q140 207 163 197',
  steady: 'M119 197 Q140 201 161 197',
  apologetic: 'M119 200 Q140 196 161 200',
};

const VISEME_MOUTHS: Record<AvatarViseme, string> = {
  sil: 'M119 197 Q140 202 161 197',
  rest: 'M119 197 Q140 202 161 197',
  A: 'M126 195 Q140 191 154 195 Q153 212 140 214 Q127 212 126 195Z',
  E: 'M119 197 Q140 193 161 197 Q158 208 140 208 Q122 208 119 197Z',
  I: 'M124 198 Q140 194 156 198 Q153 204 140 205 Q127 204 124 198Z',
  O: 'M130 196 Q140 192 150 196 Q151 209 140 211 Q129 209 130 196Z',
  U: 'M132 197 Q140 194 148 197 Q149 207 140 209 Q131 207 132 197Z',
  M: 'M119 198 Q140 203 161 198',
  FV: 'M119 197 Q140 198 161 197 Q152 203 140 203 Q128 203 119 197Z',
  L: 'M126 197 Q140 194 154 197 Q152 209 140 211 Q128 209 126 197Z',
};

function gazeOffset(target: AvatarSurfaceProps['gazeTarget']): [number, number] {
  if (typeof target !== 'string') {
    const x = Math.max(-1, Math.min(1, target.x));
    const y = Math.max(-1, Math.min(1, target.y));
    return [Number((x * 3.4).toFixed(2)), Number((y * 2.6).toFixed(2))];
  }
  return [...GAZE_POSITION[target]];
}

function activeViseme(props: AvatarSurfaceProps): AvatarViseme {
  if (props.speechState !== 'speaking' || !props.speechTiming) return 'rest';
  const cue = props.speechTiming.cues.find(({ startMs, durationMs }) =>
    props.speechTiming!.currentTimeMs >= startMs
      && props.speechTiming!.currentTimeMs < startMs + durationMs,
  );
  return cue?.viseme ?? 'rest';
}

function headTilt(
  state: AvatarSurfaceProps['visualState'],
  gestureHint: AvatarSurfaceProps['gestureHint'],
  reducedMotion: boolean | undefined,
): number {
  if (reducedMotion) return 0;

  let tilt: number;
  switch (state) {
    case 'LISTENING': tilt = -1.5; break;
    case 'THINKING':
    case 'UNCERTAIN': tilt = 2; break;
    case 'CLARIFYING': tilt = -2.5; break;
    case 'SAFETY': tilt = 0; break;
    case 'IMMEDIATE_DANGER': tilt = 0; break;
    case 'CONFLICT': tilt = -0.5; break;
    case 'ACTION_REQUIRED': tilt = 0; break;
    default: tilt = 0;
  }
  return gestureHint === 'gentle-nod' ? tilt - 1 : tilt;
}

export function IllustratedAvatarRenderer(props: AvatarSurfaceProps) {
  const rawId = useId().replaceAll(':', '');
  const backdropId = `guide-avatar-backdrop-${rawId}`;
  const portraitClipId = `guide-avatar-clip-${rawId}`;
  const gaze = gazeOffset(props.gazeTarget);
  const viseme = props.speechState === 'interrupted' || props.speechState === 'paused'
    ? 'sil'
    : activeViseme(props);
  const mouth = props.speechState === 'speaking'
    ? VISEME_MOUTHS[viseme]
    : REST_MOUTH_PATHS[props.expression];

  return (
    <div
      className={styles.surface}
      data-state={props.visualState}
      data-size={props.size ?? 'regular'}
      data-speech-state={props.speechState}
      data-context={props.context.kind}
      data-emotion={props.emotion}
      data-gesture={props.gestureHint}
      data-reduced-motion={props.reducedMotion ? 'true' : undefined}
    >
      <div className={styles.frame}>
        <svg className={styles.portrait} viewBox="0 0 280 320" role="presentation" focusable="false">
          <defs>
            <linearGradient id={backdropId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#334353" />
              <stop offset="0.52" stopColor="#1c2a36" />
              <stop offset="1" stopColor="#121c27" />
            </linearGradient>
            <clipPath id={portraitClipId}>
              <rect x="5" y="5" width="270" height="310" rx="126" />
            </clipPath>
          </defs>

          <rect x="5" y="5" width="270" height="310" rx="126" fill={`url(#${backdropId})`} />
          <g clipPath={`url(#${portraitClipId})`}>
            <ellipse className={styles.halo} cx="140" cy="153" rx="112" ry="119" />
            <circle cx="140" cy="147" r="92" fill="#fff0d6" opacity="0.035" />
            <path d="M44 310c5-60 37-88 96-88s91 28 96 88H44Z" fill="#262d40" />
            <path d="M63 310c6-48 30-71 77-71s71 23 77 71H63Z" fill="#31435b" />
            <path d="m106 242 34 33 34-33 22 68H84l22-68Z" fill="#f1e9df" />
            <path d="m140 275 14 35h-28l14-35Z" fill="#c7a978" opacity="0.8" />

            <path d="M78 119c-5-47 15-83 62-86 51-3 72 36 65 91l-5 97c-3 28-20 54-44 66l-17-26-18 26c-27-13-44-39-46-67l3-101Z" fill="#332637" />
            <path d="M113 207h54v48c-15 17-39 17-54 0v-48Z" fill="#bd806d" />
            <path d="M83 133c0-51 24-78 58-78 37 0 58 29 58 78v52c0 41-24 67-59 67s-58-26-58-67v-52Z" fill="#dba38c" />
            <path d="M78 134c-4-49 19-93 62-96 39-3 67 26 67 76-17-6-31-18-40-35-16 24-46 42-85 45-1 43 0 80 7 105-17-12-27-33-28-60l17-35Z" fill="#332637" />
            <path d="M185 100c13 30 13 77 5 111 17-15 25-39 22-68-2-34-14-60-36-74 4 10 7 20 9 31Z" fill="#332637" />
            <path d="M91 115c-12 24-12 73-5 101-15-11-24-33-23-61 1-32 13-56 34-70-3 10-5 20-6 30Z" fill="#332637" />
            <path d="M90 177c-8-2-11 5-8 14 3 9 9 13 16 11M190 177c8-2 11 5 8 14-3 9-9 13-16 11" fill="#d49a83" />

            <g className={styles.head} data-head-state={props.visualState} style={{ transform: `rotate(${headTilt(props.visualState, props.gestureHint, props.reducedMotion)}deg)` }}>
              <path d={BROW_PATHS[props.expression][0]} fill="none" stroke="#65464a" strokeWidth="3.3" strokeLinecap="round" />
              <path d={BROW_PATHS[props.expression][1]} fill="none" stroke="#65464a" strokeWidth="3.3" strokeLinecap="round" />
              <path d="M91 145 Q105 137 119 145 Q106 157 91 145Z" fill="#fbf2e9" />
              <path d="M161 145 Q175 137 189 145 Q174 157 161 145Z" fill="#fbf2e9" />
              <g transform={`translate(${gaze[0]} ${gaze[1]})`}>
                <ellipse cx="105" cy="146" rx="6.1" ry="7.6" fill="#775f52" />
                <ellipse cx="175" cy="146" rx="6.1" ry="7.6" fill="#775f52" />
                <ellipse cx="106" cy="147" rx="3.7" ry="5.3" fill="#29282d" />
                <ellipse cx="176" cy="147" rx="3.7" ry="5.3" fill="#29282d" />
                <circle cx="107" cy="144" r="1.65" fill="#fff8ef" />
                <circle cx="177" cy="144" r="1.65" fill="#fff8ef" />
              </g>
              <path d="M140 148c-1 13-8 27-7 31 2 4 8 5 13 2" fill="none" stroke="#b77c6e" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M105 180c5 3 10 3 15 0M160 180c5 3 10 3 15 0" fill="none" stroke="#c78578" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
              <path d={mouth} fill={viseme === 'sil' || viseme === 'rest' ? 'none' : '#7d454c'} stroke="#8c5154" strokeWidth="2.3" strokeLinecap="round" />
              {props.speechState === 'speaking' && viseme !== 'sil' && viseme !== 'rest' && (
                <path d="M130 199 Q140 202 150 199" fill="none" stroke="#f3d8c9" strokeWidth="2" strokeLinecap="round" />
              )}
            </g>

            <path d="M70 292c14-16 30-24 46-27l24 19 24-19c20 4 37 14 49 30" fill="none" stroke="#52617b" strokeWidth="2" opacity="0.75" />
            <path d="M56 278c-1-50 14-91 29-119M225 274c8-45 3-83-8-112" fill="none" stroke="#574153" strokeWidth="3" opacity="0.65" />
          </g>
          <rect x="5.5" y="5.5" width="269" height="309" rx="125.5" fill="none" stroke="#f0cf98" strokeOpacity="0.34" />
          <path d="M46 57c24-26 55-40 94-40" fill="none" stroke="#fff0d6" strokeOpacity="0.22" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="224" cy="77" r="2.2" fill="#f0cf98" fillOpacity="0.8" />
        </svg>
        <span className={styles.statusRing} aria-hidden="true" />
      </div>
    </div>
  );
}
