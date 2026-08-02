CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  genres JSONB NOT NULL DEFAULT '[]',
  language TEXT,
  regions JSONB NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'founder')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

-- migrate older single-region deployments (region TEXT) to the new regions JSONB array
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'region') THEN
    ALTER TABLE users RENAME COLUMN region TO regions;
    ALTER TABLE users ALTER COLUMN regions TYPE JSONB USING CASE WHEN regions IS NULL THEN '[]'::jsonb ELSE to_jsonb(ARRAY[regions::text]) END;
    ALTER TABLE users ALTER COLUMN regions SET DEFAULT '[]';
    ALTER TABLE users ALTER COLUMN regions SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS movies (
  tmdb_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  overview TEXT,
  rating NUMERIC,
  poster_url TEXT,
  genres JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS swipes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('like', 'maybe', 'discard', 'superlike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'connected', 'partner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, friend_id)
);

-- Per-genre taste record, built up from swipes (see src/preferences.js).
-- 'like'/'superlike' increments likes, 'discard' increments dislikes,
-- 'maybe' is treated as neutral and doesn't touch this table.
CREATE TABLE IF NOT EXISTS genre_preferences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, genre)
);

-- A user hiding a shared like from their own Matches list with a given
-- friend. Per-viewer only — it doesn't touch swipes/genre_preferences and
-- has no effect on what the friend sees.
CREATE TABLE IF NOT EXISTS dismissed_matches (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id, movie_id)
);

-- A user removing a movie from their own "Your Super Likes" list on the
-- Profile screen. Hides it only from that list — doesn't touch the
-- underlying swipe, so it has no effect on genre_preferences, the
-- once-swiped deck exclusion, or shared Matches with friends.
CREATE TABLE IF NOT EXISTS hidden_superlikes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id TEXT NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
