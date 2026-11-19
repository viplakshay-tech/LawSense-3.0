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

test('the 3D avatar uses only the local runtime bridge and same-origin assets', async () => {
  const renderer = await read('../../components/guide-presence/avatar/HumanAvatarRenderer.tsx');
  const bridge = await read('../../lib/humanforge-local.ts');

  assert.match(renderer, /@\/lib\/humanforge-local/);
  assert.doesNotMatch(renderer, /humanforge\/(web|human)/);
  assert.match(bridge, /node_modules\/humanforge\/src\/human\/runtime/);
  assert.match(bridge, /node_modules\/humanforge\/src\/web\/HumanCanvas/);
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
  assert.match(docs, /same-origin/i);
  assert.match(docs, /one-time setup/i);
});

test('Windows local consultation preflight checks configured on-disk voice and avatar prerequisites', async () => {
  const verifier = await read('../../scripts/verify-local-consultation.ps1');
  const voiceDocs = await read('../../docs/LOCAL_VOICE_SETUP.md');

  assert.match(verifier, /LAWSENSE_LOCAL_WHISPER_MODEL/);
  assert.match(verifier, /LAWSENSE_PIPER_MODEL_ENGLISH/);
  assert.match(verifier, /LAWSENSE_PIPER_MODEL_HINDI/);
  assert.match(verifier, /setup:avatar/);
  assert.match(verifier, /sourceCommit/);
  assert.match(voiceDocs, /verify-local-consultation\.ps1 -PrepareAvatar/);
  assert.match(voiceDocs, /RequireVoiceModels/);
  assert.match(voiceDocs, /does not download speech models/i);
});
