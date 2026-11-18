'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_HUMAN, loadHumanPackage } from 'humanforge/human';
import type { HumanAvatar, HumanConfig, HumanPackage } from 'humanforge/human';
import { HumanCanvas } from 'humanforge/web';
import type { HumanCanvasHandle } from 'humanforge/web';
import { IllustratedAvatarRenderer } from './IllustratedAvatarRenderer';
import type { AvatarSurfaceProps, AvatarViseme } from './types';
import './HumanAvatarRenderer.css';

const ASSET_BASE = '/lawsense-human';

const EXPRESSION_WEIGHTS: Record<AvatarSurfaceProps['expression'], Record<string, number>> = {
  calm: {},
  attentive: { browInnerUpLeft: 0.08, browInnerUpRight: 0.08, eyeWideLeft: 0.04, eyeWideRight: 0.04 },
  thoughtful: { browInnerUpLeft: 0.05, browInnerUpRight: 0.05, mouthPress: 0.06 },
  curious: { browOuterUpLeft: 0.16, browOuterUpRight: 0.08 },
  warm: { mouthSmile: 0.16 },
  grounded: { mouthPress: 0.05 },
  uncertain: { browInnerUpLeft: 0.18, browInnerUpRight: 0.18 },
  concerned: { browInnerUpLeft: 0.18, browInnerUpRight: 0.18, mouthFrown: 0.08 },
  compassionate: { browInnerUpLeft: 0.12, browInnerUpRight: 0.12, mouthSmile: 0.07 },
  steady: { mouthPress: 0.04 },
  apologetic: { browInnerUpLeft: 0.15, browInnerUpRight: 0.15, mouthFrown: 0.08 },
};

const VISEME_WEIGHTS: Record<AvatarViseme, Record<string, number>> = {
  sil: {},
  rest: {},
  A: { jawOpen: 0.68, mouthFunnel: 0.08 },
  E: { jawOpen: 0.28, mouthSmile: 0.12, mouthStretch: 0.12 },
  I: { jawOpen: 0.18, mouthSmile: 0.22, mouthStretch: 0.18 },
  O: { jawOpen: 0.30, mouthPucker: 0.48, mouthFunnel: 0.25 },
  U: { jawOpen: 0.12, mouthPucker: 0.58, mouthFunnel: 0.38 },
  M: { mouthClose: 0.48, mouthPress: 0.24 },
  FV: { jawOpen: 0.08, mouthPress: 0.26 },
  L: { jawOpen: 0.28, mouthStretch: 0.06 },
};

const GUIDE_CONFIG: Partial<HumanConfig> = {
  ...DEFAULT_HUMAN,
  gender: 0,
  age: 0.2,
  hair: 'long01',
  hairColor: '#261d18',
  clothes: ['female_elegantsuit01', 'shoes01'],
};

function currentViseme(props: AvatarSurfaceProps): AvatarViseme {
  if (props.speechState !== 'speaking' || !props.speechTiming) return 'rest';
  const cue = props.speechTiming.cues.find(({ startMs, durationMs }) =>
    props.speechTiming!.currentTimeMs >= startMs
      && props.speechTiming!.currentTimeMs < startMs + durationMs,
  );
  return cue?.viseme ?? 'rest';
}

function expressionWeights(props: AvatarSurfaceProps): Record<string, number> {
  const weights = { ...EXPRESSION_WEIGHTS[props.expression] };
  if (props.speechState === 'speaking') {
    for (const [name, value] of Object.entries(VISEME_WEIGHTS[currentViseme(props)])) {
      weights[name] = Math.max(weights[name] ?? 0, value);
    }
  }
  if (props.speechState === 'paused' || props.speechState === 'interrupted' || props.speechState === 'idle') {
    weights.jawOpen = 0;
    weights.mouthPucker = 0;
    weights.mouthFunnel = 0;
  }
  return weights;
}

function headPose(props: AvatarSurfaceProps) {
  if (props.reducedMotion) return { pitch: 0, yaw: 0 };
  let pitch = 0;
  let yaw = 0;
  if (props.visualState === 'LISTENING') pitch = -0.035;
  if (props.visualState === 'THINKING' || props.visualState === 'UNCERTAIN') pitch = 0.055;
  if (props.visualState === 'CLARIFYING') pitch = -0.045;
  if (props.visualState === 'SAFETY' || props.visualState === 'IMMEDIATE_DANGER') pitch = 0.01;
  if (props.gazeTarget === 'evidence' || props.gazeTarget === 'case-record' || props.gazeTarget === 'below') pitch += 0.045;
  if (props.gazeTarget === 'side-panel') yaw = -0.055;
  if (typeof props.gazeTarget === 'object') {
    pitch += Math.max(-0.08, Math.min(0.08, props.gazeTarget.y * 0.06));
    yaw += Math.max(-0.08, Math.min(0.08, props.gazeTarget.x * 0.06));
  }
  if (props.gestureHint === 'gentle-nod' || props.gestureHint === 'review-document') pitch += 0.025;
  if (props.gestureHint === 'settle') pitch *= 0.5;
  return { pitch, yaw };
}

export function HumanAvatarRenderer(props: AvatarSurfaceProps) {
  const [pkg, setPkg] = useState<HumanPackage | null>(null);
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'unsupported'>('loading');
  const [avatarReady, setAvatarReady] = useState(false);
  const canvasRef = useRef<HumanCanvasHandle>(null);
  const avatarRef = useRef<HumanAvatar | null>(null);

  const expressions = useMemo(
    () => expressionWeights(props),
    [props.expression, props.speechState, props.speechTiming?.currentTimeMs, props.speechTiming?.cues],
  );
  const pose = useMemo(
    () => headPose(props),
    [props.visualState, props.gazeTarget, props.gestureHint, props.reducedMotion],
  );

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!document.createElement('canvas').getContext('webgl2')) {
        if (live) setAssetState('unsupported');
        return;
      }
      const ready = await fetch(`${ASSET_BASE}/READY.json`, { cache: 'force-cache' });
      if (!ready.ok) {
        if (live) setAssetState('missing');
        return;
      }
      const loaded = await loadHumanPackage(ASSET_BASE);
      if (live) {
        setPkg(loaded);
        setAssetState('ready');
      }
    };
    void load().catch(() => {
      if (live) setAssetState('error');
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const avatar = avatarRef.current ?? canvasRef.current?.avatar;
    if (!avatar) return;
    const neck = avatar.bones.find((bone) => /:Neck$/i.test(bone.name));
    const head = avatar.bones.find((bone) => /:Head$/i.test(bone.name));
    if (neck) {
      neck.rotation.x = pose.pitch * 0.35;
      neck.rotation.y = pose.yaw * 0.35;
    }
    if (head) {
      head.rotation.x = pose.pitch * 0.65;
      head.rotation.y = pose.yaw * 0.65;
    }
    canvasRef.current?.render();
  }, [pose.pitch, pose.yaw, avatarReady]);

  useEffect(() => {
    const avatar = avatarRef.current;
    if (!avatar || props.reducedMotion) return;
    let timeout: number | undefined;
    let frame: number | undefined;
    const scheduleBlink = () => {
      timeout = window.setTimeout(() => {
        const startedAt = performance.now();
        const animate = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / 150);
          const weight = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
          avatar.setExpression('eyeBlinkLeft', weight);
          avatar.setExpression('eyeBlinkRight', weight);
          canvasRef.current?.render();
          if (progress < 1) frame = window.requestAnimationFrame(animate);
          else scheduleBlink();
        };
        frame = window.requestAnimationFrame(animate);
      }, 4200);
    };
    scheduleBlink();
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      avatar.setExpression('eyeBlinkLeft', 0);
      avatar.setExpression('eyeBlinkRight', 0);
      canvasRef.current?.render();
    };
  }, [avatarReady, props.reducedMotion]);

  if (assetState !== 'ready' || !pkg) {
    const label = assetState === 'missing'
      ? 'ILLUSTRATED GUIDE · RUN SETUP:AVATAR FOR THE 3D MODEL'
      : assetState === 'unsupported'
        ? 'ILLUSTRATED GUIDE · 3D GRAPHICS UNAVAILABLE'
        : assetState === 'error'
          ? 'ILLUSTRATED GUIDE · 3D MODEL COULD NOT LOAD'
          : 'ILLUSTRATED GUIDE';
    return (
      <div className="ls-guide-human-avatar__fallback" data-avatar-fallback={assetState}>
        <IllustratedAvatarRenderer {...props} />
        <span className="ls-guide-human-avatar__fallbackLabel">{label}</span>
      </div>
    );
  }

  return (
    <div
      className="ls-guide-human-avatar__surface"
      data-state={props.visualState}
      data-speech-state={props.speechState}
      data-emotion={props.emotion}
      data-context={props.context.kind}
      data-reduced-motion={props.reducedMotion ? 'true' : undefined}
    >
      <HumanCanvas
        ref={canvasRef}
        pkg={pkg}
        config={GUIDE_CONFIG}
        framing="face"
        expressions={expressions}
        background="#111c27"
        rotatable={false}
        textureSize="1k"
        onReady={(avatar) => {
          avatarRef.current = avatar;
          setAvatarReady(true);
        }}
        className="ls-guide-human-avatar__canvas"
        style={{ width: '100%', height: '100%' }}
      />
      <div className="ls-guide-human-avatar__vignette" aria-hidden="true" />
      <span className="ls-guide-human-avatar__label">LAWSENSE · VIRTUAL GUIDE</span>
    </div>
  );
}
