CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  name TEXT,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX reviews_status ON reviews (status, created_at);
