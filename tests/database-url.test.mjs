import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [handler, adapter] = await Promise.all([
  readFile(new URL('../api/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/server/src/paradox-db.ts', import.meta.url), 'utf8'),
]);

test('normal Vercel persistence is wired through canonical DATABASE_URL', () => {
  assert.match(handler, /createParadoxDatabaseFromEnv\(\)/);
  assert.match(handler, /databaseUrl:\s*required\('DATABASE_URL'\)/);
  assert.match(adapter, /const databaseUrl = process\.env\.DATABASE_URL/);
  assert.doesNotMatch(adapter, /process\.env\.PARADOX_/);
});
