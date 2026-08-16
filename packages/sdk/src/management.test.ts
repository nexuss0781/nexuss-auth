import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementClient, type NexAuthProject } from './index.js';

const project: NexAuthProject = {
  projectId: 'demo',
  name: 'Demo',
  homepageUrl: 'https://demo.example.com',
  description: 'Demo project',
  avatarUrl: null,
  allowedRedirectUris: ['https://demo.example.com/auth/callback'],
  allowedOrigins: ['https://demo.example.com'],
  enabledProviders: ['google', 'github'],
  status: 'active',
};

test('management client sends bearer authorization for project creation', async () => {
  let captured: Request | undefined;
  const client = createManagementClient({
    authUrl: 'https://auth.example.com',
    adminToken: 'admin-token',
    fetch: async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify(project), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  const created = await client.createProject(project);
  assert.equal(created.projectId, 'demo');
  assert.equal(captured?.headers.get('authorization'), 'Bearer admin-token');
  assert.equal(await captured?.text(), JSON.stringify(project));
});
