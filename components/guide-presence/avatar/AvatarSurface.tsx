import type { AvatarAdapter, AvatarSurfaceProps } from './types';
import { HumanAvatarRenderer } from './HumanAvatarRenderer';
import { IllustratedAvatarRenderer } from './IllustratedAvatarRenderer';

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
    gaze: false,
    gestures: false,
    liveAudioOutput: false,
  },
  Surface: HumanAvatarRenderer,
};

/** The realistic local renderer is preferred; it falls back to the illustrated surface if assets or WebGL are unavailable. */
export const defaultAvatarAdapter = humanAvatarAdapter;

/** Stable presentation boundary for swapping local avatar engines without changing Guide Runtime semantics. */
export function AvatarSurface({
  adapter = defaultAvatarAdapter,
  ...props
}: AvatarSurfaceProps & { adapter?: AvatarAdapter }) {
  const Renderer = adapter.Surface;
  return <Renderer {...props} />;
}
