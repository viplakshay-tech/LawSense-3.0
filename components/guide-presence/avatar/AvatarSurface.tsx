import type { AvatarAdapter, AvatarSurfaceProps } from './types';
import { IllustratedAvatarRenderer } from './IllustratedAvatarRenderer';

export const illustratedAvatarAdapter: AvatarAdapter = {
  id: 'lawsense-illustrated-guide',
  kind: 'illustrated',
  capabilities: {
    visemeTiming: true,
    speechInterruption: true,
    emotion: true,
    gaze: true,
    gestures: false,
    liveAudioOutput: false,
  },
  Surface: IllustratedAvatarRenderer,
};

/** Stable presentation boundary for swapping in a locally available avatar engine. */
export function AvatarSurface({
  adapter = illustratedAvatarAdapter,
  ...props
}: AvatarSurfaceProps & { adapter?: AvatarAdapter }) {
  const Renderer = adapter.Surface;
  return <Renderer {...props} />;
}
