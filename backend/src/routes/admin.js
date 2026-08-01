import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireFounder } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth, requireFounder);

// Founder-only data export, documented in CLAUDE.md's "Founder tooling"
// section — not a hidden feature, just one with no end-user UI yet.
// If BACKUP_WEBHOOK_URL is set, the export is also POSTed there (e.g. an
// S3 presigned PUT URL, a Slack/webhook endpoint, your own backup service).
router.post('/export', asyncHandler(async (req, res) => {
  const [{ rows: users }, { rows: movies }, { rows: swipes }, { rows: friendships }] = await Promise.all([
    pool.query('SELECT id, email, username, genres, language, regions, role, created_at FROM users'),
    pool.query('SELECT * FROM movies'),
    pool.query('SELECT * FROM swipes'),
    pool.query('SELECT * FROM friendships'),
  ]);

  const exportedAt = new Date().toISOString();
  const payload = { exportedAt, users, movies, swipes, friendships };

  let pushedToWebhook = false;
  const webhookUrl = process.env.BACKUP_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      pushedToWebhook = webhookRes.ok;
    } catch {
      pushedToWebhook = false;
    }
  }

  res.json({ exportedAt, pushedToWebhook, counts: { users: users.length, movies: movies.length, swipes: swipes.length, friendships: friendships.length }, data: payload });
}));

export default router;
