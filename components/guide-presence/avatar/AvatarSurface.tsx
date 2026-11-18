'use client';

import dynamic from 'next/dynamic';
import type { AvatarAdapter, AvatarSurfaceProps } from './types';
import { IllustratedAvatarRenderer } from './IllustratedAvatarRenderer';

const HumanAvatarRenderer = dynamic<AvatarSurfaceProps>(
  () => import('./HumanAvatarRenderer').then((module) => module.HumanAvatarRenderer),
  {
    ssr: false,
    loading: () => <div className="ls-guide-human-avatar__loading" aria-hidden="true" />,
  },
);

export const illustratedAvatarAdapter: AvatarAdapter = {
  id: 'lawsense-illustrated-guide',
  kind: 'illustrated',
  capabilities: {
    visemeTiming: true,
    speechInterruption: true,
    emotion: false,
    gaze: true,
    gestures: false,
    liveAudioOutput: false,
  },
  Surface: IllustratedAvatarRenderer,
};

export const humanAvatarAdapter: AvatarAdapter = {
  id: 'lawsense-humanforge-guide',
  kind: 'human-avatar-engine',
  capabilities: {
    visemeTiming: true,
    speechInterruption: true,
    emotion: true,
    gaze: true,
    gestures: false,
    liveAudioOutput: false,
  },
  Surface: HumanAvatarRenderer,
};

/** Keep the established illustration on ordinary pages; immersive consultation opts into the 3D engine. */
export const defaultAvatarAdapter = illustratedAvatarAdapter;

/** Stable presentation boundary for swapping local avatar engines without changing Guide Runtime semantics. */
export function AvatarSurface({
  adapter = defaultAvatarAdapter,
  ...props
}: AvatarSurfaceProps & { adapter?: AvatarAdapter }) {
  const Renderer = adapter.Surface;
  return <Renderer {...props} />;
}
