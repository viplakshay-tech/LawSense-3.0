import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the realistic HumanForge adapter is the default renderer with an explicit illustrated fallback', async () => {
  const adapter = await read('../../components/guide-presence/avatar/AvatarSurface.tsx');
  const renderer = await read('../../components/guide-presence/avatar/HumanAvatarRenderer.tsx');

  assert.match(adapter, /defaultAvatarAdapter = humanAvatarAdapter/);
  assert.match(adapter, /kind: 'human-avatar-engine'/);
  assert.match(renderer, /IllustratedAvatarRenderer/);
  assert.match(renderer, /data-avatar-fallback/);
  assert.match(renderer, /getContext\('webgl2'\)/);
});

test('the 3D avatar loads same-origin assets and maps Guide visemes to ARKit morphs', async () => {
  const renderer = await read('../../components/guide-presence/avatar/HumanAvatarRenderer.tsx');

  assert.match(renderer, /const ASSET_BASE = '\/lawsense-human'/);
  assert.match(renderer, /READY\.json/);
  assert.match(renderer, /jawOpen/);
  assert.match(renderer, /mouthPucker/);
  assert.match(renderer, /mouthClose/);
  assert.match(renderer, /currentTimeMs/);
  assert.match(renderer, /setExpression\('eyeBlinkLeft'/);
  assert.match(renderer, /props\.reducedMotion/);
});

test('avatar setup copies pinned CC0 assets locally without a runtime CDN', async () => {
  const setup = await read('../../scripts/setup-human-avatar.mjs');
  const docs = await read('../../docs/AVATAR_ASSET_EVALUATION.md');

  assert.match(setup, /node_modules\/humanforge\/assets\/human/);
  assert.match(setup, /public\/lawsense-human/);
  assert.match(setup, /sourceCommit/);
  assert.match(docs, /CC0 1\.0/);
  assert.match(docs, /same-origin/i);
});
