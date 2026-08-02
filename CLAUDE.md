# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

MatchCut (formerly "Reel Two") is a movie-swiping/matching product split into two services plus two databases, orchestrated with Docker Compose:

```
/
  frontend/   Vite + React SPA (iPhone-framed mockup UI)
  backend/    Express API — auth, TMDB proxy, Postgres access, MongoDB movie archive
  docker-compose.yml
```

The frontend has no direct access to TMDB or either database — it only talks to the backend over HTTP (`frontend/src/api.js`), authenticated with a JWT bearer token stored in `localStorage`.

### Running it

- **Full stack via Docker:** copy `.env.example` to `.env` at the repo root (fill in `JWT_SECRET` and `TMDB_API_KEY`), then `docker compose up --build`. Frontend on `http://localhost:8080`, backend on `http://localhost:4000`, Postgres on `5432`, MongoDB on `27017`.
- **Local dev without Docker:** run Postgres (and, optionally, MongoDB) yourself (or `docker compose up db mongo`), copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env`, then `npm install && npm run dev` in each of `backend/` and `frontend/` separately. The frontend dev server calls the backend directly via `VITE_API_URL`; the backend allows all origins via `cors()` for this case.
- Neither service has a test suite or linter configured; `npm run build` in `frontend/` is the fastest way to typecheck/lint-by-compile.

### `frontend/`

Single-screen React app rendering an iPhone-framed mockup. No router — `src/App.jsx` is a single top-level `App` component owning all UI state (screen, tab, swipe-deck/drag state, onboarding selections, auth form) and passing derived data + handlers down as props to screen sub-components defined in the same file (`LoginScreen`, `OnboardingScreen`, `DiscoverScreen`, `MatchesScreen`, `FriendsScreen`, `ProfileScreen`, `TabBar`, `MatchModalFull`/`MatchModalToast`, `PaywallModal`).

- `screen` controls the top-level flow: `login` → `onboarding` → `app`. On mount, a stored JWT is exchanged for the session via `api.getMe()` so a refresh doesn't bounce back to login.
- Within `screen === 'app'`, `tab` controls which of the four tab-bar screens is shown (`home`/`matches`/`friends`/`profile`).
- The swipe deck (`DiscoverScreen`) implements drag-to-swipe via raw `mousemove`/`touchmove`/`mouseup`/`touchend` listeners bound in a `useEffect` in `App`, with drag position read through a `stateRef` ref (to avoid stale closures in the global listeners) rather than through React state directly. Each swipe posts to `POST /api/swipes`; a `{matched: true}` response (the partner already liked the same movie, checked server-side) triggers the match modal.
- `MATCH_CELEBRATION` (`'full-screen'` | `'toast'`), `SUPERLIKE_LIMIT`, and `TRAILER_DELAY_MS` are constants at the top of `App.jsx` — change them there rather than threading new props through.
- `src/api.js` — the only thing that talks to the backend. Thin `fetch` wrapper reading `VITE_API_URL` (default `/api`, which nginx proxies to the backend in the Docker build), attaching the stored JWT, throwing on non-OK responses.
- `src/data.js` — static config only now: `GENRES`/`LANGUAGES`/`REGIONS` (onboarding options), `FALLBACK_MOVIES` (shown if the backend/TMDB call fails), and small pure helpers (`clamp`, `initials`, `avatarBgFor`). The "Friends" tab's contact-import uses the real browser Contact Picker API directly (see `App.jsx`'s `importContacts`), not static seed data.
- `src/components/PhoneFrame.jsx` — the iOS-style device bezel/status bar/home indicator chrome that wraps every screen.
- `src/components/Poster.jsx` — `Poster` and `Avatar`. `Poster` renders a real TMDB poster when given a `src`, falling back to a `picsum.photos` placeholder seeded by id otherwise (used for friend/user avatars, which have no real images).

### `backend/`

Plain Express + `pg` (no ORM/migration framework — schema applied idempotently from `db/schema.sql` on boot, consistent with this repo's minimal-tooling style).

- `server.js` — mounts routes under `/api`, applies `db/schema.sql`, listens on `PORT`.
- `src/db.js` — the `pg` pool + `applySchema()`, plus a driver switch (`DB_DRIVER=sqlite`) to a `better-sqlite3`-backed adapter with a Postgres-compatible `query()` interface — see "Founder tooling" below.
- `src/auth.js` — JWT sign/verify, the `requireAuth` Express middleware, and `requireFounder` (role-gate for founder-only routes).
- `src/tmdb.js` — server-side TMDB integration (genre/language/region code maps — language includes Telugu/Tamil/Kannada/Malayalam for South Indian cinema — `fetchMovies`/`fetchTrailerKey`); the TMDB key lives only here, never shipped to the browser. Regions are multi-select in the UI, but TMDB's `region` param only accepts one value per call, so `fetchMovies` fans out one discover request per selected region (each pulling page 1 plus a second, randomly-chosen page, so repeat visits surface different movies, not just the same popularity-ranked set) and merges/dedupes the results before upserting into the `movies` cache table (and archiving into MongoDB — see `src/mongo.js`). The final order is a weighted-random shuffle (`weightedShuffle`, Efraimidis–Spirakis sampling) biased by the caller's per-genre preference scores from `src/preferences.js` — liked genres are more likely to surface near the top, but the order is never fully deterministic. `fetchTrailerKey` tries TMDB's videos endpoint first; if that has nothing on file (common for smaller/regional releases), it falls back to searching YouTube directly via `YOUTUBE_API_KEY` (a separate key from TMDB, optional — the fallback is skipped if unset).
- `src/preferences.js` — `recordSwipePreference(userId, movieId, direction)` (called from `POST /api/swipes`) builds a per-genre like/dislike tally in the `genre_preferences` table: `like`/`superlike` increments `likes`, `discard` increments `dislikes`, `maybe` is neutral. `getGenreScores(userId)` reads it back as `{genre: likes - dislikes}`, consumed by `tmdb.js`'s `weightedShuffle` to bias (not filter) what's shown next.
- `src/mongo.js` — `archiveMovies(movies)`, called from `tmdb.js` every time movies are fetched/shown to a user. Upserts each movie into a MongoDB `movies` collection (keyed by TMDB id, with `firstSeenAt`/`updatedAt`), independent of the Postgres `movies` cache table. The point is to accumulate MatchCut's own movie dataset over time so the app isn't permanently dependent on TMDB — not used for anything else read-side yet. Archiving is a no-op if `MONGODB_URI` is unset, and failures are caught and logged rather than breaking the movie-browsing path.
- `src/routes/auth.js` (`/api/auth/register`, `/api/auth/login`), `src/routes/me.js` (`/api/me`, `PATCH /api/me/preferences`), `src/routes/movies.js` (`/api/movies`, `/api/movies/:id/trailer`), `src/routes/swipes.js` (`POST /api/swipes` — records a swipe, updates genre preferences, returns `{matched}`), `src/routes/friends.js` (`/api/friends` — each friend's `common` list is ordered by `matchedAt`, the later of the two users' swipe timestamps, i.e. most-recently-matched first; `/api/friends/invite` — accepts a username or an email; `/api/friends/:id/accept`; `/api/friends/:id/partner`; `/api/friends/:id/superlikes` — that friend's own super-liked movies, newest first, gated on an existing connected/partner friendship; `DELETE /api/friends/:id/matches/:movieId`), `src/routes/admin.js` (`POST /api/admin/export`, founder-only — see below).
- `db/schema.sql` — `users` (includes a `role` column, `'member'` | `'founder'`), `movies` (TMDB cache), `swipes`, `friendships` (one row per direction, `status` of `pending`/`connected`/`partner`), `genre_preferences` (per-user, per-genre `likes`/`dislikes` tally — see `src/preferences.js`), `dismissed_matches` (`user_id`, `friend_id`, `movie_id` — a user hiding one shared like from their own Matches list with a given friend; `DELETE /api/friends/:id/matches/:movieId` inserts a row here rather than touching `swipes`, so it's per-viewer and doesn't affect the friend's own match list or genre preferences).

## Founder tooling

Two pieces of ops tooling exist for the founders specifically. Neither is hidden — they're real, documented, role-gated features with no dedicated UI yet (they're called directly via HTTP/CLI):

- **`POST /api/admin/export`** — requires the caller's account to have `role = 'founder'` (checked via `requireFounder` in `src/auth.js`, a normal DB-backed role check — not a hidden ID comparison). Returns a full JSON dump of `users` (minus `password_hash`), `movies`, `swipes`, and `friendships`. If `BACKUP_WEBHOOK_URL` is set, the same payload is also POSTed there (e.g. an S3 presigned PUT URL, a webhook endpoint) as an off-site backup.
- **Granting founder role**: `node scripts/set-role.js <email> founder` (or `npm run set-role -- <email> founder`) run inside the backend container/host. There is no self-service way to become a founder — it's a manual, deliberate DB update.
- **`DB_DRIVER=sqlite`** — a manual continuity fallback. Setting this env var (plus optionally `SQLITE_PATH`) makes the backend run against a local SQLite file (via `better-sqlite3`, an `optionalDependency` so a plain `npm install` still succeeds on machines without native build tools) instead of Postgres — e.g. if the Postgres host or the hosting provider itself goes away and a founder needs to keep the app running from a laptop. `DATABASE_URL` is ignored when this is set.

**Maintenance rule:** `backend/db/schema.sql` (Postgres) and `backend/db/schema.sqlite.sql` (SQLite) must be kept in sync — whenever a table or column changes in one, mirror it in the other. Query text in route files is shared between both drivers via `src/db.js`'s adapter (which rewrites `$1,$2...` placeholders and auto-parses JSON-ish string columns for SQLite), so avoid Postgres-only SQL (e.g. `now()`, `information_schema` migrations) in route queries — use `isUniqueViolation`/`isForeignKeyViolation` from `src/db.js` instead of raw Postgres error codes, and pass timestamps as JS-generated parameters rather than SQL functions. When adding new routes or schema changes, update this section and `schema.sqlite.sql` alongside them.

## Provenance

This app was originally implemented from a Claude Design (claude.ai/design) project export (`Reel Two.dc.html`), which used a declarative `sc-if`/`sc-for` templating format with a `DCLogic`-based component class. That format was fully ported to idiomatic React/JSX — there is no runtime dependency on the original `.dc.html` tooling. It later grew a real Express + Postgres backend, described above.
