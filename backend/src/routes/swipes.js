import { Router } from 'express';
import { pool, isForeignKeyViolation } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { recordSwipePreference } from '../preferences.js';

const router = Router();
router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const { movieId, direction } = req.body || {};
  if (!movieId || !direction) return res.status(400).json({ error: 'movieId and direction are required' });

  try {
    await pool.query(
      `INSERT INTO swipes (user_id, movie_id, direction, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, movie_id) DO UPDATE SET direction = EXCLUDED.direction, created_at = EXCLUDED.created_at`,
      [req.userId, movieId, direction, new Date().toISOString()],
    );
  } catch (err) {
    if (isForeignKeyViolation(err)) return res.status(404).json({ error: 'Unknown movie' });
    throw err;
  }

  try {
    await recordSwipePreference(req.userId, movieId, direction);
  } catch (err) {
    console.error('Failed to record genre preference (non-fatal):', err.message);
  }

  let matched = false;
  if (direction === 'like' || direction === 'superlike') {
    const { rows } = await pool.query(
      `SELECT 1 FROM friendships f
       JOIN swipes s ON s.user_id = f.friend_id AND s.movie_id = $2 AND s.direction IN ('like', 'superlike')
       WHERE f.user_id = $1 AND f.status = 'partner'`,
      [req.userId, movieId],
    );
    matched = rows.length > 0;
  }

  res.json({ matched });
}));

export default router;
