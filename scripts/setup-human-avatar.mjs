import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = resolve(projectRoot, 'node_modules/humanforge/assets/human');
const targetRoot = resolve(projectRoot, 'public/lawsense-human');
const sourceCommit = '2226df1f50a04c5a8e1c02ea33780d28337dfbb1';

const requiredFiles = ['manifest.json', 'body.glb.gz', 'shapes.bin.gz'];
for (const file of requiredFiles) {
  await access(resolve(sourceRoot, file)).catch(() => {
    throw new Error(`HumanForge asset ${file} is missing. Reinstall dependencies before running setup:avatar.`);
  });
}

const manifest = JSON.parse(await readFile(resolve(sourceRoot, 'manifest.json'), 'utf8'));
if (!manifest.vertexCount || !manifest.body?.file || !manifest.shapes?.file) {
  throw new Error('The installed HumanForge asset manifest is invalid.');
}

await mkdir(dirname(targetRoot), { recursive: true });
await cp(sourceRoot, targetRoot, { recursive: true, force: true });
await writeFile(
  resolve(targetRoot, 'READY.json'),
  JSON.stringify({
    provider: 'humanforge',
    sourceCommit,
    assetLicense: 'CC0-1.0',
    preparedAt: new Date().toISOString(),
  }, null, 2) + '\n',
  'utf8',
);

console.log('LawSense realistic avatar assets are ready at public/lawsense-human.');
console.log('The 3D avatar now loads from local application files; no avatar CDN is used at runtime.');
