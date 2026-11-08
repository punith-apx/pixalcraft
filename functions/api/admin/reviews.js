import { json, readJson, validAdmin, validDatabase } from '../../_shared/reviews.js';

const MAX_MODERATION_BODY_BYTES = 2 * 1024;

function authorized(request, env) {
  return validAdmin(request, env) ? null : json({ error: 'Admin authorization required.' }, 401);
}

export async function onRequestGet({ request, env }) {
  const denied = authorized(request, env);
  if (denied) return denied;
  if (!validDatabase(env)) return json({ error: 'Review database is not configured.' }, 503);
  try {
    const { results } = await env.REVIEWS_DB.prepare("SELECT id, name, business, rating, review, created_at FROM reviews WHERE status = 'pending' ORDER BY created_at ASC LIMIT 200").all();
    return json({ reviews: (results || []).map(row => ({ ...row, createdAt: new Date(Number(row.created_at) * 1000).toISOString() })) });
  } catch { return json({ error: 'Could not load pending reviews.' }, 500); }
}

export async function onRequestPatch({ request, env }) {
  const denied = authorized(request, env);
  if (denied) return denied;
  if (!validDatabase(env)) return json({ error: 'Review database is not configured.' }, 503);
  const parsed = await readJson(request, MAX_MODERATION_BODY_BYTES);
  if (!parsed.ok) {
    return json({ error: parsed.status === 413 ? 'Moderation request is too large.' : 'Please send a valid moderation action.' }, parsed.status);
  }
  const data = parsed.value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Please send a valid moderation action.' }, 400);
  const id = typeof data.id === 'string' ? data.id : '';
  const status = data.status;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['approved', 'rejected'].includes(status)) return json({ error: 'Choose a review and approve or reject it.' }, 400);
  try {
    const result = await env.REVIEWS_DB.prepare("UPDATE reviews SET status = ?, moderated_at = unixepoch() WHERE id = ? AND status = 'pending'").bind(status, id).run();
    if (!result.meta?.changes) return json({ error: 'This pending review was not found or was already moderated.' }, 404);
    return json({ id, status, message: `Review ${status}.` });
  } catch { return json({ error: 'Could not update this review.' }, 500); }
}
