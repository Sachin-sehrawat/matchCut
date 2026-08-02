import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { fetchMovies, fetchTrailerKey, fetchWatchProviders, fetchTrendingAll, SORT_MODES } from '../tmdb.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const genres = req.query.genres ? String(req.query.genres).split(',').filter(Boolean) : [];
  const language = req.query.language || undefined;
  const regions = req.query.regions ? String(req.query.regions).split(',').filter(Boolean) : [];
  const sort = SORT_MODES.includes(req.query.sort) ? req.query.sort : 'foryou';
  try {
    const movies = await fetchMovies({ genres, language, regions, userId: req.userId, sort });
    res.json({ movies });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch movies', detail: err.message });
  }
}));

// Powers the Browse tab — TMDB's global trending list (movies and TV shows),
// independent of the caller's genre/language/region filters or swipe history
// (Browse is watch-only browsing, not a swipeable deck).
router.get('/trending', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  try {
    const { movies, totalPages } = await fetchTrendingAll({ page, userId: req.userId });
    res.json({ movies, page, totalPages });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch trending', detail: err.message });
  }
}));

router.get('/:id/trailer', asyncHandler(async (req, res) => {
  const mediaType = req.query.type === 'tv' ? 'tv' : 'movie';
  const title = req.query.title ? String(req.query.title) : undefined;
  const key = await fetchTrailerKey(req.params.id, { mediaType, title }).catch(() => null);
  res.json({ key });
}));

router.get('/:id/providers', asyncHandler(async (req, res) => {
  const regions = req.query.regions ? String(req.query.regions).split(',').filter(Boolean) : [];
  const mediaType = req.query.type === 'tv' ? 'tv' : 'movie';
  const providers = await fetchWatchProviders(req.params.id, regions, mediaType).catch(() => ({ region: null }));
  res.json(providers);
}));

export default router;
