import test from 'node:test';
import assert from 'node:assert/strict';
import { hashToken, parseCookies, randomToken, serializeCookie, safeEqual } from './crypto.js';

test('randomToken returns URL-safe high-entropy material', () => {
  const token = randomToken();
  assert.equal(token.length > 30, true);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('hashToken is deterministic and does not equal the source token', () => {
  const token = 'session-token';
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
});

test('cookie helpers round-trip values and include secure attributes', () => {
  const header = serializeCookie('session', 'a token', { secure: true, maxAge: 60 });
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.deepEqual(parseCookies(header.split(';')[0]), { session: 'a token' });
});

test('safeEqual compares strings without accepting different lengths', () => {
  assert.equal(safeEqual('same', 'same'), true);
  assert.equal(safeEqual('same', 'different'), false);
});
