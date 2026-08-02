import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { fetchMovies, fetchTrailerKey, fetchWatchProviders, fetchTrendingMovies, SORT_MODES } from '../tmdb.js';
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

// Powers the Reels tab — TMDB's global trending list, independent of the
// caller's genre/language/region filters or swipe history (Reels is
// watch-only browsing, not a swipeable deck).
router.get('/trending', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  try {
    const { movies, totalPages } = await fetchTrendingMovies({ page });
    res.json({ movies, page, totalPages });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch trending movies', detail: err.message });
  }
}));

router.get('/:id/trailer', asyncHandler(async (req, res) => {
  const key = await fetchTrailerKey(req.params.id).catch(() => null);
  res.json({ key });
}));

router.get('/:id/providers', asyncHandler(async (req, res) => {
  const regions = req.query.regions ? String(req.query.regions).split(',').filter(Boolean) : [];
  const providers = await fetchWatchProviders(req.params.id, regions).catch(() => ({ region: null }));
  res.json(providers);
}));

export default router;
