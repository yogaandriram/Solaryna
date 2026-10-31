import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { WEB_ENV_KEYS } from './env';
import type { EnvSource } from './load';

/** Walks up from `startDir` to the directory whose package.json declares npm workspaces. */
export function findWorkspaceRoot(startDir: string = process.cwd()): string | null {
  // Resolved at runtime on purpose; without the hint Turbopack traces the whole project.
  let dir = path.resolve(/*turbopackIgnore: true*/ startDir);
  for (;;) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (typeof packageJson === 'object' && packageJson !== null && 'workspaces' in packageJson) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Loads `<workspace root>/.env` into process.env if it exists. Variables already set in the
 * environment take precedence. Returns the loaded path, or null when there is no file.
 */
export function loadRootEnvFile(startDir?: string): string | null {
  const root = findWorkspaceRoot(startDir);
  if (root === null) {
    return null;
  }
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) {
    return null;
  }
  process.loadEnvFile(envPath);
  return envPath;
}

/**
 * Reads only `keys` from `<workspace root>/.env`, without touching process.env. The dashboard
 * uses this so the bot's secrets (API keys, Telegram token, private key) never enter its process.
 */
export function readRootEnvKeys(
  keys: readonly string[],
  startDir?: string,
): Record<string, string> {
  const root = findWorkspaceRoot(startDir);
  if (root === null) {
    return {};
  }
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) {
    return {};
  }
  const parsed = parseEnv(readFileSync(envPath, 'utf8'));
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = parsed[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** The dashboard's environment: its keys from the root .env, overridden by real variables. */
export function loadWebEnv(startDir?: string): EnvSource {
  const env: Record<string, string> = readRootEnvKeys(WEB_ENV_KEYS, startDir);
  for (const key of WEB_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
