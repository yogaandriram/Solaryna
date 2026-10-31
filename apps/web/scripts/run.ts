import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadWebConfig, loadWebEnv } from '@solaryna/config';

// Starts the dashboard: validates the web config first (the dashboard refuses to start without
// a valid DASHBOARD_PASSWORD), then runs `next dev|start` on DASHBOARD_HOST:DASHBOARD_PORT.

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('Pemakaian: tsx scripts/run.ts dev|start');
  process.exit(2);
}

let host: string;
let port: number;
try {
  ({ host, port } = loadWebConfig(loadWebEnv()));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, mode, '--hostname', host, '--port', String(port)], {
  cwd: appDir,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal === null ? 0 : 1));
});
