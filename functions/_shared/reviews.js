export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  }
});

export const validDatabase = env => Boolean(env.REVIEWS_DB && typeof env.REVIEWS_DB.prepare === 'function');

export async function readJson(request, maxBytes) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, status: 400 };
    if (Number(contentLength) > maxBytes) return { ok: false, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) return false; }
    catch { return false; }
  }
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}

export function validAdmin(request, env) {
  const expected = env.REVIEWS_ADMIN_TOKEN || '';
  const supplied = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  let mismatch = expected.length ^ supplied.length;
  const length = Math.max(expected.length, supplied.length);
  for (let i = 0; i < length; i++) mismatch |= (expected.charCodeAt(i) || 0) ^ (supplied.charCodeAt(i) || 0);
  return mismatch === 0;
}

export async function hashIp(ip, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function publicReview(row) {
  return {
    id: row.id,
    name: row.name,
    business: row.business,
    rating: row.rating,
    review: row.review,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString()
  };
}
