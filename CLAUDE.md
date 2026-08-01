# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Vite dev server
- `npm run build` — production build (also the fastest way to typecheck/lint-by-compile since there is no separate lint/test setup)
- `npm run preview` — serve the production build locally

There is no test suite and no linter configured in this repo yet.

## Architecture

This is a single-screen React app (MatchCut / "Reel Two") rendering an iPhone-framed mockup of a movie-swiping/matching product. There is no router and no backend — everything is client-side state in one component tree.

- `src/App.jsx` — the entire app. A single top-level `App` component owns all state (screen, tab, swipe-deck/drag state, onboarding selections, matches, friends, paywall) and passes derived data + handlers down as props to screen sub-components defined in the same file (`LoginScreen`, `OnboardingScreen`, `DiscoverScreen`, `MatchesScreen`, `FriendsScreen`, `ProfileScreen`, `TabBar`, `MatchModalFull`/`MatchModalToast`, `PaywallModal`). There's intentionally no separate state-management library or context — everything flows through `App`'s props.
  - `screen` controls the top-level flow: `login` → `onboarding` → `app`.
  - Within `screen === 'app'`, `tab` controls which of the four tab-bar screens is shown (`home`/`matches`/`friends`/`profile`).
  - The swipe deck (`DiscoverScreen`) implements drag-to-swipe via raw `mousemove`/`touchmove`/`mouseup`/`touchend` listeners bound in a `useEffect` in `App`, with drag position read through a `stateRef` ref (to avoid stale closures in the global listeners) rather than through React state directly.
  - `MATCH_CELEBRATION` (`'full-screen'` | `'toast'`), `SUPERLIKE_LIMIT`, and `TRAILER_DELAY_MS` are constants at the top of `App.jsx` — equivalent to the tunable "props" in the original design-tool export — change them there rather than threading new props through.
- `src/data.js` — static seed data (movies, friends, contacts, genre/language/region options) and small pure helpers (`clamp`, `initials`, `avatarBgFor`). Treat this as the mock backend.
- `src/components/PhoneFrame.jsx` — the iOS-style device bezel/status bar/home indicator chrome that wraps every screen.
- `src/components/Poster.jsx` — `Poster` and `Avatar` placeholder-image components; both render a `picsum.photos` image seeded by an id (movie id or friend id) since there are no real assets. Any new entity needing an image should just get a stable id and use one of these rather than sourcing real images.
- `src/index.css` — design tokens as CSS custom properties (`--color-*`, `--radius-*`, `--font-*`, `--shadow-*`) plus small component classes (`.btn`, `.input`, `.field`, `.card`, `.tag`). This app uses a teal accent + rounded radii override of the underlying "Modernist" design system defaults (which use a red accent and square corners) — keep using the teal/rounded values already in `:root` rather than reverting to the design system defaults.

## Provenance

This app was implemented from a Claude Design (claude.ai/design) project export (`Reel Two.dc.html`), which used a declarative `sc-if`/`sc-for` templating format with a `DCLogic`-based component class. That format has been fully ported to idiomatic React/JSX here — there is no runtime dependency on the original `.dc.html` tooling, and none of that scaffolding (`x-dc`, `image-slot`, `DCLogic`) is used in this repo.
