# context.md

Living snapshot of the MatchCut ("Reel Two") app's current state. Update this file whenever a feature, screen, or piece of state is added, changed, or removed — this should always reflect what's actually in the code, not the original design spec.

_Last updated: 2026-08-01_

## What this app is

A single-screen mock of a movie-swiping/matching product, rendered inside an iPhone bezel. Client-side only — no backend, no persistence across reloads (all state resets on refresh). Built with Vite + React, no router, no state library.

## Current screen flow

1. **Login** (`screen: 'login'`) — headline + email input (not validated) + "Continue" → onboarding.
2. **Onboarding** (`screen: 'onboarding'`) — pick genres (multi-select chips), language (single-select), region (single-select). "Start swiping" is disabled until at least one genre is picked. Reachable again later from Profile → "Genres, language & region".
3. **App shell** (`screen: 'app'`) — tab bar with 4 tabs:
   - **Discover** (`tab: 'home'`) — swipe deck over a static 6-movie list (`src/data.js`). Drag with mouse/touch in any of 4 directions: right = like, left = maybe, up = superlike (consumes a superlike, opens paywall if exhausted), down = discard. Undo button reverts the last swipe. Card auto-starts a "Playing trailer" badge after `TRAILER_DELAY_MS` (3s) on the top card. Ken Burns pan animation on the poster. Empty state ("You're all caught up") with a "Review again" reset once the deck is exhausted.
   - **Matches** (`tab: 'matches'`) — friend-chip selector at top (excludes pending friends), shows movies both the user and the selected friend have liked. Liking a movie the "partner" (Jess Ko) already liked triggers the match modal.
   - **Friends** (`tab: 'friends'`) — invite by username (appends to a sent-invites list, no real send), invite from a static contacts list (toggles Invite/Invited), and a connections list (partner/connected/pending) — tapping a connection jumps to Matches with that friend selected.
   - **Profile** (`tab: 'profile'`) — superlike counter/progress bar with an "unlimited superlikes" CTA (opens paywall), preferences summary (genres/language/region picked in onboarding), static "Notifications: On" row, and "Log out" (returns to Login, resets `tab` to `home`).
4. **Match modal** — shown when a swipe produces a mutual like. Style controlled by the `MATCH_CELEBRATION` constant in `App.jsx`, currently `'full-screen'` (a `'toast'` variant also exists but is unused while that constant is set).
5. **Paywall modal** — bottom-sheet, triggered by running out of superlikes or by the two explicit upgrade CTAs (Profile, superlike card). Both buttons just close it — no real purchase flow (payment/purchase flows are intentionally not implemented per the assistant's operating rules).

## Key tunables (top of `src/App.jsx`)

- `SUPERLIKE_LIMIT` = 5
- `TRAILER_DELAY_MS` = 3000
- `MATCH_CELEBRATION` = `'full-screen'` (alternative: `'toast'`)

## Data model (`src/data.js`)

- `MOVIES` — 6 hardcoded movies with `id`, `title`, `desc`, `rating`, `genres[]`, `partnerLiked` (whether "Jess Ko" already liked it — drives match triggers).
- `FRIENDS` — 4 entries: `partner` (Jess Ko, always shown as matched with whatever the user has liked that Jess also liked), plus `f1`/`f2`/`f3` with a `status` (`connected`/`pending`) and a static `common` movie-id list.
- `CONTACTS` — 3 plain name strings for the "invite from contacts" list.
- `GENRES` / `LANGUAGES` / `REGIONS` — onboarding chip option lists.
- Helpers: `clamp`, `initials`, `avatarBgFor` (deterministic color pick by id hash).

No IDs or data come from a network call anywhere in the app.

## Visual system

- `src/index.css` — CSS custom properties for color/radius/font/shadow tokens. Uses a **teal accent + rounded corners** override of the underlying "Modernist" design-system defaults (which are red-accent/square-corner) — this override is intentional, not a bug.
- `src/components/PhoneFrame.jsx` — iOS-style bezel (dynamic island, status bar showing static "9:41", home indicator).
- `src/components/Poster.jsx` — `Poster` (movie posters) and `Avatar` (profile/friend photos) both render `picsum.photos` images seeded by a stable id string — there are no real/local image assets in the project.

## Known gaps / not implemented

- No backend, no auth, no persistence (reload resets everything to the Login screen).
- Login "Continue" accepts any input, including empty — no validation.
- Username invites and contact invites don't do anything beyond local UI state.
- No automated tests, no linter configured.

## File map

```
src/
  main.jsx            — React root
  App.jsx             — all state + all screen components (see above)
  data.js             — static seed data + small helpers
  index.css           — design tokens + component classes
  components/
    PhoneFrame.jsx     — iOS device chrome wrapper
    Poster.jsx         — placeholder image components (Poster, Avatar)
```

See `CLAUDE.md` for commands and architecture guidance aimed at future coding sessions; this file is the state/progress log, `CLAUDE.md` is the orientation doc.
