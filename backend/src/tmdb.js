import { pool } from './db.js';
import { archiveMovies } from './mongo.js';
import { getGenreScores, getSwipedMovieIds } from './preferences.js';

export const SORT_MODES = ['foryou', 'upcoming', 'latest', 'toprated'];

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const PROVIDER_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

const GENRE_IDS = {
  Action: 28,
  Comedy: 35,
  Drama: 18,
  'Sci-Fi': 878,
  Horror: 27,
  Romance: 10749,
  Thriller: 53,
  Documentary: 99,
  Animation: 16,
  Fantasy: 14,
};
const GENRE_LABELS = Object.fromEntries(Object.entries(GENRE_IDS).map(([label, id]) => [id, label]));

const LANGUAGE_CODES = {
  English: 'en',
  Spanish: 'es',
  French: 'fr',
  Korean: 'ko',
  Hindi: 'hi',
  Japanese: 'ja',
  Telugu: 'te',
  Tamil: 'ta',
  Kannada: 'kn',
  Malayalam: 'ml',
};

const REGION_CODES = {
  'United States': 'US',
  'United Kingdom': 'GB',
  India: 'IN',
  'South Korea': 'KR',
  France: 'FR',
  Mexico: 'MX',
};

async function fetchWithRetry(url, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
}

async function upsertMovies(movies) {
  for (const m of movies) {
    await pool.query(
      `INSERT INTO movies (tmdb_id, title, overview, rating, poster_url, genres)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tmdb_id) DO UPDATE SET
         title = EXCLUDED.title, overview = EXCLUDED.overview, rating = EXCLUDED.rating,
         poster_url = EXCLUDED.poster_url, genres = EXCLUDED.genres`,
      [m.id, m.title, m.desc, m.rating, m.posterUrl, JSON.stringify(m.genres)],
    );
  }
  // Independent long-term archive in MongoDB — see mongo.js for why.
  await archiveMovies(movies);
}

// Applies the sort-mode-specific TMDB discover params. Genre/language/region
// filters still apply on top of these — "Upcoming"/"Latest"/"Top Rated" are
// a different ordering of the same filtered catalog, not a separate browse.
function applySortParams(params, sort) {
  const today = new Date().toISOString().slice(0, 10);
  if (sort === 'upcoming') {
    // Restrict to real theatrical releases (type 2=limited, 3=wide) — without
    // this, discover's date filters surface obscure/undated placeholder
    // entries that cluster right around "today" from both directions.
    params.set('sort_by', 'primary_release_date.asc');
    params.set('primary_release_date.gte', today);
    params.set('with_release_type', '2|3');
  } else if (sort === 'latest') {
    params.set('sort_by', 'primary_release_date.desc');
    params.set('primary_release_date.lte', today);
    params.set('with_release_type', '2|3');
    params.set('vote_count.gte', '10');
  } else if (sort === 'toprated') {
    params.set('sort_by', 'vote_average.desc');
    params.set('vote_count.gte', '200');
  } else {
    params.set('sort_by', 'popularity.desc');
  }
}

async function fetchMoviesForRegion({ genres = [], language, region, page = 1, sort = 'foryou' }) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('Missing TMDB_API_KEY');

  const params = new URLSearchParams({
    api_key: apiKey,
    include_adult: 'false',
    page: String(page),
  });
  applySortParams(params, sort);
  const genreIds = genres.map((g) => GENRE_IDS[g]).filter(Boolean);
  if (genreIds.length) params.set('with_genres', genreIds.join('|'));
  if (language && LANGUAGE_CODES[language]) params.set('with_original_language', LANGUAGE_CODES[language]);
  if (region && REGION_CODES[region]) params.set('region', REGION_CODES[region]);

  const res = await fetchWithRetry(`${BASE_URL}/discover/movie?${params.toString()}`);
  if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
  const json = await res.json();

  const results = (json.results || []).map((r) => ({
    id: String(r.id),
    title: r.title,
    desc: r.overview,
    rating: Math.round((r.vote_average || 0) * 10) / 10,
    genres: (r.genre_ids || []).map((id) => GENRE_LABELS[id]).filter(Boolean),
    posterUrl: r.poster_path ? IMAGE_BASE + r.poster_path : null,
    releaseDate: r.release_date || null,
  }));

  return { results, totalPages: json.total_pages || 1 };
}

// Re-sorts a merged multi-region pool so the combined list still respects
// the requested mode (each region's results arrive pre-sorted individually,
// but concatenating two sorted lists isn't globally sorted).
function sortByMode(movies, sort) {
  if (sort === 'upcoming') return [...movies].sort((a, b) => (a.releaseDate || '9999-99-99').localeCompare(b.releaseDate || '9999-99-99'));
  if (sort === 'latest') return [...movies].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  if (sort === 'toprated') return [...movies].sort((a, b) => b.rating - a.rating);
  return movies;
}

// Weighted random ordering (Efraimidis–Spirakis sampling): every movie gets
// a random key raised to 1/weight, then we sort by that key descending.
// Higher-weight (liked-genre) movies are more likely to land near the top,
// but nothing is deterministic — reload and the order/selection still varies.
function weightedShuffle(movies, genreScores) {
  return movies
    .map((movie) => {
      const score = movie.genres.reduce((sum, g) => sum + (genreScores[g] || 0), 0);
      const weight = Math.min(20, Math.max(0.15, 2 ** (score / 3)));
      return { movie, key: Math.random() ** (1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.movie);
}

// TMDB's discover endpoint only accepts a single `region` value per call, so
// multiple selected regions are fanned out into one request each and merged.
// In 'foryou' mode, each region also pulls a second, randomly-chosen page (in
// addition to page 1) so the deck shows different movies on repeat visits,
// not just the same popularity-ranked set reordered. The other modes
// (upcoming/latest/toprated) pull a fixed page 2 instead, since their order
// is meant to be a real chronological/rating ranking, not randomized.
export async function fetchMovies({ genres = [], language, regions = [], userId, sort = 'foryou' } = {}) {
  const regionList = regions.length ? regions : [undefined];
  const isForYou = sort === 'foryou';

  const batches = await Promise.all(regionList.map(async (region) => {
    const first = await fetchMoviesForRegion({ genres, language, region, page: 1, sort });
    const maxPage = Math.min(first.totalPages, 10);
    let extraResults = [];
    if (maxPage > 1) {
      const page = isForYou ? 2 + Math.floor(Math.random() * (maxPage - 1)) : 2;
      extraResults = (await fetchMoviesForRegion({ genres, language, region, page, sort })).results;
    }
    return [...first.results, ...extraResults];
  }));

  const byId = new Map();
  for (const movie of batches.flat()) {
    if (!byId.has(movie.id)) byId.set(movie.id, movie);
  }
  let uniqueMovies = [...byId.values()];

  // Once a movie has been swiped on (any direction), it shouldn't resurface.
  const swipedIds = userId ? await getSwipedMovieIds(userId) : new Set();
  uniqueMovies = uniqueMovies.filter((m) => !swipedIds.has(m.id));

  let ranked;
  if (isForYou) {
    const genreScores = userId ? await getGenreScores(userId) : {};
    ranked = weightedShuffle(uniqueMovies, genreScores);
  } else {
    ranked = sortByMode(uniqueMovies, sort);
  }
  const movies = ranked.map(({ releaseDate, ...m }) => m);

  await upsertMovies(movies);
  return movies;
}

// Independent of any user's onboarding genres/language/region filters — this
// is TMDB's own global "trending this week" ranking (movies and TV shows
// both), used to power the Browse tab's trailer feed. The order is biased
// (not filtered) by the caller's per-genre preference scores the same way
// Discover's "For You" deck is (see weightedShuffle/getGenreScores below) —
// nothing is excluded, Browse still surfaces the same trending catalog for
// everyone, liked genres just tend to surface nearer the top.
export async function fetchTrendingAll({ page = 1, userId } = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('Missing TMDB_API_KEY');

  const params = new URLSearchParams({ api_key: apiKey, page: String(page) });
  const res = await fetchWithRetry(`${BASE_URL}/trending/all/week?${params.toString()}`);
  if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
  const json = await res.json();

  // /trending/all also returns media_type: 'person' (trending actors/crew) —
  // not something Browse can show a trailer for, so drop those.
  const items = (json.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => ({
      id: String(r.id),
      mediaType: r.media_type,
      title: r.media_type === 'tv' ? r.name : r.title,
      desc: r.overview,
      rating: Math.round((r.vote_average || 0) * 10) / 10,
      // TV shows use a different TMDB genre-id namespace than movies (e.g.
      // 10759 "Action & Adventure") which GENRE_LABELS doesn't cover, so TV
      // items will often have an empty genres list — harmless, just no tags.
      genres: (r.genre_ids || []).map((id) => GENRE_LABELS[id]).filter(Boolean),
      posterUrl: r.poster_path ? IMAGE_BASE + r.poster_path : null,
    }));

  // Only movies go into the shared `movies` cache table (also used for
  // matching/swipes) — caching TV items there risks id collisions, since
  // TMDB movie ids and tv ids are separate namespaces that can overlap.
  await upsertMovies(items.filter((m) => m.mediaType === 'movie'));

  const genreScores = userId ? await getGenreScores(userId) : {};
  const ranked = weightedShuffle(items, genreScores);
  return { movies: ranked, totalPages: json.total_pages || 1 };
}

function mapProvider(p) {
  return { id: p.provider_id, name: p.provider_name, logoPath: p.logo_path ? PROVIDER_LOGO_BASE + p.logo_path : null };
}

// TMDB's watch/providers endpoint returns every country's data in one call
// (JustWatch-sourced), so we fetch it once and pick the first of the
// caller's regions (in their preferred order) that actually has data —
// falling back through the list rather than requiring an exact match on
// the first region. Returns { region: null } if none of them have data.
export async function fetchWatchProviders(movieId, regions = []) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { region: null };

  const res = await fetchWithRetry(`${BASE_URL}/movie/${movieId}/watch/providers?api_key=${apiKey}`).catch(() => null);
  if (!res || !res.ok) return { region: null };
  const json = await res.json();
  const allResults = json.results || {};

  const regionOrder = regions.length ? regions : Object.keys(REGION_CODES);
  for (const label of regionOrder) {
    const code = REGION_CODES[label];
    const entry = code && allResults[code];
    if (entry) {
      return {
        region: label,
        flatrate: (entry.flatrate || []).map(mapProvider),
        rent: (entry.rent || []).map(mapProvider),
        buy: (entry.buy || []).map(mapProvider),
        link: entry.link || null,
      };
    }
  }
  return { region: null };
}

async function fetchTrailerKeyFromTmdb(movieId, mediaType = 'movie') {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;
  const path = mediaType === 'tv' ? 'tv' : 'movie';
  const res = await fetchWithRetry(`${BASE_URL}/${path}/${movieId}/videos?api_key=${apiKey}`).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json();
  const videos = json.results || [];
  const video = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer')
    || videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser')
    || videos.find((v) => v.site === 'YouTube');
  return video ? video.key : null;
}

// Fallback for when TMDB simply has no trailer video on file for a title
// (common for smaller/regional releases) — searches YouTube directly instead.
async function searchYouTubeTrailer(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !query) return null;

  const params = new URLSearchParams({
    part: 'snippet',
    q: `${query} official trailer`,
    type: 'video',
    maxResults: '1',
    key: apiKey,
  });
  const res = await fetchWithRetry(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json();
  return json.items?.[0]?.id?.videoId || null;
}

// `title` lets callers that already have it (e.g. the Browse feed, which
// only caches movie items — not TV — in the `movies` table) skip the DB
// lookup; Discover's swipe deck omits it and falls back to that lookup,
// unchanged from before.
export async function fetchTrailerKey(movieId, { mediaType = 'movie', title } = {}) {
  const key = await fetchTrailerKeyFromTmdb(movieId, mediaType);
  if (key) return key;

  let query = title;
  if (!query) {
    const { rows } = await pool.query('SELECT title FROM movies WHERE tmdb_id = $1', [movieId]);
    query = rows[0]?.title;
  }
  return searchYouTubeTrailer(query);
}
