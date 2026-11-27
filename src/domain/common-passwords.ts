import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cache: ReadonlySet<string> | undefined;

export function loadCommonPasswords(): ReadonlySet<string> {
  if (cache) {
    return cache;
  }
  const path = join(__dirname, 'data', 'common-passwords-10k.txt');
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  cache = new Set(lines);
  return cache;
}

export function isCommonPassword(candidate: string): boolean {
  return loadCommonPasswords().has(candidate);
}

/** Test helper — resets memoization between suites when needed. */
export function resetCommonPasswordsCache(): void {
  cache = undefined;
}
