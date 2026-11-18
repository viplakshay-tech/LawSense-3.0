import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the realistic HumanForge adapter is opt-in for immersive consultation with an illustrated default', async () => {
  const adapter = await read('../../components/guide-presence/avatar/AvatarSurface.tsx');
  const renderer = await read('../../components/guide-presence/avatar/HumanAvatarRenderer.tsx');
  const voiceClient = await read('../../app/case/[id]/voice/VoiceCaseClient.tsx');

  assert.match(adapter, /defaultAvatarAdapter = illustratedAvatarAdapter/);
  assert.match(adapter, /kind: 'human-avatar-engine'/);
  assert.match(adapter, /dynamic<AvatarSurfaceProps>/);
  assert.match(voiceClient, /avatarAdapter={immersive \? humanAvatarAdapter : undefined}/);
  assert.match(renderer, /IllustratedAvatarRenderer/);
  assert.match(renderer, /data-avatar-fallback/);
  assert.match(renderer, /getContext\('webgl2'\)/);
});

test('the 3D avatar uses the web-only entry point and same-origin assets', async () => {
  const renderer = await read('../../components/guide-presence/avatar/HumanAvatarRenderer.tsx');

  assert.match(renderer, /from 'humanforge\/web'/);
  assert.doesNotMatch(renderer, /humanforge\/human/);
  assert.match(renderer, /const ASSET_BASE = '\/lawsense-human'/);
  assert.match(renderer, /READY\.json/);
  assert.match(renderer, /mouth-open/);
  assert.match(renderer, /mouth-pursing/);
  assert.match(renderer, /mouth-compression/);
  assert.match(renderer, /currentTimeMs/);
  assert.match(renderer, /setExpression\('eye-left-closure'/);
  assert.match(renderer, /props\.reducedMotion/);
});

test('avatar setup downloads the pinned CC0 assets once for local runtime use', async () => {
  const setup = await read('../../scripts/setup-human-avatar.mjs');
  const docs = await read('../../docs/AVATAR_ASSET_EVALUATION.md');

  assert.match(setup, /raw\.githubusercontent\.com/);
  assert.match(setup, /sourceCommit/);
  assert.match(setup, /public\/lawsense-human/);
  assert.match(setup, /READY\.json/);
  assert.match(docs, /CC0 1\.0/);
  assert.match(docs, /one-time setup/i);
  assert.match(docs, /one-time setup/i);
});
