import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WEB_ENV_KEYS } from './env';
import { loadWebEnv, readRootEnvKeys } from './env-file';

const dirs: string[] = [];

function workspace(envFile: string | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'solaryna-env-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
  if (envFile !== null) {
    writeFileSync(path.join(dir, '.env'), envFile);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readRootEnvKeys', () => {
  it('reads only the requested keys from the root .env', () => {
    const dir = workspace(
      [
        'DASHBOARD_PASSWORD=web-password-123',
        'BOT_WALLET_PRIVATE_KEY=never-read-me',
        'HELIUS_API_KEY=also-not-for-web',
        'MAX_OPEN_POSITIONS=4',
      ].join('\n'),
    );
    expect(readRootEnvKeys(WEB_ENV_KEYS, dir)).toEqual({
      DASHBOARD_PASSWORD: 'web-password-123',
      MAX_OPEN_POSITIONS: '4',
    });
    expect(WEB_ENV_KEYS).not.toContain('BOT_WALLET_PRIVATE_KEY');
    expect(WEB_ENV_KEYS).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  it('returns nothing when there is no .env file', () => {
    expect(readRootEnvKeys(WEB_ENV_KEYS, workspace(null))).toEqual({});
  });
});

describe('loadWebEnv', () => {
  it('lets real environment variables override the file', () => {
    const dir = workspace('DASHBOARD_PORT=3000\nDASHBOARD_HOST=127.0.0.1');
    const previous = process.env.DASHBOARD_PORT;
    process.env.DASHBOARD_PORT = '3100';
    try {
      expect(loadWebEnv(dir)).toMatchObject({
        DASHBOARD_PORT: '3100',
        DASHBOARD_HOST: '127.0.0.1',
      });
    } finally {
      if (previous === undefined) {
        delete process.env.DASHBOARD_PORT;
      } else {
        process.env.DASHBOARD_PORT = previous;
      }
    }
  });
});
