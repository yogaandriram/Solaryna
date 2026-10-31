import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Walks up from `startDir` to the directory whose package.json declares npm workspaces. */
export function findWorkspaceRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
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
