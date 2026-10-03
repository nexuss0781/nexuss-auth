import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [handler, adapter, deploymentConfig] = await Promise.all([
  readFile(new URL('../api/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/server/src/paradox-db.ts', import.meta.url), 'utf8'),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
]);

test('temporary Paradox bootstrap route and provisioning code are absent', () => {
  assert.doesNotMatch(handler, /__internal\/paradox-bootstrap/);
  assert.doesNotMatch(handler, /PARADOX_BOOTSTRAP_TOKEN|x-paradox-bootstrap-token/);
  assert.doesNotMatch(handler, /GatewayClient|generateUrl|initializeParadoxSnapshotFromUrl/);
  assert.doesNotMatch(adapter, /initializeParadoxSnapshotFromUrl|nexuss-auth-bootstrap-/);
  assert.doesNotMatch(deploymentConfig, /__internal\/paradox-bootstrap/);
});
