# context.md

Living snapshot of the Swooshly (formerly "MatchCut", originally "Reel Two") app's current state. Update this file whenever a feature, screen, or piece of state is added, changed, or removed — this should always reflect what's actually in the code, not the original design spec.

_Last updated: 2026-08-01_

## What this app is

A movie-swiping/matching product, rendered inside an iPhone bezel on the frontend. Split into a Vite + React frontend, an Express + Postgres backend, and TMDB as the real movie catalog, all wired together with Docker Compose. Auth, preferences, swipes, likes, matches, and friend connections are now persisted server-side — a reload no longer resets the app to the Login screen if a session token is present.

## Current screen flow

1. **Login** (`screen: 'login'`) — real email/username/password form, toggling between Log in and Sign up, backed by `POST /api/auth/login` / `POST /api/auth/register`. On success (or on mount, if a JWT is already stored) the app either goes straight to `app` (if preferences are already saved) or to `onboarding`.
2. **Onboarding** (`screen: 'onboarding'`) — pick genres (multi-select chips), language (single-select, now including Telugu/Tamil/Kannada/Malayalam alongside the original set), region (multi-select chips — picking several regions fans out one TMDB discover call per region server-side and merges/dedupes by popularity, since TMDB's `region` param only accepts one value per call). "Start swiping" is disabled until at least one genre is picked, and persists the selection via `PATCH /api/me/preferences`. Reachable again later from Profile → "Genres, language & region".
3. **App shell** (`screen: 'app'`) — tab bar with 4 tabs:
   - **Discover** (`tab: 'home'`) — swipe deck over real TMDB movies fetched via `GET /api/movies` (filtered by the onboarding genres/language/region; falls back to `FALLBACK_MOVIES` in `frontend/src/data.js` if that call fails). Drag with mouse/touch in any of 4 directions: right = like, left = maybe, up = superlike (consumes a superlike, opens paywall if exhausted), down = discard. Each swipe posts to `POST /api/swipes`; a `{matched: true}` response opens the match modal. Undo button reverts the last swipe locally (does not un-record the swipe server-side). Card auto-starts a real muted/autoplaying YouTube trailer (fetched via `GET /api/movies/:id/trailer`) after `TRAILER_DELAY_MS` (3s), with a "Playing trailer" badge and Ken Burns pan animation as a backdrop. Empty state ("You're all caught up") with a "Review again" reset once the deck is exhausted; a distinct "Finding movies for you…" state shows while the initial fetch is in flight.
   - **Matches** (`tab: 'matches'`) — friend-chip selector at top (excludes pending friends), shows movies both the user and the selected friend have liked (`common`, computed server-side per friend by `GET /api/friends`). Liking a movie the user's `partner`-status friend already liked triggers the match modal.
   - **Friends** (`tab: 'friends'`) — invite by username (`POST /api/friends/invite`, creates a real pending friendship row if the username exists), invite from a static contacts list (still local-only UI state — no real contacts/SMS integration), and a connections list (partner/connected/pending, from `GET /api/friends`) — tapping a connection jumps to Matches with that friend selected.
   - **Profile** (`tab: 'profile'`) — real username/email header, superlike counter/progress bar with an "unlimited superlikes" CTA (opens paywall), preferences summary (genres/language/region), static "Notifications: On" row, and "Log out" (clears the stored JWT, returns to Login).
4. **Match modal** — shown when a swipe's `{matched}` response is true. Style controlled by the `MATCH_CELEBRATION` constant in `App.jsx`, currently `'full-screen'` (a `'toast'` variant also exists but is unused while that constant is set). Names the partner friend by username.
5. **Paywall modal** — bottom-sheet, triggered by running out of superlikes or by the two explicit upgrade CTAs (Profile, superlike card). Both buttons just close it — no real purchase flow (payment/purchase flows are intentionally not implemented per the assistant's operating rules). Superlike count itself is still session-local (not persisted server-side).

## Key tunables (top of `frontend/src/App.jsx`)

- `SUPERLIKE_LIMIT` = 5
- `TRAILER_DELAY_MS` = 3000
- `MATCH_CELEBRATION` = `'full-screen'` (alternative: `'toast'`)

## Data model

- **Frontend** (`frontend/src/data.js`) — static config only: `GENRES` / `LANGUAGES` / `REGIONS` (onboarding chip lists), `CONTACTS` (3 plain name strings for the local-only contacts-invite list), `FALLBACK_MOVIES` (6 hardcoded movies shown only if the backend/TMDB call fails), and helpers `clamp`, `initials`, `avatarBgFor`.
- **Backend** (`backend/db/schema.sql`) — `users` (email/username/password_hash/genres[]/language/regions[] — both `genres` and `regions` are JSONB arrays), `movies` (TMDB cache: tmdb_id/title/overview/rating/poster_url/genres, upserted whenever fetched or swiped), `swipes` (user_id/movie_id/direction/created_at, one row per user+movie), `friendships` (user_id/friend_id/status — one row per direction; status is `pending`/`connected`/`partner`). `schema.sql` includes a one-time migration (`region TEXT` → `regions JSONB`) for databases created before regions became multi-select.

## Visual system

- `frontend/src/index.css` — CSS custom properties for color/radius/font/shadow tokens. Uses a **teal accent + rounded corners** override of the underlying "Modernist" design-system defaults (which are red-accent/square-corner) — this override is intentional, not a bug.
- `frontend/src/components/PhoneFrame.jsx` — iOS-style bezel (dynamic island, status bar showing static "9:41", home indicator).
- `frontend/src/components/Poster.jsx` — `Poster` renders a real TMDB poster (`posterUrl` from the backend) when given a `src`, `Avatar` still renders `picsum.photos` images seeded by id (friends/users have no real photos).

## Known gaps / not implemented

- Superlike usage count is session-local, not persisted server-side (resets on reload even when logged in).
- Contact invites don't do anything beyond local UI state — no real contacts/SMS integration.
- No accept-invite UI in the frontend — `POST /api/friends/:id/accept` exists on the backend but nothing calls it yet; friendships stay `pending` until flipped directly (e.g. via `psql`) or a future UI is added.
- No automated tests, no linter configured, in either service.

## File map

```
frontend/
  src/
    main.jsx            — React root
    App.jsx              — all state + all screen components
    api.js               — the only thing that talks to the backend (fetch wrapper + JWT handling)
    data.js               — static config + small helpers
    index.css             — design tokens + component classes
    components/
      PhoneFrame.jsx     — iOS device chrome wrapper
      Poster.jsx         — Poster (real TMDB image) / Avatar (picsum placeholder)
backend/
  server.js              — mounts routes, applies schema, listens
  db/schema.sql           — users / movies / swipes / friendships
  src/
    db.js                — pg pool + applySchema
    auth.js              — JWT sign/verify + requireAuth middleware
    tmdb.js               — server-side TMDB integration (key lives only here)
    userResponse.js        — shared user-shaping helper
    routes/
      auth.js             — register, login
      me.js               — get/update current user + preferences
      movies.js            — discover + trailer proxy
      swipes.js            — record swipe, report match
      friends.js           — list/invite/accept friendships
docker-compose.yml         — db (Postgres) + backend + frontend (nginx, proxies /api to backend)
```

See `CLAUDE.md` for commands and architecture guidance aimed at future coding sessions; this file is the state/progress log, `CLAUDE.md` is the orientation doc.
