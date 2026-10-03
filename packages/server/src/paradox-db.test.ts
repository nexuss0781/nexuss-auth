import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUrl } from 'parad';
import { createParadoxDatabaseFromEnv, ParadoxDatabase } from './paradox-db.js';

const canonicalUrl = 'parad://pk_example_key@local/nexuss-auth-prod/nexuss-auth?passphrase=example-only&gateway=https://paradox-db.wasmer.app/v1';

test('canonical DATABASE_URL parses project, database, gateway, and auth scope', () => {
  const parsed = parseUrl(canonicalUrl);
  assert.equal(parsed.project, 'nexuss-auth-prod');
  assert.equal(parsed.name, 'nexuss-auth');
  assert.equal(parsed.gateway_url, 'https://paradox-db.wasmer.app/v1');
  assert.equal(parsed.token, 'pk_example_key');
  assert.equal(parsed.passphrase, 'example-only');
});

test('Paradox adapter factory requires and retains canonical DATABASE_URL', () => {
  const keys = [
    'DATABASE_URL',
    'PARADOX_GATEWAY_URL',
    'PARADOX_API_KEY',
    'PARADOX_PASSPHRASE',
    'PARADOX_PROJECT',
    'PARADOX_DATABASE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) delete process.env[key];
    process.env.PARADOX_GATEWAY_URL = 'https://legacy.example/v1';
    process.env.PARADOX_API_KEY = 'legacy-example-key';
    process.env.PARADOX_PASSPHRASE = 'legacy-example-passphrase';
    assert.throws(() => createParadoxDatabaseFromEnv(), /DATABASE_URL is required/);

    process.env.DATABASE_URL = canonicalUrl;
    const database = createParadoxDatabaseFromEnv();
    assert.ok(database instanceof ParadoxDatabase);
    const configuredUrl = (database as unknown as { config: { databaseUrl: string } }).config.databaseUrl;
    assert.equal(configuredUrl, canonicalUrl);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
