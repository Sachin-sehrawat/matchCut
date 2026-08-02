import { useEffect, useRef, useState } from 'react';
import PhoneFrame from './components/PhoneFrame.jsx';
import Poster, { Avatar } from './components/Poster.jsx';
import { GENRES, LANGUAGES, REGIONS, FALLBACK_MOVIES, clamp, initials, avatarBgFor } from './data.js';
import * as api from './api.js';

const SUPERLIKE_LIMIT = 5;
const TRAILER_DELAY_MS = 3000;
const MATCH_CELEBRATION = 'toast'; // 'full-screen' | 'toast'
const DIRECTION_MAP = { right: 'like', left: 'maybe', up: 'superlike', down: 'discard' };

// Synthesized (no audio assets needed) — one short distinct tone per swipe
// direction via Web Audio oscillators, created lazily so the first tone
// only fires after a real user gesture (satisfies autoplay policy).
let audioCtx = null;
function getAudioCtx() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freqs, { duration = 0.1, type = 'sine', gain = 0.16 } = {}) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  freqs.forEach((freq, i) => {
    const start = now + i * duration;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  });
}
const SWIPE_SOUNDS = {
  right: () => playTone([660, 880], { type: 'triangle', duration: 0.09 }),
  left: () => playTone([440], { type: 'sine', duration: 0.14 }),
  down: () => playTone([320, 180], { type: 'sawtooth', duration: 0.11 }),
  up: () => playTone([700, 950, 1300], { type: 'triangle', duration: 0.07 }),
};
function playSwipeSound(dir) { SWIPE_SOUNDS[dir]?.(); }

const chipStyle = (selected) => selected
  ? { background: 'var(--color-accent)', color: '#fff', padding: '8px 14px', cursor: 'pointer', border: 'none', font: '600 12px var(--font-body)' }
  : { background: 'transparent', color: 'var(--color-text)', border: '2px solid var(--color-divider)', padding: '6px 12px', cursor: 'pointer', font: '600 12px var(--font-body)' };

export default function App() {
  const [screen, setScreen] = useState('login'); // login | onboarding | app
  const [tab, setTab] = useState('home'); // home | matches | friends | profile
  const [restoring, setRestoring] = useState(true);

  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // login | signup
  const [authForm, setAuthForm] = useState({ email: '', username: '', password: '' });
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [genresSel, setGenresSel] = useState([]);
  const [language, setLanguage] = useState(null);
  const [regionsSel, setRegionsSel] = useState([]);

  const [movies, setMovies] = useState([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [sortMode, setSortMode] = useState('foryou'); // foryou | upcoming | latest | toprated
  const [friends, setFriends] = useState([]);

  const [deckIndex, setDeckIndex] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  const [dragDy, setDragDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exitDir, setExitDir] = useState(null);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [trailerMuted, setTrailerMuted] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  const [providers, setProviders] = useState(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [likedMovies, setLikedMovies] = useState([]);
  const [superlikesUsed, setSuperlikesUsed] = useState(0);

  const [showMatch, setShowMatch] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [movieDetail, setMovieDetail] = useState(null);
  const [movieDetailProviders, setMovieDetailProviders] = useState(null);
  const [movieDetailProvidersLoading, setMovieDetailProvidersLoading] = useState(false);

  const [activeFriendId, setActiveFriendId] = useState(null);
  const [friendSuperlikes, setFriendSuperlikes] = useState([]);
  const [friendSuperlikesLoading, setFriendSuperlikesLoading] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [sentInvites, setSentInvites] = useState([]);
  const [inviteError, setInviteError] = useState(null);
  const [pickedContacts, setPickedContacts] = useState([]);
  const [contactsStatus, setContactsStatus] = useState({}); // per-contact invite result, keyed by index
  const [contactsError, setContactsError] = useState(null);

  const dragStart = useRef(null);
  const trailerTimer = useRef(null);
  const trailerIframeRef = useRef(null);
  const stateRef = useRef();
  const isFounder = user?.role === 'founder';
  stateRef.current = { dragDx, dragDy, deckIndex, superlikesUsed, exitDir, movies, isFounder };

  // — restore session —
  useEffect(() => {
    const token = api.getToken();
    if (!token) { setRestoring(false); return; }
    api.getMe()
      .then(({ user }) => {
        setUser(user);
        setGenresSel(user.genres || []);
        setLanguage(user.language);
        setRegionsSel(user.regions || []);
        if (user.genres && user.genres.length) {
          setScreen('app');
          loadMovies({ genres: user.genres, language: user.language, regions: user.regions });
          loadFriends();
        } else {
          setScreen('onboarding');
        }
      })
      .catch(() => api.clearToken())
      .finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // — trailer autoplay —
  useEffect(() => {
    clearTimeout(trailerTimer.current);
    setTrailerPlaying(false);
    setTrailerMuted(true);
    setDescExpanded(false);
    if (screen === 'app' && tab === 'home') {
      trailerTimer.current = setTimeout(() => setTrailerPlaying(true), TRAILER_DELAY_MS);
    }
    return () => clearTimeout(trailerTimer.current);
  }, [screen, tab, deckIndex]);

  // — trailer key fetch —
  useEffect(() => {
    setTrailerKey(null);
    if (!trailerPlaying) return;
    const movie = movies[deckIndex];
    if (!movie) return;
    let cancelled = false;
    api.getTrailerKey(movie.id).then((key) => { if (!cancelled) setTrailerKey(key); }).catch(() => {});
    return () => { cancelled = true; };
  }, [trailerPlaying, deckIndex, movies]);

  // — watch providers fetch —
  useEffect(() => {
    setProviders(null);
    const movie = movies[deckIndex];
    if (!movie) return;
    setProvidersLoading(true);
    let cancelled = false;
    api.getWatchProviders(movie.id, regionsSel)
      .then((result) => { if (!cancelled) setProviders(result); })
      .catch(() => { if (!cancelled) setProviders({ region: null }); })
      .finally(() => { if (!cancelled) setProvidersLoading(false); });
    return () => { cancelled = true; };
  }, [deckIndex, movies, regionsSel]);

  // — friend's super likes (Matches tab) —
  useEffect(() => {
    setFriendSuperlikes([]);
    if (!activeFriendId) return;
    setFriendSuperlikesLoading(true);
    let cancelled = false;
    api.getFriendSuperlikes(activeFriendId)
      .then((movies) => { if (!cancelled) setFriendSuperlikes(movies); })
      .catch(() => { if (!cancelled) setFriendSuperlikes([]); })
      .finally(() => { if (!cancelled) setFriendSuperlikesLoading(false); });
    return () => { cancelled = true; };
  }, [activeFriendId]);

  // — drag binding —
  useEffect(() => {
    const onMove = (e) => {
      if (!dragStart.current) return;
      const p = e.touches ? e.touches[0] : e;
      setDragDx(p.clientX - dragStart.current.x);
      setDragDy(p.clientY - dragStart.current.y);
    };
    const onUp = () => {
      if (!dragStart.current) return;
      dragStart.current = null;
      resolveSwipe();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = (e) => {
    if (stateRef.current.exitDir) return;
    const p = e.touches ? e.touches[0] : e;
    dragStart.current = { x: p.clientX, y: p.clientY };
    setDragging(true);
    setDragDx(0);
    setDragDy(0);
  };

  const resolveSwipe = () => {
    const { dragDx, dragDy } = stateRef.current;
    const TH = 90;
    let dir = null;
    if (Math.abs(dragDy) > Math.abs(dragDx)) {
      if (dragDy < -TH) dir = 'up';
      else if (dragDy > TH) dir = 'down';
    } else {
      if (dragDx > TH) dir = 'right';
      else if (dragDx < -TH) dir = 'left';
    }
    if (dir) commitSwipe(dir);
    else {
      setDragging(false);
      setDragDx(0);
      setDragDy(0);
    }
  };

  const commitSwipe = (dir) => {
    if (dir === 'up' && !stateRef.current.isFounder && stateRef.current.superlikesUsed >= SUPERLIKE_LIMIT) {
      setDragging(false);
      setDragDx(0);
      setDragDy(0);
      setShowPaywall(true);
      return;
    }
    const prevDeckIndex = stateRef.current.deckIndex;
    const movie = stateRef.current.movies[prevDeckIndex];
    const wasLiked = dir === 'right' || dir === 'up';
    playSwipeSound(dir);
    setExitDir(dir);
    setDragging(false);
    setTimeout(() => {
      setDeckIndex(prevDeckIndex + 1);
      setDragDx(0);
      setDragDy(0);
      setExitDir(null);
      setHistory((h) => [...h, { prevDeckIndex, dir, movieId: movie ? movie.id : null, wasLiked }]);
      if (dir === 'up') setSuperlikesUsed((n) => n + 1);
      if (movie) {
        if (wasLiked) setLikedMovies((lm) => [...lm, movie.id]);
        api.submitSwipe({ movieId: movie.id, direction: DIRECTION_MAP[dir] })
          .then((res) => {
            if (res.matched) { setShowMatch(movie); loadFriends(); }
          })
          .catch(() => {});
      }
    }, 260);
  };

  const swipeLike = () => commitSwipe('right');
  const swipeMaybe = () => commitSwipe('left');
  const swipeDiscard = () => commitSwipe('down');
  const swipeSuper = () => commitSwipe('up');

  const undoSwipe = () => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setDeckIndex(last.prevDeckIndex);
    setHistory((h) => h.slice(0, -1));
    if (last.wasLiked && last.movieId) setLikedMovies((lm) => lm.filter((id) => id !== last.movieId));
    if (last.dir === 'up') setSuperlikesUsed((n) => Math.max(0, n - 1));
  };
  const resetDeck = () => { setDeckIndex(0); setHistory([]); };

  const loadMovies = async ({ genres, language, regions, sort = sortMode }) => {
    setMoviesLoading(true);
    let results = [];
    try {
      results = await api.getMovies({ genres, language, regions, sort });
    } catch {
      results = [];
    }
    setMovies(results.length ? results : (sort === 'foryou' ? FALLBACK_MOVIES : []));
    setDeckIndex(0);
    setHistory([]);
    setMoviesLoading(false);
  };

  const changeSortMode = (mode) => {
    if (mode === sortMode) return;
    setSortMode(mode);
    loadMovies({ genres: genresSel, language, regions: regionsSel, sort: mode });
  };

  const loadFriends = async () => {
    try {
      const list = await api.getFriends();
      setFriends(list);
      setActiveFriendId((current) => current ?? (list.find((f) => f.status === 'partner') || list[0])?.id ?? null);
    } catch {
      setFriends([]);
    }
  };

  const submitAuth = async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { email, username, password } = authForm;
      const res = authMode === 'signup'
        ? await api.register({ email, username, password })
        : await api.login({ email, password });
      api.setToken(res.token);
      setUser(res.user);
      setGenresSel(res.user.genres || []);
      setLanguage(res.user.language);
      setRegionsSel(res.user.regions || []);
      if (res.user.genres && res.user.genres.length) {
        setScreen('app');
        loadMovies({ genres: res.user.genres, language: res.user.language, regions: res.user.regions });
        loadFriends();
      } else {
        setScreen('onboarding');
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const goToOnboarding = () => setScreen('onboarding');
  const goToLogin = () => {
    api.clearToken();
    setUser(null);
    setFriends([]);
    setMovies([]);
    setActiveFriendId(null);
    setLikedMovies([]);
    setSortMode('foryou');
    setAuthForm({ email: '', username: '', password: '' });
    setScreen('login');
    setTab('home');
  };
  const finishOnboarding = async () => {
    if (!genresSel.length) return;
    const { user: updated } = await api.updatePreferences({ genres: genresSel, language, regions: regionsSel });
    setUser(updated);
    setScreen('app');
    loadMovies({ genres: genresSel, language, regions: regionsSel });
    loadFriends();
  };
  const toggleGenre = (g) => setGenresSel((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]));
  const toggleRegion = (r) => setRegionsSel((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));

  const toggleTrailerMute = () => {
    setTrailerMuted((muted) => {
      const next = !muted;
      const win = trailerIframeRef.current?.contentWindow;
      win?.postMessage(JSON.stringify({ event: 'command', func: next ? 'mute' : 'unMute', args: [] }), '*');
      return next;
    });
  };

  const openPaywall = () => setShowPaywall(true);
  const closePaywall = () => setShowPaywall(false);
  const dismissMatch = () => setShowMatch(null);
  const viewInMatches = () => {
    setShowMatch(null);
    setTab('matches');
    const partner = friends.find((f) => f.status === 'partner');
    if (partner) setActiveFriendId(partner.id);
  };

  const sendUsernameInvite = async () => {
    const u = usernameInput.trim().replace(/^@/, '');
    if (!u) return;
    setInviteError(null);
    try {
      await api.inviteFriend(u);
      setSentInvites((s) => [...s, '@' + u]);
      setUsernameInput('');
      loadFriends();
    } catch (err) {
      setInviteError(err.message);
    }
  };
  const contactsSupported = typeof navigator !== 'undefined' && !!navigator.contacts && !!navigator.contacts.select;

  const importContacts = async () => {
    setContactsError(null);
    if (!contactsSupported) {
      setContactsError('Your browser doesn’t support picking device contacts (this API currently only works in Chrome/Edge on Android).');
      return;
    }
    try {
      const picked = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: true });
      setPickedContacts(picked);
      setContactsStatus({});
    } catch (err) {
      if (err.name !== 'AbortError') setContactsError(err.message || 'Could not read contacts.');
    }
  };

  const inviteContact = async (contact, index) => {
    const identifier = contact.email?.[0] || contact.tel?.[0];
    if (!identifier) {
      setContactsStatus((s) => ({ ...s, [index]: { state: 'error', message: 'No email or phone on this contact' } }));
      return;
    }
    try {
      await api.inviteFriend(identifier);
      setContactsStatus((s) => ({ ...s, [index]: { state: 'sent' } }));
      loadFriends();
    } catch (err) {
      setContactsStatus((s) => ({ ...s, [index]: { state: 'error', message: err.message } }));
    }
  };

  const promoteToPartner = async (friendId) => {
    try {
      await api.promotePartner(friendId);
      loadFriends();
    } catch {
      // best-effort; friend list simply won't reflect the change
    }
  };

  const acceptInvite = async (friendId) => {
    try {
      await api.acceptFriend(friendId);
      loadFriends();
    } catch {
      // best-effort; friend list simply won't reflect the change
    }
  };

  const deleteMatch = async (friendId, movieId) => {
    setFriends((list) => list.map((f) => (
      f.id === friendId ? { ...f, common: f.common.filter((m) => m.id !== movieId) } : f
    )));
    try {
      await api.deleteMatch(friendId, movieId);
    } catch {
      loadFriends();
    }
  };

  const openMovieDetail = (movie) => {
    setMovieDetail(movie);
    setMovieDetailProviders(null);
    setMovieDetailProvidersLoading(true);
    api.getWatchProviders(movie.id, regionsSel)
      .then(setMovieDetailProviders)
      .catch(() => setMovieDetailProviders({ region: null }))
      .finally(() => setMovieDetailProvidersLoading(false));
  };
  const closeMovieDetail = () => setMovieDetail(null);

  // — derived values —
  const superlikesLeft = Math.max(0, SUPERLIKE_LIMIT - superlikesUsed);
  const partnerFriend = friends.find((f) => f.status === 'partner');
  const hasNewMatch = !!partnerFriend && partnerFriend.common.length > 0;
  const activeFriend = friends.find((f) => f.id === activeFriendId) || friends[0];
  const commonMovies = activeFriend ? activeFriend.common : [];
  const chipFriends = friends.filter((f) => f.status !== 'pending');
  const regionsSummary = regionsSel.length > 1 ? `${regionsSel[0]} +${regionsSel.length - 1}` : regionsSel[0];
  const prefsSummary = [genresSel[0], language, regionsSummary].filter(Boolean).join(' · ') || 'Not set';

  let topCard = null;
  let stackCards = [];
  if (deckIndex < movies.length) {
    const m = movies[deckIndex];
    const dominant = Math.abs(dragDx) > Math.abs(dragDy) ? 'h' : 'v';
    let tx = dragDx, ty = dragDy, rot = dragDx / 18, opacity = 1;
    let transition = dragging ? 'none' : 'transform .4s cubic-bezier(.2,.8,.2,1)';
    if (exitDir) {
      transition = 'transform .3s ease-in, opacity .3s ease-in';
      if (exitDir === 'right') { tx = 700; rot = 24; }
      else if (exitDir === 'left') { tx = -700; rot = -24; }
      else if (exitDir === 'up') { ty = -1000; }
      else if (exitDir === 'down') { ty = 1000; }
      opacity = 0;
    }
    topCard = {
      movie: m,
      transformStyle: `translate(${tx}px,${ty}px) rotate(${rot}deg)`,
      transitionStyle: transition,
      opacity,
      showTrailer: trailerPlaying && !exitDir,
      trailerKey: !exitDir ? trailerKey : null,
      providers: !exitDir ? providers : null,
      providersLoading: !exitDir && providersLoading,
      likeOpacity: !exitDir && dominant === 'h' ? clamp(dragDx / 110, 0, 1) : (exitDir === 'right' ? 1 : 0),
      maybeOpacity: !exitDir && dominant === 'h' ? clamp(-dragDx / 110, 0, 1) : (exitDir === 'left' ? 1 : 0),
      superOpacity: !exitDir && dominant === 'v' ? clamp(-dragDy / 110, 0, 1) : (exitDir === 'up' ? 1 : 0),
      nopeOpacity: !exitDir && dominant === 'v' ? clamp(dragDy / 110, 0, 1) : (exitDir === 'down' ? 1 : 0),
    };
    stackCards = movies.slice(deckIndex + 1, deckIndex + 3).map((mv, i) => ({
      movie: mv,
      transform: i === 0 ? 'translateY(14px) scale(0.96)' : 'translateY(26px) scale(0.92)',
      z: i === 0 ? 9 : 8,
    }));
  }

  const tabColor = (t) => (tab === t ? 'var(--color-accent)' : 'var(--color-neutral-500)');

  if (restoring) return <div className="app-page"><PhoneFrame /></div>;

  return (
    <div className="app-page">
      <PhoneFrame>
        {screen === 'login' && (
          <LoginScreen
            authMode={authMode} setAuthMode={setAuthMode}
            authForm={authForm} setAuthForm={setAuthForm}
            authError={authError} authBusy={authBusy}
            submitAuth={submitAuth}
          />
        )}

        {screen === 'onboarding' && (
          <OnboardingScreen
            genresSel={genresSel} toggleGenre={toggleGenre}
            language={language} setLanguage={setLanguage}
            regionsSel={regionsSel} toggleRegion={toggleRegion}
            finishOnboarding={finishOnboarding}
          />
        )}

        {screen === 'app' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {tab === 'home' && (
                <DiscoverScreen
                  topCard={topCard} stackCards={stackCards} moviesLoading={moviesLoading}
                  startDrag={startDrag}
                  undoSwipe={undoSwipe} undoDisabled={history.length === 0}
                  resetDeck={resetDeck}
                  swipeLike={swipeLike} swipeMaybe={swipeMaybe} swipeDiscard={swipeDiscard} swipeSuper={swipeSuper}
                  descExpanded={descExpanded} toggleDesc={() => setDescExpanded((v) => !v)}
                  trailerMuted={trailerMuted} toggleTrailerMute={toggleTrailerMute} trailerIframeRef={trailerIframeRef}
                  sortMode={sortMode} changeSortMode={changeSortMode}
                />
              )}
              {tab === 'matches' && (
                <MatchesScreen
                  friendChips={chipFriends}
                  activeFriendId={activeFriendId} setActiveFriendId={setActiveFriendId}
                  activeFriend={activeFriend} commonMovies={commonMovies}
                  onSelectMovie={openMovieDetail}
                  onDeleteMatch={deleteMatch}
                  friendSuperlikes={friendSuperlikes} friendSuperlikesLoading={friendSuperlikesLoading}
                />
              )}
              {tab === 'friends' && (
                <FriendsScreen
                  usernameInput={usernameInput} onUsernameChange={(e) => setUsernameInput(e.target.value)}
                  sendUsernameInvite={sendUsernameInvite} sentInvites={sentInvites} inviteError={inviteError}
                  contactsSupported={contactsSupported} importContacts={importContacts}
                  pickedContacts={pickedContacts} contactsStatus={contactsStatus} contactsError={contactsError}
                  inviteContact={inviteContact}
                  friends={friends}
                  onSelectFriend={(id) => { setActiveFriendId(id); setTab('matches'); }}
                  promoteToPartner={promoteToPartner}
                  acceptInvite={acceptInvite}
                />
              )}
              {tab === 'profile' && (
                <ProfileScreen
                  user={user}
                  superlikesLeft={superlikesLeft} superlikeLimit={SUPERLIKE_LIMIT}
                  openPaywall={openPaywall} prefsSummary={prefsSummary}
                  goToOnboarding={goToOnboarding} goToLogin={goToLogin}
                />
              )}
            </div>

            <TabBar
              tab={tab} setTab={setTab} tabColor={tabColor} hasNewMatch={hasNewMatch}
            />
          </div>
        )}

        {showMatch && MATCH_CELEBRATION === 'full-screen' && (
          <MatchModalFull movie={showMatch} partnerName={partnerFriend?.username} viewInMatches={viewInMatches} dismissMatch={dismissMatch} />
        )}
        {showMatch && MATCH_CELEBRATION === 'toast' && (
          <MatchModalToast movie={showMatch} partnerName={partnerFriend?.username} viewInMatches={viewInMatches} dismissMatch={dismissMatch} />
        )}
        {showPaywall && (
          <PaywallModal superlikeLimit={SUPERLIKE_LIMIT} closePaywall={closePaywall} />
        )}
        {movieDetail && (
          <MovieDetailModal movie={movieDetail} providers={movieDetailProviders} providersLoading={movieDetailProvidersLoading} onClose={closeMovieDetail} />
        )}
      </PhoneFrame>
    </div>
  );
}

function LoginScreen({ authMode, setAuthMode, authForm, setAuthForm, authError, authBusy, submitAuth }) {
  const isSignup = authMode === 'signup';
  const setField = (field) => (e) => setAuthForm((f) => ({ ...f, [field]: e.target.value }));
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '120px 28px 40px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        <div style={{ font: '800 15px/1 var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>MatchCut</div>
        <h1 style={{ margin: '18px 0 0', font: '800 40px/1.05 var(--font-heading)', color: 'var(--color-text)' }}>Swipe movies.<br />Match with your person.</h1>
        <p style={{ margin: '16px 0 0', font: '400 15px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>Swipe through new releases together. When you both like the same title, we'll tell you.</p>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); submitAuth(); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" placeholder="you@example.com" value={authForm.email} onChange={setField('email')} required />
        </div>
        {isSignup && (
          <div className="field">
            <label>Username</label>
            <input className="input" type="text" placeholder="yourname" value={authForm.username} onChange={setField('username')} required />
          </div>
        )}
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" placeholder="••••••••" value={authForm.password} onChange={setField('password')} required minLength={6} />
        </div>
        {authError && <div style={{ font: '600 12px var(--font-body)', color: '#c0392b' }}>{authError}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={authBusy}>
          {authBusy ? 'Please wait…' : isSignup ? 'Create account' : 'Continue'}
        </button>
        <div style={{ textAlign: 'left', font: '400 13px/1.4 var(--font-body)', color: 'var(--color-neutral-700)' }}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode(isSignup ? 'login' : 'signup'); }} style={{ color: 'var(--color-accent-700)' }}>
            {isSignup ? 'Log in' : 'Sign up'}
          </a>
        </div>
      </form>
    </div>
  );
}

function OnboardingScreen({ genresSel, toggleGenre, language, setLanguage, regionsSel, toggleRegion, finishOnboarding }) {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '64px 24px 28px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div style={{ font: '800 22px/1.2 var(--font-heading)', color: 'var(--color-text)' }}>Set up your feed</div>
      <p style={{ margin: '6px 0 22px', font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>Pick what you're into. You can change this anytime in Profile.</p>

      <SectionLabel>Genres</SectionLabel>
      <ChipRow>
        {GENRES.map((g) => (
          <button key={g} style={chipStyle(genresSel.includes(g))} onClick={() => toggleGenre(g)}>{g}</button>
        ))}
      </ChipRow>

      <SectionLabel>Language</SectionLabel>
      <ChipRow>
        {LANGUAGES.map((l) => (
          <button key={l} style={chipStyle(language === l)} onClick={() => setLanguage(l)}>{l}</button>
        ))}
      </ChipRow>

      <SectionLabel>Region</SectionLabel>
      <ChipRow last>
        {REGIONS.map((r) => (
          <button key={r} style={chipStyle(regionsSel.includes(r))} onClick={() => toggleRegion(r)}>{r}</button>
        ))}
      </ChipRow>

      <button className="btn btn-primary btn-block" disabled={genresSel.length === 0} onClick={finishOnboarding} style={{ marginTop: 'auto' }}>Start swiping</button>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ font: '700 12px/1 var(--font-heading)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 10 }}>{children}</div>;
}
function ChipRow({ children, last }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: last ? 28 : 24 }}>{children}</div>;
}

const SORT_MODE_LABELS = { foryou: 'For You', upcoming: 'Upcoming', latest: 'Latest', toprated: 'Top Rated' };

function DiscoverScreen({ topCard, stackCards, moviesLoading, startDrag, undoSwipe, undoDisabled, resetDeck, swipeLike, swipeMaybe, swipeDiscard, swipeSuper, descExpanded, toggleDesc, trailerMuted, toggleTrailerMute, trailerIframeRef, sortMode, changeSortMode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '14px 12px 8px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {Object.keys(SORT_MODE_LABELS).map((mode) => (
            <button key={mode} style={{ ...chipStyle(sortMode === mode), padding: '5px 10px', font: '600 10.5px var(--font-body)', flex: 'none' }} onClick={() => changeSortMode(mode)}>
              {SORT_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <button onClick={undoSwipe} disabled={undoDisabled} style={{ border: '2px solid var(--color-divider)', background: 'transparent', width: 30, height: 30, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: undoDisabled ? 0.35 : 1, borderRadius: '50%' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 3-6.7M3 12V5m0 7h7" stroke="var(--color-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {topCard ? (
          <>
            {stackCards.map((sc) => (
              <div key={sc.movie.id} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--color-neutral-300)', transform: sc.transform, zIndex: sc.z, boxShadow: 'var(--shadow-sm)', borderRadius: 22 }}>
                <Poster id={sc.movie.id} src={sc.movie.posterUrl} />
              </div>
            ))}

            <div
              style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#111', zIndex: 10, boxShadow: 'var(--shadow-lg)', transform: topCard.transformStyle, transition: topCard.transitionStyle, opacity: topCard.opacity, touchAction: 'none', cursor: 'grab', borderRadius: 22 }}
              onMouseDown={startDrag}
              onTouchStart={startDrag}
            >
              <div style={{ position: 'absolute', inset: 0, animation: 'kenburns 9s ease-in-out infinite alternate' }}>
                <Poster id={topCard.movie.id} src={topCard.movie.posterUrl} />
              </div>

              {topCard.showTrailer && topCard.trailerKey && (
                <iframe
                  ref={trailerIframeRef}
                  title="Trailer"
                  src={`https://www.youtube.com/embed/${topCard.trailerKey}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&loop=1&playlist=${topCard.trailerKey}&enablejsapi=1`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  onLoad={(e) => {
                    // Some mobile browsers ignore the autoplay/mute URL params
                    // once embedded — reinforce via the player postMessage API
                    // once the player has had time to initialize.
                    const win = e.currentTarget.contentWindow;
                    const nudge = () => {
                      win?.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
                      win?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
                    };
                    nudge();
                    setTimeout(nudge, 400);
                    setTimeout(nudge, 1200);
                  }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
                />
              )}

              <SwipeStamp label="LIKE" color="#3ddc84" opacity={topCard.likeOpacity} rotate={-14} />
              <SwipeStamp label="MAYBE" color="#ffc93c" opacity={topCard.maybeOpacity} rotate={14} />
              <SwipeStamp label="SUPER LIKE" color="#4da6ff" opacity={topCard.superOpacity} rotate={0} />
              <SwipeStamp label="DISCARD" color="#ff5252" opacity={topCard.nopeOpacity} rotate={0} />

              {topCard.showTrailer && (
                <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(0,0,0,.55)', padding: '6px 8px 6px 12px', border: '1px solid rgba(255,255,255,.4)', borderRadius: 20 }}>
                  <span style={{ width: 7, height: 7, background: 'var(--color-accent)', borderRadius: '50%', animation: 'pulseDot 1.4s ease-out infinite' }} />
                  <span style={{ font: '700 11px var(--font-body)', letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff' }}>Playing trailer</span>
                  <button
                    onClick={toggleTrailerMute}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    aria-label={trailerMuted ? 'Unmute trailer' : 'Mute trailer'}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, marginLeft: 2, background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', cursor: 'pointer', flex: 'none' }}
                  >
                    {trailerMuted ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 5 6 9H2v6h4l5 4V5z" fill="#fff" /><path d="M16 9l6 6M22 9l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 5 6 9H2v6h4l5 4V5z" fill="#fff" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
                    )}
                  </button>
                </div>
              )}

              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 18px 22px', background: 'linear-gradient(to top, rgba(0,0,0,.92), rgba(0,0,0,.55) 55%, rgba(0,0,0,0))' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ font: '800 24px var(--font-heading)', color: '#fff' }}>{topCard.movie.title}</span>
                  <span style={{ font: '700 13px var(--font-body)', color: 'var(--color-accent)' }}>★ {topCard.movie.rating}</span>
                </div>
                {topCard.movie.desc && (
                  <div style={{ margin: '6px 0 8px' }}>
                    <div
                      style={{
                        font: '400 12.5px/1.4 var(--font-body)', color: 'rgba(255,255,255,.85)',
                        display: '-webkit-box',
                        WebkitLineClamp: descExpanded ? 'unset' : 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: descExpanded ? 'visible' : 'hidden',
                      }}
                    >
                      {topCard.movie.desc}
                    </div>
                    {topCard.movie.desc.length > 90 && (
                      <button
                        onClick={toggleDesc}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        style={{ background: 'none', border: 'none', padding: 0, marginTop: 2, font: '700 11.5px var(--font-body)', color: 'var(--color-accent)', cursor: 'pointer' }}
                      >
                        {descExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {topCard.movie.genres.map((g) => (
                    <span key={g} style={{ font: '600 10.5px var(--font-body)', letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff', border: '1px solid rgba(255,255,255,.5)', padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0 }}>{g}</span>
                  ))}
                </div>
                <WatchProviders providersLoading={topCard.providersLoading} providers={topCard.providers} movieTitle={topCard.movie.title} />
              </div>
            </div>
          </>
        ) : moviesLoading ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 30px', gap: 14 }}>
            <div style={{ font: '800 20px var(--font-heading)', color: 'var(--color-text)' }}>Finding movies for you…</div>
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 30px', gap: 14 }}>
            <div style={{ font: '800 20px var(--font-heading)', color: 'var(--color-text)' }}>You're all caught up</div>
            <div style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>New releases matching your filters land tomorrow.</div>
            <button className="btn btn-secondary" onClick={resetDeck}>Review again</button>
          </div>
        )}
      </div>

      {topCard && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, paddingTop: 10 }}>
          <button onClick={swipeMaybe} style={{ width: 44, height: 44, border: '2px solid var(--color-neutral-500)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M19 12H5m0 0l6 6m-6-6l6-6" stroke="var(--color-neutral-700)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={swipeDiscard} style={{ width: 44, height: 44, border: '2px solid var(--color-text)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="var(--color-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={swipeSuper} style={{ width: 44, height: 44, border: 'none', background: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.9 6.6L22 9.3l-5.2 4.8L18.2 21 12 17.3 5.8 21l1.4-6.9L2 9.3l7.1-.7L12 2z" fill="#fff" /></svg>
          </button>
          <button onClick={swipeLike} style={{ width: 44, height: 44, border: 'none', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 21s-7.5-4.6-10-9.1C.5 8.1 2.3 4.5 6 4c2.1-.3 4 1 6 3.3C14 5 15.9 3.7 18 4c3.7.5 5.5 4.1 4 7.9C19.5 16.4 12 21 12 21z" fill="#fff" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function SwipeStamp({ label, color, opacity, rotate = 0 }) {
  return (
    <div
      style={{
        position: 'absolute', top: '50%', left: '50%', zIndex: 5, pointerEvents: 'none',
        transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
        font: '900 32px var(--font-heading)', letterSpacing: '.05em',
        color, background: 'rgba(0,0,0,.35)', padding: '10px 22px',
        border: `4px solid ${color}`, borderRadius: 14,
        textShadow: '0 2px 8px rgba(0,0,0,.5)', whiteSpace: 'nowrap',
        opacity,
      }}
    >
      {label}
    </div>
  );
}

function WatchProviders({ providersLoading, providers, movieTitle }) {
  if (providersLoading) {
    return <div style={{ marginTop: 8, font: '400 11px var(--font-body)', color: 'rgba(255,255,255,.6)' }}>Checking where to watch…</div>;
  }
  if (!providers || !providers.region) {
    const query = encodeURIComponent(`where to watch ${movieTitle}`);
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ font: '400 11px var(--font-body)', color: 'rgba(255,255,255,.55)', marginBottom: 4 }}>No streaming info available in your region yet.</div>
        <a href={`https://www.google.com/search?q=${query}`} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} style={{ font: '600 11px var(--font-body)', color: 'var(--color-accent)' }}>
          Search Google →
        </a>
      </div>
    );
  }
  const hasAny = providers.flatrate?.length || providers.rent?.length || providers.buy?.length;
  return (
    <div style={{ marginTop: 8 }}>
      <ProviderRow label="Stream" items={providers.flatrate} movieTitle={movieTitle} />
      <ProviderRow label="Rent" items={providers.rent} movieTitle={movieTitle} />
      <ProviderRow label="Buy" items={providers.buy} movieTitle={movieTitle} />
      {!hasAny && providers.link && (
        <a href={providers.link} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} style={{ font: '600 11px var(--font-body)', color: 'var(--color-accent)' }}>
          See where to watch →
        </a>
      )}
      {hasAny && (
        <div style={{ font: '400 9px var(--font-body)', color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Streaming data provided by JustWatch</div>
      )}
    </div>
  );
}

// TMDB's provider_name strings vary by region ("Amazon Prime Video" vs
// "Prime Video", "HBO Max" vs "Max", etc.), so these match loosely and fall
// through to a Google search (which still lands on the right app via
// universal links on most phones) for anything unrecognized.
const PROVIDER_URL_BUILDERS = [
  { match: /netflix/i, url: (t) => `https://www.netflix.com/search?q=${encodeURIComponent(t)}` },
  { match: /prime video/i, url: (t) => `https://www.primevideo.com/search?phrase=${encodeURIComponent(t)}` },
  { match: /disney/i, url: (t) => `https://www.disneyplus.com/search?q=${encodeURIComponent(t)}` },
  { match: /hulu/i, url: (t) => `https://www.hulu.com/search?q=${encodeURIComponent(t)}` },
  { match: /apple tv/i, url: (t) => `https://tv.apple.com/search?term=${encodeURIComponent(t)}` },
  { match: /\bmax\b|hbo/i, url: (t) => `https://play.max.com/search?q=${encodeURIComponent(t)}` },
  { match: /paramount/i, url: (t) => `https://www.paramountplus.com/search/?query=${encodeURIComponent(t)}` },
  { match: /peacock/i, url: (t) => `https://www.peacocktv.com/search?q=${encodeURIComponent(t)}` },
  { match: /youtube/i, url: (t) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t} movie`)}` },
  { match: /google play|google tv/i, url: (t) => `https://play.google.com/store/search?q=${encodeURIComponent(t)}&c=movies` },
  { match: /hotstar/i, url: (t) => `https://www.hotstar.com/in/search?q=${encodeURIComponent(t)}` },
  { match: /jiocinema/i, url: (t) => `https://www.jiocinema.com/search/${encodeURIComponent(t)}` },
  { match: /zee5/i, url: (t) => `https://www.zee5.com/search?q=${encodeURIComponent(t)}` },
  { match: /sonyliv/i, url: (t) => `https://www.sonyliv.com/search?q=${encodeURIComponent(t)}` },
  { match: /mubi/i, url: (t) => `https://mubi.com/search/films?query=${encodeURIComponent(t)}` },
  { match: /crunchyroll/i, url: (t) => `https://www.crunchyroll.com/search?q=${encodeURIComponent(t)}` },
];

function providerLinkFor(name, title) {
  const builder = PROVIDER_URL_BUILDERS.find((b) => b.match.test(name));
  if (builder) return builder.url(title);
  return `https://www.google.com/search?q=${encodeURIComponent(`watch ${title} on ${name}`)}`;
}

function ProviderRow({ label, items, movieTitle }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ font: '700 9px var(--font-body)', color: 'rgba(255,255,255,.7)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', minWidth: 42, flex: 'none' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {items.slice(0, 6).map((p) => (
          <a
            key={p.id}
            href={providerLinkFor(p.name, movieTitle)}
            target="_blank"
            rel="noreferrer"
            title={p.name}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ flex: 'none', display: 'block' }}
          >
            {p.logoPath ? (
              <img src={p.logoPath} alt={p.name} style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', display: 'block' }} />
            ) : (
              <span style={{ font: '600 9px var(--font-body)', color: '#fff', background: 'rgba(255,255,255,.15)', padding: '4px 6px', borderRadius: 6, display: 'block' }}>{p.name}</span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function MatchesScreen({ friendChips, activeFriendId, setActiveFriendId, activeFriend, commonMovies, onSelectMovie, onDeleteMatch, friendSuperlikes, friendSuperlikesLoading }) {
  const commonCountText = commonMovies.length ? `${commonMovies.length} movie${commonMovies.length > 1 ? 's' : ''} in common` : 'No overlap yet';
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '18px 18px 12px', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)', marginBottom: 14 }}>Matches</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingBottom: 14, marginBottom: 14, borderBottom: '2px solid var(--color-divider)' }}>
        {friendChips.map((f) => (
          <button key={f.id} onClick={() => setActiveFriendId(f.id)} style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 52, height: 52, background: avatarBgFor(String(f.id)), display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 16px var(--font-heading)', color: '#fff', border: f.id === activeFriendId ? '3px solid var(--color-accent)' : '3px solid transparent', borderRadius: '50%', overflow: 'hidden' }}>
              <Avatar id={f.id} size={52} radius={9999} />
            </div>
            <span style={{ font: '600 10.5px var(--font-body)', color: 'var(--color-text)' }}>{f.username}</span>
          </button>
        ))}
      </div>

      {activeFriend && (
        <>
          <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 8 }}>{activeFriend.username}'s Super Likes</div>
          {friendSuperlikesLoading ? (
            <div style={{ font: '400 12.5px var(--font-body)', color: 'var(--color-neutral-700)', marginBottom: 16 }}>Loading…</div>
          ) : friendSuperlikes.length > 0 ? (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, marginBottom: 18 }}>
              {friendSuperlikes.map((m) => (
                <button key={m.id} onClick={() => onSelectMovie(m)} style={{ flex: 'none', width: 84, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  <div style={{ width: 84, height: 120, background: 'var(--color-neutral-300)', overflow: 'hidden', borderRadius: 12, position: 'relative', marginBottom: 6 }}>
                    <Poster id={m.id} src={m.posterUrl} radius={12} />
                  </div>
                  <span style={{ display: 'block', font: '700 11.5px/1.3 var(--font-body)', color: 'var(--color-text)' }}>{m.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ font: '400 12.5px var(--font-body)', color: 'var(--color-neutral-700)', marginBottom: 18 }}>No super likes yet.</div>
          )}

          <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 4 }}>You &amp; {activeFriend.username}</div>
          <div style={{ font: '400 12.5px var(--font-body)', color: 'var(--color-neutral-700)', marginBottom: 16 }}>{commonCountText}</div>
        </>
      )}

      {commonMovies.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {commonMovies.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 0', borderBottom: '1px solid var(--color-divider)' }}>
              <button onClick={() => onSelectMovie(m)} style={{ display: 'flex', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0, padding: 0 }}>
                <div style={{ width: 56, height: 80, flex: 'none', background: 'var(--color-neutral-300)', overflow: 'hidden', borderRadius: 12, position: 'relative' }}>
                  <Poster id={m.id} src={m.posterUrl} radius={12} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center', minWidth: 0 }}>
                  <span className="tag tag-accent" style={{ alignSelf: 'flex-start', font: '700 9.5px var(--font-body)' }}>You both liked</span>
                  <span style={{ font: '800 15px var(--font-heading)', color: 'var(--color-text)' }}>{m.title}</span>
                  <span style={{ font: '400 12px var(--font-body)', color: 'var(--color-neutral-700)' }}>★ {m.rating} · {(m.genres || []).join(' · ')}</span>
                </div>
              </button>
              <button
                onClick={() => onDeleteMatch(activeFriend.id, m.id)}
                aria-label="Remove match"
                style={{ flex: 'none', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--color-neutral-200)', color: 'var(--color-neutral-700)', font: '700 14px var(--font-body)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >✕</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 10px', font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>No shared likes yet — keep swiping, we'll notify you both the moment you match.</div>
      )}
    </div>
  );
}

function FriendsScreen({ usernameInput, onUsernameChange, sendUsernameInvite, sentInvites, inviteError, contactsSupported, importContacts, pickedContacts, contactsStatus, contactsError, inviteContact, friends, onSelectFriend, promoteToPartner, acceptInvite }) {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '18px 18px 12px', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)', marginBottom: 14 }}>Friends</div>

      <div className="field" style={{ marginBottom: 10 }}>
        <label>Add by username</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="text" placeholder="@username" value={usernameInput} onChange={onUsernameChange} style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={sendUsernameInvite} disabled={!usernameInput.trim()}>Add</button>
        </div>
      </div>
      {inviteError && (
        <div style={{ font: '400 12px var(--font-body)', color: '#c0392b', marginBottom: 18 }}>{inviteError}</div>
      )}
      {sentInvites.length > 0 && (
        <div style={{ font: '400 12px var(--font-body)', color: 'var(--color-accent-700)', marginBottom: 18 }}>Invite sent to {sentInvites.join(', ')}</div>
      )}

      <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', margin: '8px 0 10px' }}>From your contacts</div>
      <div style={{ marginBottom: 22 }}>
        <button className="btn btn-secondary" onClick={importContacts} style={{ marginBottom: 10 }}>Choose contacts</button>
        {contactsError && (
          <div style={{ font: '400 12px/1.5 var(--font-body)', color: '#c0392b', marginBottom: 10 }}>{contactsError}</div>
        )}
        {pickedContacts.length === 0 && !contactsError && (
          <div style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>
            {contactsSupported ? "Pick contacts from your device to see who's already on MatchCut." : 'Not supported on this browser/device (works in Chrome/Edge on Android) — add someone by username above instead.'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {pickedContacts.map((contact, i) => {
            const name = contact.name?.[0] || contact.email?.[0] || contact.tel?.[0] || 'Unknown';
            const status = contactsStatus[i];
            const sent = status?.state === 'sent';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-divider)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 34, height: 34, background: 'var(--color-neutral-300)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 12px var(--font-heading)', color: 'var(--color-text)', borderRadius: '50%', flex: 'none' }}>{initials(name)}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ font: '600 13.5px var(--font-body)', color: 'var(--color-text)' }}>{name}</span>
                    {status?.state === 'error' && <span style={{ font: '400 11px var(--font-body)', color: '#c0392b' }}>{status.message}</span>}
                  </div>
                </div>
                <button
                  onClick={() => inviteContact(contact, i)}
                  disabled={sent}
                  style={sent
                    ? { background: 'none', border: '2px solid var(--color-divider)', color: 'var(--color-neutral-700)', padding: '6px 14px', font: '700 11px var(--font-body)', cursor: 'default', borderRadius: 20, flex: 'none' }
                    : { background: 'var(--color-text)', border: 'none', color: '#fff', padding: '6px 14px', font: '700 11px var(--font-body)', cursor: 'pointer', borderRadius: 20, flex: 'none' }}
                >{sent ? 'Invited' : 'Invite'}</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', margin: '8px 0 10px' }}>Your connections</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {friends.length === 0 && (
          <div style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)', padding: '10px 0' }}>No connections yet — invite someone by username above.</div>
        )}
        {friends.map((fr) => {
          const tagClass = fr.status === 'partner' ? 'tag-accent' : fr.status === 'pending' ? 'tag-outline' : 'tag-neutral';
          const statusLabel = fr.status === 'partner' ? 'Partner' : fr.status === 'pending' ? 'Pending' : 'Connected';
          return (
            <div key={fr.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-divider)' }}>
              <button onClick={() => onSelectFriend(fr.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, flex: 1, minWidth: 0 }}>
                <div style={{ width: 38, height: 38, background: avatarBgFor(String(fr.id)), display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px var(--font-heading)', color: '#fff', borderRadius: '50%', overflow: 'hidden', flex: 'none' }}>
                  <Avatar id={fr.id} size={38} radius={9999} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ font: '700 14px var(--font-body)', color: 'var(--color-text)' }}>{fr.username}</span>
                  <span style={{ font: '400 11.5px var(--font-body)', color: 'var(--color-neutral-700)' }}>{fr.email}</span>
                </div>
              </button>
              {fr.status === 'connected' ? (
                <button
                  onClick={() => promoteToPartner(fr.id)}
                  style={{ background: 'none', border: '2px solid var(--color-accent)', color: 'var(--color-accent-700)', padding: '6px 12px', font: '700 10.5px var(--font-body)', cursor: 'pointer', borderRadius: 20, flex: 'none', marginLeft: 8, whiteSpace: 'nowrap' }}
                >
                  Make partner
                </button>
              ) : fr.status === 'pending' ? (
                <button
                  onClick={() => acceptInvite(fr.id)}
                  style={{ background: 'var(--color-accent)', border: 'none', color: '#fff', padding: '6px 12px', font: '700 10.5px var(--font-body)', cursor: 'pointer', borderRadius: 20, flex: 'none', marginLeft: 8, whiteSpace: 'nowrap' }}
                >
                  Accept
                </button>
              ) : (
                <span className={`tag ${tagClass}`} style={{ font: '700 9.5px var(--font-body)', flex: 'none', marginLeft: 8 }}>{statusLabel}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfileScreen({ user, superlikesLeft, superlikeLimit, openPaywall, prefsSummary, goToOnboarding, goToLogin }) {
  const isFounder = user?.role === 'founder';
  const pct = Math.round((superlikesLeft / superlikeLimit) * 100);
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '18px 18px 12px', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)', marginBottom: 18 }}>Profile</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div style={{ width: 64, height: 64, flex: 'none', background: 'var(--color-neutral-300)', overflow: 'hidden', borderRadius: 16, position: 'relative' }}>
          <Avatar id={user?.username || 'you'} size={64} radius={16} />
        </div>
        <div>
          <div style={{ font: '800 17px var(--font-heading)', color: 'var(--color-text)' }}>{user?.username}</div>
          <div style={{ font: '400 12.5px var(--font-body)', color: 'var(--color-neutral-700)' }}>{user?.email}</div>
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 22, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isFounder ? 0 : 8 }}>
          <span className="card-kicker">Superlikes</span>
          <span style={{ font: '800 13px var(--font-body)', color: 'var(--color-text)' }}>
            {isFounder ? 'Unlimited (Founder)' : `${superlikesLeft} / ${superlikeLimit} left this week`}
          </span>
        </div>
        {!isFounder && (
          <>
            <div style={{ height: 6, background: 'var(--color-neutral-200)', marginBottom: 12, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--color-accent)', width: `${pct}%`, borderRadius: 4 }} />
            </div>
            <button className="btn btn-primary btn-block" onClick={openPaywall}>Get unlimited superlikes</button>
          </>
        )}
      </div>

      <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 8 }}>Preferences</div>
      <button onClick={goToOnboarding} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--color-divider)', background: 'none', border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--color-divider)', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ font: '600 14px var(--font-body)', color: 'var(--color-text)' }}>Genres, language &amp; region</span>
        <span style={{ font: '400 12px var(--font-body)', color: 'var(--color-neutral-700)' }}>{prefsSummary}</span>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--color-divider)' }}>
        <span style={{ font: '600 14px var(--font-body)', color: 'var(--color-text)' }}>Notifications</span>
        <span style={{ font: '400 12px var(--font-body)', color: 'var(--color-neutral-700)' }}>On</span>
      </div>
      <button onClick={goToLogin} className="btn btn-ghost" style={{ marginTop: 22, width: '100%' }}>Log out</button>
    </div>
  );
}

function TabBar({ tab, setTab, tabColor, hasNewMatch }) {
  return (
    <div style={{ display: 'flex', borderTop: '2px solid var(--color-divider)', background: 'var(--color-bg)', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => setTab('home')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="14" height="10" stroke={tabColor('home')} strokeWidth="2" /><rect x="7" y="4" width="14" height="10" stroke={tabColor('home')} strokeWidth="2" fill="var(--color-bg)" /></svg>
        <span style={{ font: '700 9.5px var(--font-body)', color: tabColor('home') }}>Discover</span>
      </button>
      <button onClick={() => setTab('matches')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 8, background: 'none', border: 'none', cursor: 'pointer', position: 'relative' }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 20s-7-4.3-9.3-8.5C1 8 2.6 4.8 6 4.4c2-.2 3.7 1 6 3.1 2.3-2.1 4-3.3 6-3.1 3.4.4 5 3.6 3.3 7.1C19 15.7 12 20 12 20z" stroke={tabColor('matches')} strokeWidth="2" /></svg>
        <span style={{ font: '700 9.5px var(--font-body)', color: tabColor('matches') }}>Matches</span>
        {hasNewMatch && <span style={{ position: 'absolute', top: 5, right: 24, width: 8, height: 8, background: 'var(--color-accent)', borderRadius: '50%' }} />}
      </button>
      <button onClick={() => setTab('friends')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}>
        <svg width="20" height="19" viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="8" r="3.2" stroke={tabColor('friends')} strokeWidth="2" /><circle cx="16" cy="9" r="2.6" stroke={tabColor('friends')} strokeWidth="2" /><path d="M2.5 19c.6-3.3 3-5 6-5s5.4 1.7 6 5" stroke={tabColor('friends')} strokeWidth="2" strokeLinecap="round" /><path d="M15 14.3c2.3.2 4 1.7 4.5 4.7" stroke={tabColor('friends')} strokeWidth="2" strokeLinecap="round" /></svg>
        <span style={{ font: '700 9.5px var(--font-body)', color: tabColor('friends') }}>Friends</span>
      </button>
      <button onClick={() => setTab('profile')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}>
        <svg width="17" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7" r="4" stroke={tabColor('profile')} strokeWidth="2" /><path d="M4 20c1-4.4 4-6.5 8-6.5s7 2.1 8 6.5" stroke={tabColor('profile')} strokeWidth="2" strokeLinecap="round" /></svg>
        <span style={{ font: '700 9.5px var(--font-body)', color: tabColor('profile') }}>Profile</span>
      </button>
    </div>
  );
}

function MatchModalFull({ movie, partnerName, viewInMatches, dismissMatch }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--color-accent)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 36, boxSizing: 'border-box', textAlign: 'center' }}>
      <div style={{ font: '800 14px var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: '#fff', marginBottom: 10 }}>You matched</div>
      <div style={{ font: '800 34px/1.1 var(--font-heading)', color: '#fff', marginBottom: 22 }}>Both liked<br />{movie.title}</div>
      <div style={{ display: 'flex', marginBottom: 20 }}>
        <div style={{ width: 88, height: 120, background: 'var(--color-neutral-300)', border: '3px solid #fff', overflow: 'hidden', transform: 'rotate(-6deg)', borderRadius: 14, position: 'relative' }}>
          <Poster id={movie.id} src={movie.posterUrl} radius={11} />
        </div>
        <div style={{ width: 60, height: 60, background: '#fff', color: 'var(--color-accent-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 18px var(--font-heading)', marginLeft: -16, marginTop: 30, border: '3px solid var(--color-accent)', borderRadius: '50%' }}>{initials(partnerName || '??')}</div>
      </div>
      <div style={{ font: '400 13.5px/1.5 var(--font-body)', color: 'rgba(255,255,255,.9)', marginBottom: 26 }}>You and {partnerName || 'your partner'} both liked this one. It's now in your shared Matches.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <button onClick={viewInMatches} style={{ background: '#fff', color: 'var(--color-accent-700)', border: 'none', padding: 14, font: '700 14px var(--font-body)', cursor: 'pointer', borderRadius: 14 }}>View in Matches</button>
        <button onClick={dismissMatch} style={{ background: 'transparent', color: '#fff', border: '2px solid #fff', padding: 12, font: '700 14px var(--font-body)', cursor: 'pointer', borderRadius: 14 }}>Keep swiping</button>
      </div>
    </div>
  );
}

function MatchModalToast({ movie, partnerName, viewInMatches, dismissMatch }) {
  useEffect(() => {
    const t = setTimeout(dismissMatch, 4000);
    return () => clearTimeout(t);
  }, [movie, dismissMatch]);
  return (
    <div style={{ position: 'absolute', left: 14, right: 14, bottom: 104, zIndex: 100, background: 'var(--color-text)', color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, animation: 'toastIn .35s ease-out', boxShadow: 'var(--shadow-lg)', borderRadius: 16 }}>
      <div style={{ width: 12, height: 12, background: 'var(--color-accent)', flex: 'none', borderRadius: '50%' }} />
      <div style={{ flex: 1, font: '600 12.5px/1.4 var(--font-body)' }}>You &amp; {partnerName || 'your partner'} both liked <strong>{movie.title}</strong></div>
      <button onClick={viewInMatches} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', font: '700 12px var(--font-body)', cursor: 'pointer', flex: 'none' }}>VIEW</button>
    </div>
  );
}

function MovieDetailModal({ movie, providers, providersLoading, onClose }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '86%', overflow: 'auto', background: 'var(--color-bg)', borderRadius: '24px 24px 0 0', boxSizing: 'border-box', padding: '18px 20px 28px' }}
      >
        <div style={{ width: 40, height: 4, background: 'var(--color-divider)', margin: '0 auto 16px', borderRadius: 4 }} />
        <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
          <div style={{ width: 92, height: 132, flex: 'none', background: 'var(--color-neutral-300)', overflow: 'hidden', borderRadius: 14, position: 'relative' }}>
            <Poster id={movie.id} src={movie.posterUrl} radius={14} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
            <span style={{ font: '800 19px/1.2 var(--font-heading)', color: 'var(--color-text)' }}>{movie.title}</span>
            <span style={{ font: '700 13px var(--font-body)', color: 'var(--color-accent-700)', marginTop: 4 }}>★ {movie.rating}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {(movie.genres || []).map((g) => (
                <span key={g} className="tag tag-neutral" style={{ font: '700 9px var(--font-body)' }}>{g}</span>
              ))}
            </div>
          </div>
        </div>
        {movie.desc && (
          <div style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-text)', marginBottom: 16 }}>{movie.desc}</div>
        )}
        <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 8 }}>Where to watch</div>
        {providersLoading ? (
          <div style={{ font: '400 12px var(--font-body)', color: 'var(--color-neutral-700)' }}>Checking where to watch…</div>
        ) : !providers || !providers.region ? (
          <div>
            <div style={{ font: '400 12px var(--font-body)', color: 'var(--color-neutral-700)', marginBottom: 6 }}>No streaming info available in your region yet.</div>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(`where to watch ${movie.title}`)}`} target="_blank" rel="noreferrer" style={{ font: '600 12px var(--font-body)', color: 'var(--color-accent-700)' }}>Search Google →</a>
          </div>
        ) : (
          <div>
            <DetailProviderRow label="Stream" items={providers.flatrate} movieTitle={movie.title} />
            <DetailProviderRow label="Rent" items={providers.rent} movieTitle={movie.title} />
            <DetailProviderRow label="Buy" items={providers.buy} movieTitle={movie.title} />
            {!(providers.flatrate?.length || providers.rent?.length || providers.buy?.length) && providers.link && (
              <a href={providers.link} target="_blank" rel="noreferrer" style={{ font: '600 12px var(--font-body)', color: 'var(--color-accent-700)' }}>See where to watch →</a>
            )}
          </div>
        )}
        <button className="btn btn-ghost btn-block" onClick={onClose} style={{ marginTop: 20 }}>Close</button>
      </div>
    </div>
  );
}

function DetailProviderRow({ label, items, movieTitle }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ font: '700 10px var(--font-body)', color: 'var(--color-neutral-700)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', minWidth: 44, flex: 'none' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {items.slice(0, 8).map((p) => (
          <a key={p.id} href={providerLinkFor(p.name, movieTitle)} target="_blank" rel="noreferrer" title={p.name} style={{ flex: 'none', display: 'block' }}>
            {p.logoPath ? (
              <img src={p.logoPath} alt={p.name} style={{ width: 26, height: 26, borderRadius: 7, objectFit: 'cover', display: 'block' }} />
            ) : (
              <span style={{ font: '600 10px var(--font-body)', color: 'var(--color-text)', background: 'var(--color-neutral-100)', padding: '5px 8px', borderRadius: 7, display: 'block' }}>{p.name}</span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function PaywallModal({ superlikeLimit, closePaywall }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 110, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-bg)', padding: '26px 22px 32px', boxSizing: 'border-box', borderRadius: '24px 24px 0 0' }}>
        <div style={{ width: 40, height: 4, background: 'var(--color-divider)', margin: '0 auto 20px', borderRadius: 4 }} />
        <div style={{ font: '800 20px var(--font-heading)', color: 'var(--color-text)', marginBottom: 6 }}>0 of {superlikeLimit} superlikes left</div>
        <p style={{ margin: '0 0 18px', font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>Superlikes are forced-notified straight to your friends — use them for movies you really want to watch together. Yours reset next week, or go unlimited now.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', font: '400 13px var(--font-body)', color: 'var(--color-text)' }}><span style={{ color: 'var(--color-accent-700)', fontWeight: 800 }}>✓</span> Unlimited superlikes</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', font: '400 13px var(--font-body)', color: 'var(--color-text)' }}><span style={{ color: 'var(--color-accent-700)', fontWeight: 800 }}>✓</span> See who superliked first</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', font: '400 13px var(--font-body)', color: 'var(--color-text)' }}><span style={{ color: 'var(--color-accent-700)', fontWeight: 800 }}>✓</span> Priority in shared queues</div>
        </div>
        <button className="btn btn-primary btn-block" onClick={closePaywall} style={{ marginBottom: 10 }}>Upgrade — $4.99/mo</button>
        <button className="btn btn-ghost btn-block" onClick={closePaywall}>Maybe later</button>
      </div>
    </div>
  );
}
