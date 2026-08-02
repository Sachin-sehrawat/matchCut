import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { toUserResponse } from '../userResponse.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: toUserResponse(rows[0]) });
}));

// The caller's own super-liked movies, newest first — shown on the Profile screen.
router.get('/superlikes', asyncHandler(async (req, res) => {
  const { rows: movies } = await pool.query(
    `SELECT m.tmdb_id AS id, m.title, m.overview AS desc, m.rating, m.genres, m.poster_url AS "posterUrl",
            s.created_at AS "superlikedAt"
     FROM swipes s
     JOIN movies m ON m.tmdb_id = s.movie_id
     WHERE s.user_id = $1 AND s.direction = 'superlike'
     ORDER BY s.created_at DESC`,
    [req.userId],
  );
  res.json({ movies });
}));

router.patch('/preferences', asyncHandler(async (req, res) => {
  const { genres = [], language = null, regions = [] } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE users SET genres = $1, language = $2, regions = $3 WHERE id = $4 RETURNING *`,
    [JSON.stringify(genres), language, JSON.stringify(regions), req.userId],
  );
  res.json({ user: toUserResponse(rows[0]) });
}));

export default router;
