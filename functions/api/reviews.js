import { hashIp, json, publicReview, readJson, sameOrigin, validDatabase } from '../_shared/reviews.js';

const MAX_REVIEW_BODY_BYTES = 16 * 1024;

let reportedRateLimitSaltConfiguration = false;

function reportRateLimitSaltConfiguration(configured) {
  if (reportedRateLimitSaltConfiguration) return;
  reportedRateLimitSaltConfiguration = true;
  console.info(`[reviews] REVIEWS_RATE_LIMIT_SALT configured=${configured}`);
}

export async function onRequestGet({ env }) {
  if (!validDatabase(env)) return json({ error: 'Review database is not configured.' }, 503);
  try {
    const [summary, rows] = await Promise.all([
      env.REVIEWS_DB.prepare("SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average FROM reviews WHERE status = 'approved'").first(),
      env.REVIEWS_DB.prepare("SELECT id, name, business, rating, review, created_at FROM reviews WHERE status = 'approved' ORDER BY created_at DESC LIMIT 100").all()
    ]);
    const reviews = (rows.results || []).map(publicReview);
    return json({ approvedCount: Number(summary.count), averageRating: Number(summary.average), reviews });
  } catch {
    return json({ error: 'Could not load approved reviews.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin submissions are not accepted.' }, 403);
  if (!validDatabase(env)) return json({ error: 'Review database is not configured. Your review was not saved.' }, 503);
  const rateLimitSalt = typeof env.REVIEWS_RATE_LIMIT_SALT === 'string' ? env.REVIEWS_RATE_LIMIT_SALT : '';
  reportRateLimitSaltConfiguration(rateLimitSalt.length > 0);
  if (!rateLimitSalt) return json({ error: 'Review spam protection is not configured. Your review was not saved.' }, 503);
  const parsed = await readJson(request, MAX_REVIEW_BODY_BYTES);
  if (!parsed.ok) {
    return json({ error: parsed.status === 413 ? 'Review submission is too large.' : 'Please send a valid review.' }, parsed.status);
  }
  const data = parsed.value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Please send a valid review.' }, 400);

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const business = typeof data.business === 'string' ? data.business.trim() : '';
  const review = typeof data.review === 'string' ? data.review.trim() : '';
  const rating = Number(data.rating);
  if (typeof data.website === 'string' && data.website.trim()) return json({ error: 'We could not accept this review.' }, 400);
  if (name.length < 2 || name.length > 80) return json({ error: 'Enter a name between 2 and 80 characters.' }, 400);
  if (business.length > 100) return json({ error: 'Business name must be 100 characters or fewer.' }, 400);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'Choose a rating from 1 to 5 stars.' }, 400);
  if (review.length < 10 || review.length > 1200) return json({ error: 'Review text must be between 10 and 1,200 characters.' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  let ipHash;
  try { ipHash = await hashIp(ip, rateLimitSalt); }
  catch {
    console.error('[reviews] spam protection unavailable: client IP hashing failed');
    return json({ error: 'Review spam protection could not verify this submission. Your review was not saved.' }, 503);
  }
  const currentWindow = Math.floor(Date.now() / 3600000);
  let rate;
  try {
    rate = await env.REVIEWS_DB.prepare(`INSERT INTO review_rate_limits (ip_hash, window, submissions) VALUES (?, ?, 1)
      ON CONFLICT(ip_hash) DO UPDATE SET
        submissions = CASE WHEN window = excluded.window THEN submissions + 1 ELSE 1 END,
        window = excluded.window
      RETURNING submissions`).bind(ipHash, currentWindow).first();
  } catch {
    console.error('[reviews] spam protection unavailable: rate-limit database operation failed');
    return json({ error: 'Review spam protection could not verify this submission. Your review was not saved.' }, 503);
  }
  if (!rate || Number(rate.submissions) > 3) return json({ error: 'Submission limit reached. Please try again later.' }, 429);

  const id = crypto.randomUUID();
  try {
    await env.REVIEWS_DB.prepare('INSERT INTO reviews (id, name, business, rating, review, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, business || null, rating, review, 'pending').run();
    return json({ id, status: 'pending', message: 'Your review was saved and is awaiting approval. It will appear publicly only if approved.' }, 202);
  } catch {
    return json({ error: 'We could not save your review. Please try again later.' }, 500);
  }
}
