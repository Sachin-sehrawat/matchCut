const API_KEY = import.meta.env.VITE_TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

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
};

const REGION_CODES = {
  'United States': 'US',
  'United Kingdom': 'GB',
  India: 'IN',
  'South Korea': 'KR',
  France: 'FR',
  Mexico: 'MX',
};

export function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function fetchMovies({ genres = [], language, region } = {}) {
  if (!API_KEY) throw new Error('Missing VITE_TMDB_API_KEY');

  const params = new URLSearchParams({
    api_key: API_KEY,
    sort_by: 'popularity.desc',
    include_adult: 'false',
  });
  const genreIds = genres.map((g) => GENRE_IDS[g]).filter(Boolean);
  if (genreIds.length) params.set('with_genres', genreIds.join(','));
  if (language && LANGUAGE_CODES[language]) params.set('with_original_language', LANGUAGE_CODES[language]);
  if (region && REGION_CODES[region]) params.set('region', REGION_CODES[region]);

  const res = await fetch(`${BASE_URL}/discover/movie?${params.toString()}`);
  if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
  const json = await res.json();

  return (json.results || []).map((r) => ({
    id: String(r.id),
    title: r.title,
    desc: r.overview,
    rating: Math.round((r.vote_average || 0) * 10) / 10,
    genres: (r.genre_ids || []).map((id) => GENRE_LABELS[id]).filter(Boolean),
    posterUrl: r.poster_path ? IMAGE_BASE + r.poster_path : null,
    partnerLiked: simpleHash(String(r.id)) % 2 === 0,
  }));
}
