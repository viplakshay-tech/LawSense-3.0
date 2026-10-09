import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../..');
const nextCli = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const webPort = process.env.LAWSENSE_E2E_WEB_PORT ?? '3012';

// next.config.ts may read this while building, so set it before either child starts.
process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8001';

const build = spawnSync(process.execPath, [nextCli, 'build'], {
  cwd: webRoot,
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', webPort], {
  cwd: webRoot,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
