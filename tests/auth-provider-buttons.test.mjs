import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authPageUrl = new URL('../apps/dashboard/client/src/pages/Auth.tsx', import.meta.url);
const homePageUrl = new URL('../apps/dashboard/client/src/pages/Home.tsx', import.meta.url);

test('Nexuss Auth keeps Google and GitHub while adding ENVX on both login surfaces', async () => {
  const [authPage, homePage] = await Promise.all([readFile(authPageUrl, 'utf8'), readFile(homePageUrl, 'utf8')]);
  assert.match(authPage, /Continue with Google/);
  assert.match(authPage, /Continue with GitHub/);
  assert.match(authPage, /Continue with Envx/);
  assert.match(authPage, /start\("google"\)/);
  assert.match(authPage, /start\("github"\)/);
  assert.match(authPage, /start\("envx"\)/);
  assert.match(homePage, /Authorize with Google/);
  assert.match(homePage, /Authorize with GitHub/);
  assert.match(homePage, /Authorize with Envx/);
  assert.match(homePage, /beginDashboardSignIn\("google"\)/);
  assert.match(homePage, /beginDashboardSignIn\("github"\)/);
  assert.match(homePage, /beginDashboardSignIn\("envx"\)/);
});

test('project owners can configure ENVX-only sign-in with enforced project claims', async () => {
  const source = await readFile(homePageUrl, 'utf8');
  assert.match(source, /Required provider/);
  assert.match(source, /Require project-scoped credentials/);
  assert.match(source, /requiredProvider: details\.requiredProvider/);
  assert.match(source, /strictCredentials: details\.strictCredentials/);
  assert.match(source, /enabledProviders: details\.requiredProvider === "envx" \? \["envx"\]/);
});
