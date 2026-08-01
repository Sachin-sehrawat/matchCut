import { useEffect, useRef, useState } from 'react';
import PhoneFrame from './components/PhoneFrame.jsx';
import Poster, { Avatar } from './components/Poster.jsx';
import { GENRES, LANGUAGES, REGIONS, FALLBACK_MOVIES, FRIENDS, CONTACTS, clamp, initials, avatarBgFor } from './data.js';
import { fetchMovies, simpleHash } from './tmdb.js';

const SUPERLIKE_LIMIT = 5;
const TRAILER_DELAY_MS = 3000;
const MATCH_CELEBRATION = 'full-screen'; // 'full-screen' | 'toast'

const chipStyle = (selected) => selected
  ? { background: 'var(--color-accent)', color: '#fff', padding: '8px 14px', cursor: 'pointer', border: 'none', font: '600 12px var(--font-body)' }
  : { background: 'transparent', color: 'var(--color-text)', border: '2px solid var(--color-divider)', padding: '6px 12px', cursor: 'pointer', font: '600 12px var(--font-body)' };

export default function App() {
  const [screen, setScreen] = useState('login'); // login | onboarding | app
  const [tab, setTab] = useState('home'); // home | matches | friends | profile

  const [loginInput, setLoginInput] = useState('');
  const [genresSel, setGenresSel] = useState([]);
  const [language, setLanguage] = useState(null);
  const [region, setRegion] = useState(null);

  const [movies, setMovies] = useState([]);
  const [moviesLoading, setMoviesLoading] = useState(false);

  const [deckIndex, setDeckIndex] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  const [dragDy, setDragDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exitDir, setExitDir] = useState(null);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [history, setHistory] = useState([]);
  const [likedMovies, setLikedMovies] = useState([]);
  const [superlikesUsed, setSuperlikesUsed] = useState(3);

  const [showMatch, setShowMatch] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const [activeFriendId, setActiveFriendId] = useState('partner');
  const [usernameInput, setUsernameInput] = useState('');
  const [sentInvites, setSentInvites] = useState([]);
  const [contactsInvited, setContactsInvited] = useState({});

  const dragStart = useRef(null);
  const trailerTimer = useRef(null);
  const stateRef = useRef();
  stateRef.current = { dragDx, dragDy, deckIndex, superlikesUsed, exitDir, movies };

  // — trailer autoplay —
  useEffect(() => {
    clearTimeout(trailerTimer.current);
    setTrailerPlaying(false);
    if (screen === 'app' && tab === 'home') {
      trailerTimer.current = setTimeout(() => setTrailerPlaying(true), TRAILER_DELAY_MS);
    }
    return () => clearTimeout(trailerTimer.current);
  }, [screen, tab, deckIndex]);

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
    if (dir === 'up' && stateRef.current.superlikesUsed >= SUPERLIKE_LIMIT) {
      setDragging(false);
      setDragDx(0);
      setDragDy(0);
      setShowPaywall(true);
      return;
    }
    const prevDeckIndex = stateRef.current.deckIndex;
    const movie = stateRef.current.movies[prevDeckIndex];
    const wasLiked = dir === 'right' || dir === 'up';
    setExitDir(dir);
    setDragging(false);
    setTimeout(() => {
      setDeckIndex(prevDeckIndex + 1);
      setDragDx(0);
      setDragDy(0);
      setExitDir(null);
      setHistory((h) => [...h, { prevDeckIndex, dir, movieId: movie ? movie.id : null, wasLiked }]);
      if (dir === 'up') setSuperlikesUsed((n) => n + 1);
      if (wasLiked && movie) {
        setLikedMovies((lm) => [...lm, movie.id]);
        if (movie.partnerLiked) setShowMatch(movie);
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

  const loadMovies = async () => {
    setMoviesLoading(true);
    let results = [];
    try {
      results = await fetchMovies({ genres: genresSel, language, region });
    } catch {
      results = [];
    }
    setMovies(results.length ? results : FALLBACK_MOVIES);
    setDeckIndex(0);
    setHistory([]);
    setMoviesLoading(false);
  };

  const goToOnboarding = () => setScreen('onboarding');
  const goToLogin = () => { setScreen('login'); setTab('home'); };
  const finishOnboarding = () => { if (genresSel.length) { setScreen('app'); loadMovies(); } };
  const toggleGenre = (g) => setGenresSel((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]));

  const openPaywall = () => setShowPaywall(true);
  const closePaywall = () => setShowPaywall(false);
  const dismissMatch = () => setShowMatch(null);
  const viewInMatches = () => { setShowMatch(null); setTab('matches'); setActiveFriendId('partner'); };

  const sendUsernameInvite = () => {
    const u = usernameInput.trim();
    if (!u) return;
    setSentInvites((s) => [...s, u.startsWith('@') ? u : '@' + u]);
    setUsernameInput('');
  };
  const toggleContact = (name) => setContactsInvited((s) => ({ ...s, [name]: !s[name] }));

  // — derived values —
  const superlikesLeft = Math.max(0, SUPERLIKE_LIMIT - superlikesUsed);
  const partnerCommon = movies.filter((m) => likedMovies.includes(m.id) && m.partnerLiked);
  const friendsWithCommon = FRIENDS.map((f) => {
    if (f.id === 'partner') return { ...f, common: partnerCommon.map((m) => m.id) };
    if (f.status === 'pending') return { ...f, common: [] };
    return { ...f, common: movies.filter((m) => simpleHash(m.id + f.id) % 3 === 0).map((m) => m.id) };
  });
  const activeFriendRaw = friendsWithCommon.find((f) => f.id === activeFriendId) || friendsWithCommon[0];
  const commonMovies = (activeFriendRaw.common || []).map((id) => movies.find((m) => m.id === id)).filter(Boolean);
  const chipFriends = friendsWithCommon.filter((f) => f.status !== 'pending');
  const prefsSummary = [genresSel[0], language, region].filter(Boolean).join(' · ') || 'Not set';
  const hasNewMatch = partnerCommon.length > 0;

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

  return (
    <div className="app-page">
      <PhoneFrame>
        {screen === 'login' && (
          <LoginScreen
            loginInput={loginInput}
            onLoginInputChange={(e) => setLoginInput(e.target.value)}
            goToOnboarding={goToOnboarding}
          />
        )}

        {screen === 'onboarding' && (
          <OnboardingScreen
            genresSel={genresSel} toggleGenre={toggleGenre}
            language={language} setLanguage={setLanguage}
            region={region} setRegion={setRegion}
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
                />
              )}
              {tab === 'matches' && (
                <MatchesScreen
                  friendChips={chipFriends}
                  activeFriendId={activeFriendId} setActiveFriendId={setActiveFriendId}
                  activeFriend={activeFriendRaw} commonMovies={commonMovies}
                />
              )}
              {tab === 'friends' && (
                <FriendsScreen
                  usernameInput={usernameInput} onUsernameChange={(e) => setUsernameInput(e.target.value)}
                  sendUsernameInvite={sendUsernameInvite} sentInvites={sentInvites}
                  contactsInvited={contactsInvited} toggleContact={toggleContact}
                  friends={FRIENDS}
                  onSelectFriend={(id) => { setActiveFriendId(id); setTab('matches'); }}
                />
              )}
              {tab === 'profile' && (
                <ProfileScreen
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
          <MatchModalFull movie={showMatch} viewInMatches={viewInMatches} dismissMatch={dismissMatch} />
        )}
        {showMatch && MATCH_CELEBRATION === 'toast' && (
          <MatchModalToast movie={showMatch} viewInMatches={viewInMatches} />
        )}
        {showPaywall && (
          <PaywallModal superlikeLimit={SUPERLIKE_LIMIT} closePaywall={closePaywall} />
        )}
      </PhoneFrame>
    </div>
  );
}

function LoginScreen({ loginInput, onLoginInputChange, goToOnboarding }) {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '120px 28px 40px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        <div style={{ font: '800 15px/1 var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>MatchCut</div>
        <h1 style={{ margin: '18px 0 0', font: '800 40px/1.05 var(--font-heading)', color: 'var(--color-text)' }}>Swipe movies.<br />Match with your person.</h1>
        <p style={{ margin: '16px 0 0', font: '400 15px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>Swipe through new releases together. When you both like the same title, we'll tell you.</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label>Email or phone</label>
          <input className="input" type="text" placeholder="you@example.com" value={loginInput} onChange={onLoginInputChange} />
        </div>
        <button className="btn btn-primary btn-block" onClick={goToOnboarding}>Continue</button>
        <div style={{ textAlign: 'left', font: '400 13px/1.4 var(--font-body)', color: 'var(--color-neutral-700)' }}>
          Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); goToOnboarding(); }} style={{ color: 'var(--color-accent-700)' }}>Log in</a>
        </div>
      </div>
    </div>
  );
}

function OnboardingScreen({ genresSel, toggleGenre, language, setLanguage, region, setRegion, finishOnboarding }) {
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
          <button key={r} style={chipStyle(region === r)} onClick={() => setRegion(r)}>{r}</button>
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

function DiscoverScreen({ topCard, stackCards, moviesLoading, startDrag, undoSwipe, undoDisabled, resetDeck, swipeLike, swipeMaybe, swipeDiscard, swipeSuper }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '58px 18px 14px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)' }}>Discover</div>
        <button onClick={undoSwipe} disabled={undoDisabled} style={{ border: '2px solid var(--color-divider)', background: 'transparent', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: undoDisabled ? 0.35 : 1, borderRadius: '50%' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 3-6.7M3 12V5m0 7h7" stroke="var(--color-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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

              <div style={{ position: 'absolute', top: 16, left: 16, font: '800 22px var(--font-heading)', color: '#fff', padding: '6px 10px', border: '2px solid #fff', borderRadius: 10, transform: 'rotate(-14deg)', opacity: topCard.likeOpacity }}>LIKE</div>
              <div style={{ position: 'absolute', top: 16, right: 16, font: '800 22px var(--font-heading)', color: '#fff', padding: '6px 10px', border: '2px solid #fff', borderRadius: 10, transform: 'rotate(14deg)', opacity: topCard.maybeOpacity }}>MAYBE</div>
              <div style={{ position: 'absolute', bottom: 120, left: 16, font: '800 22px var(--font-heading)', color: '#fff', padding: '6px 10px', border: '2px solid #fff', borderRadius: 10, opacity: topCard.superOpacity }}>SUPERLIKE</div>
              <div style={{ position: 'absolute', bottom: 120, right: 16, font: '800 22px var(--font-heading)', color: '#fff', padding: '6px 10px', border: '2px solid #fff', borderRadius: 10, opacity: topCard.nopeOpacity }}>DISCARD</div>

              {topCard.showTrailer && (
                <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(0,0,0,.55)', padding: '6px 12px', border: '1px solid rgba(255,255,255,.4)', borderRadius: 20 }}>
                  <span style={{ width: 7, height: 7, background: 'var(--color-accent)', borderRadius: '50%', animation: 'pulseDot 1.4s ease-out infinite' }} />
                  <span style={{ font: '700 11px var(--font-body)', letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff' }}>Playing trailer</span>
                </div>
              )}

              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 18px 22px', background: 'linear-gradient(to top, rgba(0,0,0,.92), rgba(0,0,0,.55) 55%, rgba(0,0,0,0))' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ font: '800 24px var(--font-heading)', color: '#fff' }}>{topCard.movie.title}</span>
                  <span style={{ font: '700 13px var(--font-body)', color: 'var(--color-accent)' }}>★ {topCard.movie.rating}</span>
                </div>
                <div style={{ margin: '6px 0 8px', font: '400 12.5px/1.4 var(--font-body)', color: 'rgba(255,255,255,.85)' }}>{topCard.movie.desc}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {topCard.movie.genres.map((g) => (
                    <span key={g} style={{ font: '600 10.5px var(--font-body)', letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff', border: '1px solid rgba(255,255,255,.5)', padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0 }}>{g}</span>
                  ))}
                </div>
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
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, paddingTop: 16 }}>
          <button onClick={swipeMaybe} style={{ width: 52, height: 52, border: '2px solid var(--color-neutral-500)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5m0 0l6 6m-6-6l6-6" stroke="var(--color-neutral-700)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={swipeDiscard} style={{ width: 52, height: 52, border: '2px solid var(--color-text)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="var(--color-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={swipeSuper} style={{ width: 52, height: 52, border: 'none', background: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.9 6.6L22 9.3l-5.2 4.8L18.2 21 12 17.3 5.8 21l1.4-6.9L2 9.3l7.1-.7L12 2z" fill="#fff" /></svg>
          </button>
          <button onClick={swipeLike} style={{ width: 52, height: 52, border: 'none', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '50%' }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M12 21s-7.5-4.6-10-9.1C.5 8.1 2.3 4.5 6 4c2.1-.3 4 1 6 3.3C14 5 15.9 3.7 18 4c3.7.5 5.5 4.1 4 7.9C19.5 16.4 12 21 12 21z" fill="#fff" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function MatchesScreen({ friendChips, activeFriendId, setActiveFriendId, activeFriend, commonMovies }) {
  const commonCountText = commonMovies.length ? `${commonMovies.length} movie${commonMovies.length > 1 ? 's' : ''} in common` : 'No overlap yet';
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '58px 20px 14px', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)', marginBottom: 14 }}>Matches</div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 14, marginBottom: 14, borderBottom: '2px solid var(--color-divider)' }}>
        {friendChips.map((f) => (
          <button key={f.id} onClick={() => setActiveFriendId(f.id)} style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 52, height: 52, background: avatarBgFor(f.id), display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 16px var(--font-heading)', color: '#fff', border: f.id === activeFriendId ? '3px solid var(--color-accent)' : '3px solid transparent', borderRadius: '50%', overflow: 'hidden' }}>
              <Avatar id={f.id} size={52} radius={9999} />
            </div>
            <span style={{ font: '600 10.5px var(--font-body)', color: 'var(--color-text)' }}>{f.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 4 }}>You &amp; {activeFriend.name}</div>
      <div style={{ font: '400 12.5px var(--font-body)', color: 'var(--color-neutral-700)', marginBottom: 16 }}>{commonCountText}</div>

      {commonMovies.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {commonMovies.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--color-divider)' }}>
              <div style={{ width: 56, height: 80, flex: 'none', background: 'var(--color-neutral-300)', overflow: 'hidden', borderRadius: 12, position: 'relative' }}>
                <Poster id={m.id} src={m.posterUrl} radius={12} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
                <span className="tag tag-accent" style={{ alignSelf: 'flex-start', font: '700 9.5px var(--font-body)' }}>You both liked</span>
                <span style={{ font: '800 15px var(--font-heading)', color: 'var(--color-text)' }}>{m.title}</span>
                <span style={{ font: '400 12px var(--font-body)', color: 'var(--color-neutral-700)' }}>★ {m.rating} · {m.genres.join(' · ')}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 10px', font: '400 13px/1.5 var(--font-body)', color: 'var(--color-neutral-700)' }}>No shared likes yet — keep swiping, we'll notify you both the moment you match.</div>
      )}
    </div>
  );
}

function FriendsScreen({ usernameInput, onUsernameChange, sendUsernameInvite, sentInvites, contactsInvited, toggleContact, friends, onSelectFriend }) {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '58px 20px 14px', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)', marginBottom: 14 }}>Friends</div>

      <div className="field" style={{ marginBottom: 10 }}>
        <label>Add by username</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="text" placeholder="@username" value={usernameInput} onChange={onUsernameChange} style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={sendUsernameInvite} disabled={!usernameInput.trim()}>Add</button>
        </div>
      </div>
      {sentInvites.length > 0 && (
        <div style={{ font: '400 12px var(--font-body)', color: 'var(--color-accent-700)', marginBottom: 18 }}>Invite sent to {sentInvites.join(', ')}</div>
      )}

      <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', margin: '8px 0 10px' }}>From your contacts</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 22 }}>
        {CONTACTS.map((name) => {
          const invited = !!contactsInvited[name];
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-divider)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, background: 'var(--color-neutral-300)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 12px var(--font-heading)', color: 'var(--color-text)', borderRadius: '50%' }}>{initials(name)}</div>
                <span style={{ font: '600 13.5px var(--font-body)', color: 'var(--color-text)' }}>{name}</span>
              </div>
              <button
                onClick={() => toggleContact(name)}
                style={invited
                  ? { background: 'none', border: '2px solid var(--color-divider)', color: 'var(--color-neutral-700)', padding: '6px 14px', font: '700 11px var(--font-body)', cursor: 'pointer', borderRadius: 20 }
                  : { background: 'var(--color-text)', border: 'none', color: '#fff', padding: '6px 14px', font: '700 11px var(--font-body)', cursor: 'pointer', borderRadius: 20 }}
              >{invited ? 'Invited' : 'Invite'}</button>
            </div>
          );
        })}
      </div>

      <div style={{ font: '700 12px var(--font-heading)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', margin: '8px 0 10px' }}>Your connections</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {friends.map((fr) => {
          const tagClass = fr.status === 'partner' ? 'tag-accent' : fr.status === 'pending' ? 'tag-outline' : 'tag-neutral';
          const statusLabel = fr.status === 'partner' ? 'Partner' : fr.status === 'pending' ? 'Pending' : 'Connected';
          return (
            <button key={fr.id} onClick={() => onSelectFriend(fr.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-divider)', background: 'none', border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--color-divider)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, background: avatarBgFor(fr.id), display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px var(--font-heading)', color: '#fff', borderRadius: '50%', overflow: 'hidden' }}>
                  <Avatar id={fr.id} size={38} radius={9999} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: '700 14px var(--font-body)', color: 'var(--color-text)' }}>{fr.name}</span>
                  <span style={{ font: '400 11.5px var(--font-body)', color: 'var(--color-neutral-700)' }}>{fr.username}</span>
                </div>
              </div>
              <span className={`tag ${tagClass}`} style={{ font: '700 9.5px var(--font-body)' }}>{statusLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileScreen({ superlikesLeft, superlikeLimit, openPaywall, prefsSummary, goToOnboarding, goToLogin }) {
  const pct = Math.round((superlikesLeft / superlikeLimit) * 100);
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '58px 20px 14px', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ font: '800 20px/1 var(--font-heading)', color: 'var(--color-text)', marginBottom: 18 }}>Profile</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div style={{ width: 64, height: 64, flex: 'none', background: 'var(--color-neutral-300)', overflow: 'hidden', borderRadius: 16, position: 'relative' }}>
          <Avatar id="you" size={64} radius={16} />
        </div>
        <div>
          <div style={{ font: '800 17px var(--font-heading)', color: 'var(--color-text)' }}>You</div>
          <div style={{ font: '400 12.5px var(--font-body)', color: 'var(--color-neutral-700)' }}>@you</div>
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 22, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="card-kicker">Superlikes</span>
          <span style={{ font: '800 13px var(--font-body)', color: 'var(--color-text)' }}>{superlikesLeft} / {superlikeLimit} left this week</span>
        </div>
        <div style={{ height: 6, background: 'var(--color-neutral-200)', marginBottom: 12, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--color-accent)', width: `${pct}%`, borderRadius: 4 }} />
        </div>
        <button className="btn btn-primary btn-block" onClick={openPaywall}>Get unlimited superlikes</button>
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
    <div style={{ display: 'flex', borderTop: '2px solid var(--color-divider)', background: 'var(--color-bg)', paddingBottom: 20 }}>
      <button onClick={() => setTab('home')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="14" height="10" stroke={tabColor('home')} strokeWidth="2" /><rect x="7" y="4" width="14" height="10" stroke={tabColor('home')} strokeWidth="2" fill="var(--color-bg)" /></svg>
        <span style={{ font: '700 10px var(--font-body)', color: tabColor('home') }}>Discover</span>
      </button>
      <button onClick={() => setTab('matches')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 10, background: 'none', border: 'none', cursor: 'pointer', position: 'relative' }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M12 20s-7-4.3-9.3-8.5C1 8 2.6 4.8 6 4.4c2-.2 3.7 1 6 3.1 2.3-2.1 4-3.3 6-3.1 3.4.4 5 3.6 3.3 7.1C19 15.7 12 20 12 20z" stroke={tabColor('matches')} strokeWidth="2" /></svg>
        <span style={{ font: '700 10px var(--font-body)', color: tabColor('matches') }}>Matches</span>
        {hasNewMatch && <span style={{ position: 'absolute', top: 6, right: 24, width: 8, height: 8, background: 'var(--color-accent)', borderRadius: '50%' }} />}
      </button>
      <button onClick={() => setTab('friends')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
        <svg width="22" height="21" viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="8" r="3.2" stroke={tabColor('friends')} strokeWidth="2" /><circle cx="16" cy="9" r="2.6" stroke={tabColor('friends')} strokeWidth="2" /><path d="M2.5 19c.6-3.3 3-5 6-5s5.4 1.7 6 5" stroke={tabColor('friends')} strokeWidth="2" strokeLinecap="round" /><path d="M15 14.3c2.3.2 4 1.7 4.5 4.7" stroke={tabColor('friends')} strokeWidth="2" strokeLinecap="round" /></svg>
        <span style={{ font: '700 10px var(--font-body)', color: tabColor('friends') }}>Friends</span>
      </button>
      <button onClick={() => setTab('profile')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
        <svg width="19" height="21" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7" r="4" stroke={tabColor('profile')} strokeWidth="2" /><path d="M4 20c1-4.4 4-6.5 8-6.5s7 2.1 8 6.5" stroke={tabColor('profile')} strokeWidth="2" strokeLinecap="round" /></svg>
        <span style={{ font: '700 10px var(--font-body)', color: tabColor('profile') }}>Profile</span>
      </button>
    </div>
  );
}

function MatchModalFull({ movie, viewInMatches, dismissMatch }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--color-accent)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 36, boxSizing: 'border-box', textAlign: 'center' }}>
      <div style={{ font: '800 14px var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: '#fff', marginBottom: 10 }}>You matched</div>
      <div style={{ font: '800 34px/1.1 var(--font-heading)', color: '#fff', marginBottom: 22 }}>Both liked<br />{movie.title}</div>
      <div style={{ display: 'flex', marginBottom: 20 }}>
        <div style={{ width: 88, height: 120, background: 'var(--color-neutral-300)', border: '3px solid #fff', overflow: 'hidden', transform: 'rotate(-6deg)', borderRadius: 14, position: 'relative' }}>
          <Poster id={movie.id} src={movie.posterUrl} radius={11} />
        </div>
        <div style={{ width: 60, height: 60, background: '#fff', color: 'var(--color-accent-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 18px var(--font-heading)', marginLeft: -16, marginTop: 30, border: '3px solid var(--color-accent)', borderRadius: '50%' }}>JK</div>
      </div>
      <div style={{ font: '400 13.5px/1.5 var(--font-body)', color: 'rgba(255,255,255,.9)', marginBottom: 26 }}>You and Jess Ko both liked this one. It's now in your shared Matches.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <button onClick={viewInMatches} style={{ background: '#fff', color: 'var(--color-accent-700)', border: 'none', padding: 14, font: '700 14px var(--font-body)', cursor: 'pointer', borderRadius: 14 }}>View in Matches</button>
        <button onClick={dismissMatch} style={{ background: 'transparent', color: '#fff', border: '2px solid #fff', padding: 12, font: '700 14px var(--font-body)', cursor: 'pointer', borderRadius: 14 }}>Keep swiping</button>
      </div>
    </div>
  );
}

function MatchModalToast({ movie, viewInMatches }) {
  return (
    <div style={{ position: 'absolute', left: 14, right: 14, bottom: 104, zIndex: 100, background: 'var(--color-text)', color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, animation: 'toastIn .35s ease-out', boxShadow: 'var(--shadow-lg)', borderRadius: 16 }}>
      <div style={{ width: 12, height: 12, background: 'var(--color-accent)', flex: 'none', borderRadius: '50%' }} />
      <div style={{ flex: 1, font: '600 12.5px/1.4 var(--font-body)' }}>You &amp; Jess Ko both liked <strong>{movie.title}</strong></div>
      <button onClick={viewInMatches} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', font: '700 12px var(--font-body)', cursor: 'pointer', flex: 'none' }}>VIEW</button>
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
