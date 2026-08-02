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

// Powers the Browse tab — popular movies/TV shows filtered by the caller's
// onboarding language/region (see fetchTrendingAll), biased by genre
// preference the same way Discover's "For You" deck is. Not filtered by
// swipe history, since Browse is watch-only (not a swipeable deck).
router.get('/trending', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const language = req.query.language || undefined;
  const regions = req.query.regions ? String(req.query.regions).split(',').filter(Boolean) : [];
  try {
    const { movies, totalPages } = await fetchTrendingAll({ page, userId: req.userId, language, regions });
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
