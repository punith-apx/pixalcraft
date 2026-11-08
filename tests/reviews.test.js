import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { onRequestGet as publicGet, onRequestPost } from '../functions/api/reviews.js';
import { onRequestGet as adminGet, onRequestPatch } from '../functions/api/admin/reviews.js';
import { hashIp } from '../functions/_shared/reviews.js';

class TestD1 {
  constructor() {
    this.reviews = new Map();
    this.rateLimits = new Map();
  }

  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      first: () => {
        if (sql.includes('INSERT INTO review_rate_limits')) {
          const [ipHash, window] = values;
          const previous = this.rateLimits.get(ipHash);
          const submissions = previous?.window === window ? previous.submissions + 1 : 1;
          this.rateLimits.set(ipHash, { window, submissions });
          return { submissions };
        }
        if (sql.includes('COUNT(*) AS count')) {
          const approved = [...this.reviews.values()].filter(row => row.status === 'approved');
          return { count: approved.length, average: approved.length ? approved.reduce((sum, row) => sum + row.rating, 0) / approved.length : 0 };
        }
        throw new Error('Unexpected test query');
      },
      all: () => {
        const status = sql.includes("status = 'approved'") ? 'approved' : 'pending';
        const rows = [...this.reviews.values()].filter(row => row.status === status);
        rows.sort((a, b) => status === 'pending' ? a.created_at - b.created_at : b.created_at - a.created_at);
        return { results: rows.slice(0, status === 'pending' ? 200 : 100) };
      },
      run: () => {
        if (sql.startsWith('INSERT INTO reviews')) {
          const [id, name, business, rating, review, status] = values;
          this.reviews.set(id, { id, name, business, rating, review, status, created_at: Math.floor(Date.now() / 1000) });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE reviews')) {
          const [status, id] = values;
          const row = this.reviews.get(id);
          if (!row || row.status !== 'pending') return { meta: { changes: 0 } };
          row.status = status;
          row.moderated_at = Math.floor(Date.now() / 1000);
          return { meta: { changes: 1 } };
        }
        throw new Error('Unexpected test query');
      }
    };
  }
}

const token = 'test-only-admin-token';
const makeEnv = (overrides = {}) => ({
  REVIEWS_DB: new TestD1(),
  REVIEWS_RATE_LIMIT_SALT: 'test-only-rate-limit-salt-that-is-not-a-secret',
  REVIEWS_ADMIN_TOKEN: token,
  ...overrides
});
const makeRequest = (path, { method = 'GET', body, origin = 'https://pixalcraft.test', ip = '192.0.2.10', authorization } = {}) => {
  const headers = { 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authorization) headers.Authorization = authorization;
  return new Request(`https://pixalcraft.test${path}`, { method, headers, body });
};
const reviewData = (name, rating = 5) => ({ name, business: 'Test Cafe', rating, review: 'A polished website and a great experience.' });
const result = async response => ({ status: response.status, body: await response.json() });

test('missing rate-limit salt fails closed and logs presence without a value', async () => {
  const previousInfo = console.info;
  const logs = [];
  console.info = message => logs.push(String(message));
  try {
    const env = makeEnv({ REVIEWS_RATE_LIMIT_SALT: '' });
    const response = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('Missing Salt')) }), env });
    const data = await result(response);
    assert.equal(data.status, 503);
    assert.match(data.body.error, /spam protection is not configured/);
    assert.deepEqual(logs, ['[reviews] REVIEWS_RATE_LIMIT_SALT configured=false']);
    assert.equal(env.REVIEWS_DB.reviews.size, 0);
  } finally { console.info = previousInfo; }
});

test('customer submission, moderation, visibility, and public summary work end to end', async () => {
  const env = makeEnv();
  const submit = async (name, rating) => {
    const response = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData(name, rating)), ip: name }), env });
    return result(response);
  };
  const a = await submit('Customer One', 5);
  assert.equal(a.status, 202);
  assert.equal(a.body.status, 'pending');
  assert.equal(env.REVIEWS_DB.reviews.get(a.body.id).status, 'pending');

  let publicResult = await result(await publicGet({ env }));
  assert.equal(publicResult.body.approvedCount, 0);
  assert.deepEqual(publicResult.body.reviews, []);

  let adminResult = await result(await adminGet({ request: makeRequest('/api/admin/reviews', { authorization: `Bearer ${token}` }), env }));
  assert.equal(adminResult.status, 200);
  assert.equal(adminResult.body.reviews.length, 1);
  assert.equal((await result(await adminGet({ request: makeRequest('/api/admin/reviews'), env }))).status, 401);
  const hidden = await result(await adminGet({ request: makeRequest('/api/admin/reviews', { authorization: 'Bearer wrong-token' }), env }));
  assert.equal(hidden.status, 401);
  assert.equal(Object.hasOwn(hidden.body, 'reviews'), false);

  const unauthorizedModeration = await onRequestPatch({
    request: makeRequest('/api/admin/reviews', { method: 'PATCH', body: JSON.stringify({ id: a.body.id, status: 'approved' }), authorization: 'Bearer wrong-token' }),
    env
  });
  assert.equal(unauthorizedModeration.status, 401);
  assert.equal(env.REVIEWS_DB.reviews.get(a.body.id).status, 'pending');

  let moderation = await result(await onRequestPatch({ request: makeRequest('/api/admin/reviews', { method: 'PATCH', body: JSON.stringify({ id: a.body.id, status: 'approved' }), authorization: `Bearer ${token}` }), env }));
  assert.equal(moderation.status, 200);
  assert.equal(moderation.body.status, 'approved');

  const b = await submit('Customer Two', 3);
  moderation = await result(await onRequestPatch({ request: makeRequest('/api/admin/reviews', { method: 'PATCH', body: JSON.stringify({ id: b.body.id, status: 'approved' }), authorization: `Bearer ${token}` }), env }));
  assert.equal(moderation.status, 200);

  const c = await submit('Customer Three', 1);
  moderation = await result(await onRequestPatch({ request: makeRequest('/api/admin/reviews', { method: 'PATCH', body: JSON.stringify({ id: c.body.id, status: 'rejected' }), authorization: `Bearer ${token}` }), env }));
  assert.equal(moderation.status, 200);

  publicResult = await result(await publicGet({ env }));
  assert.equal(publicResult.body.approvedCount, 2);
  assert.equal(publicResult.body.averageRating, 4);
  assert.equal(publicResult.body.reviews.length, 2);
  assert.ok(publicResult.body.reviews.every(row => row.id !== c.body.id));
  assert.equal(env.REVIEWS_DB.reviews.get(c.body.id).status, 'rejected');
});

test('invalid JSON, unexpected types, bad fields, admin payloads, and cross-origin requests are rejected', async () => {
  const env = makeEnv();
  for (const body of ['{', 'null', '[]', '"text"', '42']) {
    const response = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body }), env });
    assert.equal(response.status, 400, `submission body ${body} should be rejected`);
  }
  const badReview = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('X', 8)) }), env });
  assert.equal(badReview.status, 400);
  const crossOrigin = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('Cross Origin')), origin: 'https://attacker.invalid' }), env });
  assert.equal(crossOrigin.status, 403);
  const crossScheme = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('Cross Scheme')), origin: 'http://pixalcraft.test' }), env });
  assert.equal(crossScheme.status, 403);

  for (const body of ['{', 'null', '[]', '"text"', '42']) {
    const response = await onRequestPatch({ request: makeRequest('/api/admin/reviews', { method: 'PATCH', body, authorization: `Bearer ${token}` }), env });
    assert.equal(response.status, 400, `moderation body ${body} should be rejected`);
  }
  const wrongToken = await adminGet({ request: makeRequest('/api/admin/reviews', { authorization: 'Bearer wrong-token' }), env });
  assert.equal(wrongToken.status, 401);
});

test('oversized public and admin JSON bodies are rejected before database writes', async () => {
  const env = makeEnv();
  const largeReviewBody = JSON.stringify({ ...reviewData('Large Body'), extra: 'x'.repeat(17 * 1024) });
  const publicResponse = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: largeReviewBody }), env });
  assert.equal(publicResponse.status, 413);
  assert.equal(env.REVIEWS_DB.reviews.size, 0);
  assert.equal(env.REVIEWS_DB.rateLimits.size, 0);

  const adminResponse = await onRequestPatch({
    request: makeRequest('/api/admin/reviews', { method: 'PATCH', body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', status: 'approved', extra: 'x'.repeat(3 * 1024) }), authorization: `Bearer ${token}` }),
    env
  });
  assert.equal(adminResponse.status, 413);
});

test('static pages and API responses include browser security headers', async () => {
  const headers = await readFile(new URL('../_headers', import.meta.url), 'utf8');
  const adminClient = await readFile(new URL('../admin.js', import.meta.url), 'utf8');
  const publicClient = await readFile(new URL('../reviews.js', import.meta.url), 'utf8');
  const homePage = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const adminPage = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Permissions-Policy:/);
  assert.doesNotMatch(adminClient, /localStorage|sessionStorage/);
  assert.doesNotMatch(`${adminClient}\n${publicClient}`, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(homePage, /id="review-form" method="post"/);
  assert.match(homePage, /id="contact-form" method="post"/);
  assert.match(adminPage, /id="admin-login" class="admin-login" method="post"/);

  const response = await publicGet({ env: makeEnv() });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
});

test('review storage failures return generic errors without database details', async () => {
  const env = makeEnv();
  const originalPrepare = env.REVIEWS_DB.prepare.bind(env.REVIEWS_DB);
  env.REVIEWS_DB.prepare = sql => {
    if (sql.startsWith('INSERT INTO reviews')) {
      return { bind() { return this; }, run() { throw new Error('internal database detail'); } };
    }
    if (sql.includes('COUNT(*) AS count')) {
      return { first() { throw new Error('internal database detail'); } };
    }
    return originalPrepare(sql);
  };

  const submit = await result(await onRequestPost({
    request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('Insert Failure')) }), env
  }));
  assert.equal(submit.status, 500);
  assert.match(submit.body.error, /could not save/i);
  assert.doesNotMatch(JSON.stringify(submit.body), /internal database detail/);

  const read = await result(await publicGet({ env }));
  assert.equal(read.status, 500);
  assert.equal(read.body.error, 'Could not load approved reviews.');
  assert.doesNotMatch(JSON.stringify(read.body), /internal database detail/);
});

test('three submissions per IP per hour are allowed and the fourth is blocked', async () => {
  const env = makeEnv();
  for (let index = 0; index < 3; index++) {
    const response = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData(`Rate Test ${index}`)), ip: '192.0.2.55' }), env });
    assert.equal(response.status, 202);
  }
  const blocked = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('Rate Test Four')), ip: '192.0.2.55' }), env });
  assert.equal(blocked.status, 429);
});

test('rate-limit database failures fail closed and return a safe response', async () => {
  const env = makeEnv();
  const prepare = env.REVIEWS_DB.prepare.bind(env.REVIEWS_DB);
  env.REVIEWS_DB.prepare = sql => {
    if (sql.includes('INSERT INTO review_rate_limits')) {
      return { bind() { return this; }, first() { throw new Error('internal database detail'); } };
    }
    return prepare(sql);
  };
  const previousError = console.error;
  const logs = [];
  console.error = message => logs.push(String(message));
  try {
    const response = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('DB Failure')) }), env });
    const data = await result(response);
    assert.equal(data.status, 503);
    assert.match(data.body.error, /could not verify/);
    assert.equal(JSON.stringify(data.body).includes('internal database detail'), false);
    assert.deepEqual(logs, ['[reviews] spam protection unavailable: rate-limit database operation failed']);
  } finally { console.error = previousError; }
});

test('Web Crypto failure fails closed instead of producing an unhandled error', async () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { subtle: { importKey: async () => { throw new Error('internal crypto detail'); } } }
  });
  const previousError = console.error;
  const logs = [];
  console.error = message => logs.push(String(message));
  try {
    const env = makeEnv();
    const response = await onRequestPost({ request: makeRequest('/api/reviews', { method: 'POST', body: JSON.stringify(reviewData('Crypto Failure')) }), env });
    const data = await result(response);
    assert.equal(data.status, 503);
    assert.match(data.body.error, /could not verify/);
    assert.equal(JSON.stringify(data.body).includes('internal crypto detail'), false);
    assert.deepEqual(logs, ['[reviews] spam protection unavailable: client IP hashing failed']);
  } finally {
    console.error = previousError;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: originalCrypto });
  }
});

test('IP hashing uses Web Crypto and binds hashes to both IP and salt', async () => {
  const first = await hashIp('192.0.2.1', 'test-salt');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(await hashIp('192.0.2.1', 'test-salt'), first);
  assert.notEqual(await hashIp('192.0.2.2', 'test-salt'), first);
  assert.notEqual(await hashIp('192.0.2.1', 'different-salt'), first);
});
