import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [handler, vercelConfig] = await Promise.all([
  readFile(new URL('../api/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8').then(JSON.parse),
]);

test('production deployment does not expose the debug environment route', () => {
  const rewrites = vercelConfig.rewrites ?? [];
  assert.equal(
    rewrites.some(({ source, destination }) => `${source} ${destination}`.includes('/debug-env')),
    false,
    'Vercel must not route /debug-env to a function',
  );
  assert.doesNotMatch(
    handler,
    /if\s*\(\s*path\s*===\s*['"]\/debug-env['"]\s*\)/,
    'the API handler must not return a special response for /debug-env',
  );
  assert.doesNotMatch(
    handler,
    /(?:PARADOX_API_KEY|PARADOX_PASSPHRASE)\s*:\s*process\.env/,
    'Paradox credentials must not be serialized into a response object',
  );
});
