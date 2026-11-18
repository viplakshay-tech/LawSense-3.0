'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { HumanCanvas, useHumanPackage } from 'humanforge/web';
import type { HumanCanvasHandle } from 'humanforge/web';
import { IllustratedAvatarRenderer } from './IllustratedAvatarRenderer';
import type { AvatarSurfaceProps, AvatarViseme } from './types';
import './HumanAvatarRenderer.css';

const ASSET_BASE = '/lawsense-human';

const EXPRESSION_WEIGHTS: Record<AvatarSurfaceProps['expression'], Record<string, number>> = {
  calm: {},
  attentive: {
    'eyebrows-left-inner-up': 0.08,
    'eyebrows-right-inner-up': 0.08,
    'eye-left-opened-up': 0.04,
    'eye-right-opened-up': 0.04,
  },
  thoughtful: {
    'eyebrows-left-inner-up': 0.05,
    'eyebrows-right-inner-up': 0.05,
    'mouth-compression': 0.06,
  },
  curious: {
    'eyebrows-left-extern-up': 0.16,
    'eyebrows-right-extern-up': 0.08,
  },
  warm: { 'mouth-corner-puller': 0.16 },
  grounded: { 'mouth-compression': 0.05 },
  uncertain: {
    'eyebrows-left-inner-up': 0.18,
    'eyebrows-right-inner-up': 0.18,
  },
  concerned: {
    'eyebrows-left-inner-up': 0.18,
    'eyebrows-right-inner-up': 0.18,
    'mouth-depression': 0.08,
  },
  compassionate: {
    'eyebrows-left-inner-up': 0.12,
    'eyebrows-right-inner-up': 0.12,
    'mouth-corner-puller': 0.07,
  },
  steady: { 'mouth-compression': 0.04 },
  apologetic: {
    'eyebrows-left-inner-up': 0.15,
    'eyebrows-right-inner-up': 0.15,
    'mouth-depression': 0.08,
  },
};

const VISEME_WEIGHTS: Record<AvatarViseme, Record<string, number>> = {
  sil: {},
  rest: {},
  A: { 'mouth-open': 0.68, 'mouth-protusion': 0.08 },
  E: { 'mouth-open': 0.28, 'mouth-corner-puller': 0.12, 'mouth-retraction': 0.12 },
  I: { 'mouth-open': 0.18, 'mouth-corner-puller': 0.22, 'mouth-retraction': 0.18 },
  O: { 'mouth-open': 0.30, 'mouth-pursing': 0.48, 'mouth-protusion': 0.25 },
  U: { 'mouth-open': 0.12, 'mouth-pursing': 0.58, 'mouth-protusion': 0.38 },
  M: { 'mouth-compression': 0.52 },
  FV: { 'mouth-open': 0.08, 'mouth-compression': 0.26 },
  L: { 'mouth-open': 0.28, 'mouth-retraction': 0.06 },
};

const GUIDE_CONFIG = {
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
    weights['mouth-open'] = 0;
    weights['mouth-pursing'] = 0;
    weights['mouth-protusion'] = 0;
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

function fallback(props: AvatarSurfaceProps, state: string, label: string) {
  return (
    <div className="ls-guide-human-avatar__fallback" data-avatar-fallback={state}>
      <IllustratedAvatarRenderer {...props} />
      <span className="ls-guide-human-avatar__fallbackLabel">{label}</span>
    </div>
  );
}

function HumanAvatarCanvas(props: AvatarSurfaceProps) {
  const { pkg, error } = useHumanPackage(ASSET_BASE);
  const [avatarReady, setAvatarReady] = useState(false);
  const canvasRef = useRef<HumanCanvasHandle | null>(null);
  const avatarRef = useRef<HumanCanvasHandle['avatar']>(null);

  const expressions = useMemo(
    () => expressionWeights(props),
    [props.expression, props.speechState, props.speechTiming?.currentTimeMs, props.speechTiming?.cues],
  );
  const pose = useMemo(
    () => headPose(props),
    [props.visualState, props.gazeTarget, props.gestureHint, props.reducedMotion],
  );

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
          avatar.setExpression('eye-left-closure', weight);
          avatar.setExpression('eye-right-closure', weight);
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
      avatar.setExpression('eye-left-closure', 0);
      avatar.setExpression('eye-right-closure', 0);
      canvasRef.current?.render();
    };
  }, [avatarReady, props.reducedMotion]);

  if (error) return fallback(props, 'error', 'ILLUSTRATED GUIDE · 3D MODEL COULD NOT LOAD');
  if (!pkg) {
    return (
      <div className="ls-guide-human-avatar__loading" role="status">
        <span>Preparing local 3D guide…</span>
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

export function HumanAvatarRenderer(props: AvatarSurfaceProps) {
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'missing' | 'unsupported'>('loading');

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!document.createElement('canvas').getContext('webgl2')) {
        if (live) setAssetState('unsupported');
        return;
      }
      const ready = await fetch(ASSET_BASE + '/READY.json', { cache: 'force-cache' });
      if (!ready.ok) {
        if (live) setAssetState('missing');
        return;
      }
      if (live) setAssetState('ready');
    };
    void load().catch(() => {
      if (live) setAssetState('missing');
    });
    return () => { live = false; };
  }, []);

  if (assetState === 'missing') return fallback(props, 'missing', 'ILLUSTRATED GUIDE · RUN NPM RUN SETUP:AVATAR');
  if (assetState === 'unsupported') return fallback(props, 'unsupported', 'ILLUSTRATED GUIDE · 3D GRAPHICS UNAVAILABLE');
  if (assetState !== 'ready') return fallback(props, 'loading', 'ILLUSTRATED GUIDE');

  return <HumanAvatarCanvas {...props} />;
}
