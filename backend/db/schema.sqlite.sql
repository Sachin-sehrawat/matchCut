-- SQLite equivalent of schema.sql, used only when DB_DRIVER=sqlite.
-- Keep in sync with schema.sql whenever the Postgres schema changes.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  genres TEXT NOT NULL DEFAULT '[]',
  language TEXT,
  regions TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'founder')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movies (
  tmdb_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  overview TEXT,
  rating NUMERIC,
  poster_url TEXT,
  genres TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS swipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('like', 'maybe', 'discard', 'superlike')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'connected', 'partner')),
  requested_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, friend_id)
);

ALTER TABLE friendships ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS genre_preferences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, genre)
);

CREATE TABLE IF NOT EXISTS dismissed_matches (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_id, movie_id)
);

CREATE TABLE IF NOT EXISTS hidden_superlikes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  poster_url TEXT,
  rating NUMERIC,
  genres TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
