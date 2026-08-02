import { Router } from 'express';
import { pool, isUniqueViolation } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows: friendships } = await pool.query(
    `SELECT f.friend_id AS id, f.status, u.username, u.email
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = $1`,
    [req.userId],
  );

  const friends = await Promise.all(friendships.map(async (f) => {
    const { rows: common } = await pool.query(
      `SELECT m.tmdb_id AS id, m.title, m.overview AS desc, m.rating, m.genres, m.poster_url AS "posterUrl"
       FROM swipes s1
       JOIN swipes s2 ON s2.movie_id = s1.movie_id
       JOIN movies m ON m.tmdb_id = s1.movie_id
       WHERE s1.user_id = $1 AND s2.user_id = $2
         AND s1.direction IN ('like', 'superlike') AND s2.direction IN ('like', 'superlike')
         AND NOT EXISTS (
           SELECT 1 FROM dismissed_matches d
           WHERE d.user_id = $1 AND d.friend_id = $2 AND d.movie_id = s1.movie_id
         )`,
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
  if (!friend) return res.status(404).json({ error: 'No MatchCut user with that username or email' });
  if (friend.id === req.userId) return res.status(400).json({ error: "Can't invite yourself" });

  const status = asPartner ? 'partner' : 'pending';
  try {
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, $3), ($2, $1, $3)`,
      [req.userId, friend.id, status],
    );
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Already connected or invited' });
    throw err;
  }
  res.json({ ok: true });
}));

router.post('/:id/accept', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.id);
  await pool.query(
    `UPDATE friendships SET status = 'connected'
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

export default router;
