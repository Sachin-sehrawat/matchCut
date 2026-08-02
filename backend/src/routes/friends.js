import { Router } from 'express';
import { pool, isUniqueViolation } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows: friendships } = await pool.query(
    `SELECT f.friend_id AS id, f.status, u.username, u.email,
            CASE WHEN f.status = 'pending' AND f.requested_by IS NOT NULL AND f.requested_by != $1
                 THEN true ELSE false END AS incoming
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = $1`,
    [req.userId],
  );

  const friends = await Promise.all(friendships.map(async (f) => {
    const { rows: common } = await pool.query(
      `SELECT m.tmdb_id AS id, m.title, m.overview AS desc, m.rating, m.genres, m.poster_url AS "posterUrl",
              CASE WHEN s1.created_at > s2.created_at THEN s1.created_at ELSE s2.created_at END AS "matchedAt"
       FROM swipes s1
       JOIN swipes s2 ON s2.movie_id = s1.movie_id
       JOIN movies m ON m.tmdb_id = s1.movie_id
       WHERE s1.user_id = $1 AND s2.user_id = $2
         AND s1.direction IN ('like', 'superlike') AND s2.direction IN ('like', 'superlike')
         AND NOT EXISTS (
           SELECT 1 FROM dismissed_matches d
           WHERE d.user_id = $1 AND d.friend_id = $2 AND d.movie_id = s1.movie_id
         )
       ORDER BY "matchedAt" DESC`,
      [req.userId, f.id],
    );
    return { ...f, common };
  }));

  res.json({ friends });
}));

router.post('/invite', asyncHandler(async (req, res) => {
  const { identifier, username, asPartner = false } = req.body || {};
  // `identifier` may be a username or an email — the latter lets contacts
  // imported via the Contact Picker API (name/email/tel only) be invited
  // without requiring the inviter to know the other person's username.
  const lookup = identifier || username;
  if (!lookup) return res.status(400).json({ error: 'identifier is required' });

  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $1', [lookup]);
  const friend = rows[0];
  if (!friend) return res.status(404).json({ error: 'No Swooshly user with that username or email' });
  if (friend.id === req.userId) return res.status(400).json({ error: "Can't invite yourself" });

  const status = asPartner ? 'partner' : 'pending';
  try {
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id, status, requested_by) VALUES ($1, $2, $3, $1), ($2, $1, $3, $1)`,
      [req.userId, friend.id, status],
    );
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Already connected or invited' });
    throw err;
  }
  res.json({ ok: true });
}));

// Only the recipient (not whoever sent the invite) can accept it.
router.post('/:id/accept', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  await pool.query(
    `UPDATE friendships SET status = 'connected'
     WHERE status = 'pending' AND requested_by != $1
       AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
    [req.userId, friendId],
  );
  res.json({ ok: true });
}));

// Declines (deletes) a pending invite — either side can do this (the
// recipient turning it down, or the sender cancelling it).
router.post('/:id/decline', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  await pool.query(
    `DELETE FROM friendships
     WHERE status = 'pending' AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
    [req.userId, friendId],
  );
  res.json({ ok: true });
}));

// Only one partner at a time: promoting a friend demotes whoever currently
// holds partner status (both directions) back to 'connected' first.
router.post('/:id/partner', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);

  const { rows: existing } = await pool.query(
    'SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2',
    [req.userId, friendId],
  );
  if (!existing.length) return res.status(404).json({ error: 'Not connected with that user' });

  const { rows: currentPartner } = await pool.query(
    "SELECT friend_id FROM friendships WHERE user_id = $1 AND status = 'partner'",
    [req.userId],
  );
  if (currentPartner.length && currentPartner[0].friend_id !== friendId) {
    await pool.query(
      `UPDATE friendships SET status = 'connected'
       WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [req.userId, currentPartner[0].friend_id],
    );
  }

  await pool.query(
    `UPDATE friendships SET status = 'partner'
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [req.userId, friendId],
  );

  res.json({ ok: true });
}));

// The friend's own super-liked movies, newest first — used to show "what
// they super-liked" on the Matches screen. Gated on an existing (non-
// pending) friendship so a random user id can't be probed for someone's
// taste.
router.get('/:id/superlikes', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  const { rows: connected } = await pool.query(
    `SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status IN ('connected', 'partner')`,
    [req.userId, friendId],
  );
  if (!connected.length) return res.status(403).json({ error: 'Not connected with that user' });

  const { rows: movies } = await pool.query(
    `SELECT m.tmdb_id AS id, m.title, m.overview AS desc, m.rating, m.genres, m.poster_url AS "posterUrl",
            s.created_at AS "superlikedAt"
     FROM swipes s
     JOIN movies m ON m.tmdb_id = s.movie_id
     WHERE s.user_id = $1 AND s.direction = 'superlike'
     ORDER BY s.created_at DESC`,
    [friendId],
  );
  res.json({ movies });
}));

// Hides a shared like from the caller's own Matches list with this friend.
// Per-viewer: doesn't touch the friend's swipes or their view of the match.
router.delete('/:id/matches/:movieId', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  const { movieId } = req.params;
  await pool.query(
    `INSERT INTO dismissed_matches (user_id, friend_id, movie_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, friend_id, movie_id) DO NOTHING`,
    [req.userId, friendId, movieId],
  );
  res.json({ ok: true });
}));

// Shares a movie/show (from Browse) with a friend. Gated on an existing
// (non-pending) friendship, same as superlikes. Fields are passed straight
// through from the caller rather than looked up in `movies`, since Browse
// items — especially TV shows — aren't reliably cached there.
router.post('/:id/share', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  const { movieId, mediaType = 'movie', title, posterUrl, rating, genres = [] } = req.body || {};
  if (!movieId || !title) return res.status(400).json({ error: 'movieId and title are required' });

  const { rows: connected } = await pool.query(
    `SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status IN ('connected', 'partner')`,
    [req.userId, friendId],
  );
  if (!connected.length) return res.status(403).json({ error: 'Not connected with that user' });

  await pool.query(
    `INSERT INTO shares (from_user_id, to_user_id, movie_id, media_type, title, poster_url, rating, genres)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [req.userId, friendId, String(movieId), mediaType === 'tv' ? 'tv' : 'movie', title, posterUrl || null, rating ?? null, JSON.stringify(genres)],
  );
  res.json({ ok: true });
}));

// What a friend has shared with the caller, newest first — shown as a
// "Shared with you" rail on the Matches screen alongside their superlikes.
router.get('/:id/shares', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  const { rows: movies } = await pool.query(
    `SELECT id AS "shareId", movie_id AS id, media_type AS "mediaType", title, poster_url AS "posterUrl",
            rating, genres, created_at AS "sharedAt"
     FROM shares WHERE from_user_id = $1 AND to_user_id = $2
     ORDER BY created_at DESC`,
    [friendId, req.userId],
  );
  res.json({ movies });
}));

export default router;
