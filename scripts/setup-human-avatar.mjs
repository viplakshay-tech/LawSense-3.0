import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const projectRoot = process.cwd();
const targetRoot = resolve(projectRoot, 'public/lawsense-human');
const readyPath = resolve(targetRoot, 'READY.json');
const sourceOwner = 'abdulrehman043';
const sourceRepo = 'humanforge';
const sourceCommit = '2226df1f50a04c5a8e1c02ea33780d28337dfbb1';
const sourcePrefix = 'assets/human/';
const concurrency = 6;

const treeUrl = 'https://api.github.com/repos/' + sourceOwner + '/' + sourceRepo
  + '/git/trees/' + sourceCommit + '?recursive=1';
const treeResponse = await fetch(treeUrl, {
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LawSense-3.0-local-avatar-setup',
  },
  signal: AbortSignal.timeout(30_000),
});
if (!treeResponse.ok) {
  throw new Error('Could not read the pinned HumanForge asset manifest from GitHub. HTTP ' + treeResponse.status);
}

const tree = await treeResponse.json();
if (tree.truncated) throw new Error('GitHub returned a truncated HumanForge asset tree; refusing an incomplete setup.');

const files = tree.tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(sourcePrefix));
if (!files.length) throw new Error('No HumanForge human assets were found at the pinned source commit.');

for (const required of ['manifest.json', 'body.glb.gz', 'shapes.bin.gz']) {
  if (!files.some((file) => file.path === sourcePrefix + required)) {
    throw new Error('The pinned HumanForge asset tree is missing ' + required + '.');
  }
}

await mkdir(targetRoot, { recursive: true });
await rm(readyPath, { force: true });

let nextIndex = 0;
let completed = 0;
let downloaded = 0;
let skipped = 0;
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= files.length) return;
    const file = files[index];
    const relativePath = file.path.slice(sourcePrefix.length);
    const destination = resolve(targetRoot, relativePath);
    if (!destination.startsWith(targetRoot + sep)) {
      throw new Error('Refusing an unsafe asset path: ' + file.path);
    }

    await mkdir(dirname(destination), { recursive: true });
    try {
      if ((await stat(destination)).size === file.size) {
        skipped += 1;
        completed += 1;
        continue;
      }
    } catch {
      // The asset is not present yet; download it below.
    }

    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
    const rawUrl = 'https://raw.githubusercontent.com/' + sourceOwner + '/' + sourceRepo
      + '/' + sourceCommit + '/' + encodedPath;
    const response = await fetch(rawUrl, {
      headers: { 'User-Agent': 'LawSense-3.0-local-avatar-setup' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error('Failed to download ' + file.path + '. HTTP ' + response.status);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== file.size) {
      throw new Error('Size mismatch for ' + file.path + ': expected ' + file.size + ', received ' + bytes.byteLength);
    }
    await writeFile(destination, bytes);
    downloaded += 1;
    completed += 1;
    if (completed % 20 === 0 || completed === files.length) {
      console.log('Prepared ' + completed + '/' + files.length + ' avatar assets…');
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
await writeFile(
  readyPath,
  JSON.stringify({
    provider: 'humanforge',
    sourceCommit,
    assetLicense: 'CC0-1.0',
    fileCount: files.length,
    totalBytes,
    downloadedFiles: downloaded,
    reusedFiles: skipped,
    preparedAt: new Date().toISOString(),
  }, null, 2) + '\n',
  'utf8',
);

console.log('LawSense realistic avatar assets are ready at public/lawsense-human.');
console.log('Downloaded ' + downloaded + ' files; reused ' + skipped + ' existing files.');
console.log('Runtime assets are same-origin and do not require an avatar CDN.');
