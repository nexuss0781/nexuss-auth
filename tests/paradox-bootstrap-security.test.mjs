import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handler = await readFile(new URL('../api/index.ts', import.meta.url), 'utf8');

test('temporary Paradox bootstrap is POST-only and protected by a timing-safe token', () => {
  assert.match(handler, /const paradoxBootstrapPath = '\/__internal\/paradox-bootstrap'/);
  assert.match(handler, /request\.method !== 'POST'/);
  assert.match(handler, /process\.env\.PARADOX_BOOTSTRAP_TOKEN/);
  assert.match(handler, /timingSafeEqual\(suppliedBytes, expectedBytes\)/);
  assert.match(handler, /if \(path === paradoxBootstrapPath\)/);
  assert.match(handler, /paradoxBootstrapInProgress \|\| paradoxBootstrapUsed/);
  assert.match(handler, /paradoxBootstrapUsed = true/);
});

test('bootstrap authentication happens before preflight inventory and provisioning', () => {
  const tokenGate = handler.indexOf('if (!matchesBootstrapToken(');
  const inventoryRead = handler.indexOf('listParadoxInventory(gateway)');
  const projectCreate = handler.indexOf('gateway.createProject(');
  const databaseCreate = handler.indexOf('gateway.createDatabase(');
  assert.ok(tokenGate >= 0 && inventoryRead > tokenGate);
  assert.ok(projectCreate > inventoryRead);
  assert.ok(databaseCreate > projectCreate);
  assert.match(handler, /action === 'preflight'/);
  assert.match(handler, /target_project_exists/);
  assert.match(handler, /target_database_name_exists/);
  assert.doesNotMatch(handler, /console\.log\([^)]*(?:databaseUrl|apiKey|passphrase)/i);
});
