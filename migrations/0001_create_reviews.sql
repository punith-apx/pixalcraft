CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  business TEXT CHECK (business IS NULL OR length(business) <= 100),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT NOT NULL CHECK (length(review) BETWEEN 10 AND 1200),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  moderated_at INTEGER
);

CREATE INDEX IF NOT EXISTS reviews_status_created ON reviews (status, created_at DESC);

CREATE TABLE IF NOT EXISTS review_rate_limits (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  window INTEGER NOT NULL,
  submissions INTEGER NOT NULL CHECK (submissions > 0)
);
