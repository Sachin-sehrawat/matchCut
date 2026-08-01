// Usage: node scripts/set-role.js <email> <member|founder>
// Run this from inside the backend container/host to grant or revoke the
// founder role used by requireFounder (see src/auth.js) and /api/admin/export.
import 'dotenv/config';
import { pool } from '../src/db.js';

const [, , email, role] = process.argv;

if (!email || !['member', 'founder'].includes(role)) {
  console.error('Usage: node scripts/set-role.js <email> <member|founder>');
  process.exit(1);
}

const { rows } = await pool.query('UPDATE users SET role = $1 WHERE email = $2 RETURNING id, email, username, role', [role, email]);
if (!rows[0]) {
  console.error(`No user found with email ${email}`);
  process.exit(1);
}

console.log(`Updated ${rows[0].username} (${rows[0].email}) -> role: ${rows[0].role}`);
process.exit(0);
