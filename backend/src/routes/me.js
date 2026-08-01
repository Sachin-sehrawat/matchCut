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

router.patch('/preferences', asyncHandler(async (req, res) => {
  const { genres = [], language = null, regions = [] } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE users SET genres = $1, language = $2, regions = $3 WHERE id = $4 RETURNING *`,
    [JSON.stringify(genres), language, JSON.stringify(regions), req.userId],
  );
  res.json({ user: toUserResponse(rows[0]) });
}));

export default router;
