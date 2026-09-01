import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeCode } from './providers.js';
import type { ServerConfig } from './types.js';

const config: ServerConfig = {
  port: 0,
  databaseUrl: 'unused',
  publicUrl: 'https://auth.example.com',
  sessionTtlSeconds: 3600,
  stateTtlSeconds: 600,
  cookieName: 'nex_auth_session',
  googleClientId: 'google-id',
  googleClientSecret: 'google-secret',
  githubClientId: 'github-id',
  githubClientSecret: 'github-secret',
  oauthRequestTimeoutMs: 10,
};

test('OAuth provider exchange has a bounded request deadline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException('timed out', 'TimeoutError')), 100);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('timed out', 'TimeoutError'));
    }, { once: true });
  });
  try {
    await assert.rejects(
      exchangeCode(config, 'github', 'code', 'https://auth.example.com/oauth/callback'),
      /timed out after 10ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
