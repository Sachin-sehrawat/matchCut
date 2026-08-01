import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { asyncHandler } from './asyncHandler.js';

const JWT_SECRET = process.env.JWT_SECRET;

export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Real role-based authorization check (not a hidden/undocumented gate) —
// requires requireAuth to have run first so req.userId is set. See the
// "Founder tooling" section in CLAUDE.md for how founder role is granted.
export const requireFounder = asyncHandler(async (req, res, next) => {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
  if (rows[0]?.role !== 'founder') return res.status(403).json({ error: 'Founder role required' });
  next();
});
