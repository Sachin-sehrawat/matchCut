import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, isUniqueViolation } from '../db.js';
import { signToken } from '../auth.js';
import { toUserResponse } from '../userResponse.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();

router.post('/register', asyncHandler(async (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !username || !password) return res.status(400).json({ error: 'email, username and password are required' });

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING *`,
      [email, username, passwordHash],
    );
    const user = rows[0];
    res.json({ token: signToken(user.id), user: toUserResponse(user) });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Email or username already in use' });
    throw err;
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user.id), user: toUserResponse(user) });
}));

export default router;
