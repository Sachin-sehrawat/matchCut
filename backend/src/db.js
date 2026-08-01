import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_DRIVER=sqlite is a manual, founder-triggered fallback for keeping the
// app runnable (e.g. on a laptop) if the Postgres server/host disappears.
// Whoever changes schema.sql or writes a new query must keep schema.sqlite.sql
// and this adapter in sync — see the "Founder tooling" section in CLAUDE.md.
export const driver = process.env.DB_DRIVER === 'sqlite' ? 'sqlite' : 'postgres';

let pool;
let sqliteDb;

if (driver === 'sqlite') {
  const { default: Database } = await import('better-sqlite3').catch(() => {
    throw new Error(
      "DB_DRIVER=sqlite but the 'better-sqlite3' native module isn't installed/built. " +
      'It is an optionalDependency so a plain `npm install` can still succeed without build tools present. ' +
      'Install VS Build Tools (Windows) / build-essential (Linux) and re-run `npm install`, or use the Docker image, which has build tools preinstalled.',
    );
  });
  const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'matchcut.sqlite');
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  sqliteDb = new Database(sqlitePath);
  sqliteDb.pragma('foreign_keys = ON');

  const toPositional = (text, params) => {
    const expanded = [];
    const sqliteText = text.replace(/\$(\d+)/g, (_, n) => {
      expanded.push(params[Number(n) - 1]);
      return '?';
    });
    return { sqliteText, expanded };
  };

  const parseJsonish = (value) => {
    if (typeof value !== 'string' || !(value.startsWith('[') || value.startsWith('{'))) return value;
    try { return JSON.parse(value); } catch { return value; }
  };
  const parseRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, parseJsonish(v)]));

  pool = {
    query: async (text, params = []) => {
      const { sqliteText, expanded } = toPositional(text, params);
      const stmt = sqliteDb.prepare(sqliteText);
      if (stmt.reader) return { rows: stmt.all(...expanded).map(parseRow) };
      stmt.run(...expanded);
      return { rows: [] };
    },
  };
} else {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

export { pool };

export async function applySchema() {
  const schemaFile = driver === 'sqlite' ? 'schema.sqlite.sql' : 'schema.sql';
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', schemaFile), 'utf8');
  if (driver === 'sqlite') {
    sqliteDb.exec(schema);
  } else {
    await pool.query(schema);
  }
}

export function isUniqueViolation(err) {
  return err.code === '23505' || err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

export function isForeignKeyViolation(err) {
  return err.code === '23503' || err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
}
