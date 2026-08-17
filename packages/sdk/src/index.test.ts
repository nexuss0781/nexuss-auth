import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoginUrl, createAuth } from './index.js';

test('buildLoginUrl creates a project-scoped Google login URL', () => {
  const url = new URL(buildLoginUrl({ projectId: 'demo', authUrl: 'https://auth.example.com' }, 'google', 'https://demo.example.com/login'));
  assert.equal(url.pathname, '/oauth/start/google');
  assert.equal(url.searchParams.get('project_id'), 'demo');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://demo.example.com/login');
});

test('buildLoginUrl requests a server-side handoff when enabled', () => {
  const url = new URL(buildLoginUrl({ projectId: 'demo', authUrl: 'https://auth.example.com' }, 'google', 'https://demo.example.com/auth/callback', { handoff: true }));
  assert.equal(url.searchParams.get('handoff'), '1');
});

test('buildLoginUrl omits handoff by default', () => {
  const url = new URL(buildLoginUrl({ projectId: 'demo', authUrl: 'https://auth.example.com' }, 'google', 'https://demo.example.com/auth/callback'));
  assert.equal(url.searchParams.get('handoff'), null);
});

test('buildLoginUrl rejects an unsupported provider', () => {
  assert.throws(() => buildLoginUrl({ projectId: 'demo', authUrl: 'https://auth.example.com' }, 'twitter' as never, 'https://demo.example.com/login'));
});

test('getUser sends the project id and credentials', async () => {
  let requested: Request | undefined;
  const auth = createAuth({
    projectId: 'demo',
    authUrl: 'https://auth.example.com',
    fetch: async (input, init) => {
      requested = new Request(input, init);
      return new Response(JSON.stringify({ user: { id: 'u1', email: 'a@example.com', name: 'Ada', avatarUrl: null } }), { status: 200 });
    },
  });
  const user = await auth.getUser();
  assert.equal(user?.id, 'u1');
  assert.equal(new URL(requested?.url ?? '').searchParams.get('project_id'), 'demo');
  assert.equal(requested?.headers.get('x-nex-auth-project'), 'demo');
  assert.equal(requested?.credentials, 'include');
});
