import { pool } from './db.js';

// Builds a per-genre taste profile from swipes: 'like'/'superlike' counts as
// a genre vote, 'discard' counts against it, 'maybe' is neutral (no signal).
// Used by tmdb.js to weight (not strictly filter) what gets shown next.
export async function recordSwipePreference(userId, movieId, direction) {
  const isLike = direction === 'like' || direction === 'superlike';
  if (!isLike && direction !== 'discard') return;

  const { rows } = await pool.query('SELECT genres FROM movies WHERE tmdb_id = $1', [movieId]);
  const genres = rows[0]?.genres || [];

  for (const genre of genres) {
    await pool.query(
      `INSERT INTO genre_preferences (user_id, genre, likes, dislikes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, genre) DO UPDATE SET
         likes = genre_preferences.likes + excluded.likes,
         dislikes = genre_preferences.dislikes + excluded.dislikes`,
      [userId, genre, isLike ? 1 : 0, isLike ? 0 : 1],
    );
  }
}

// { [genre]: netScore } — netScore = likes - dislikes, positive means the
// user tends to like that genre, negative means they tend to pass on it.
export async function getGenreScores(userId) {
  const { rows } = await pool.query('SELECT genre, likes, dislikes FROM genre_preferences WHERE user_id = $1', [userId]);
  return Object.fromEntries(rows.map((r) => [r.genre, r.likes - r.dislikes]));
}

// Every movie ids the user has already swiped on (any direction) — once a
// swipe is recorded, that movie shouldn't resurface in the deck again.
export async function getSwipedMovieIds(userId) {
  const { rows } = await pool.query('SELECT movie_id FROM swipes WHERE user_id = $1', [userId]);
  return new Set(rows.map((r) => r.movie_id));
}
