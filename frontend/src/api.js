const API_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'matchcut_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json;
}

export function register({ email, username, password }) {
  return request('/auth/register', { method: 'POST', body: { email, username, password } });
}
export function login({ email, password }) {
  return request('/auth/login', { method: 'POST', body: { email, password } });
}
export function getMe() {
  return request('/me');
}
export function updatePreferences({ genres, language, regions }) {
  return request('/me/preferences', { method: 'PATCH', body: { genres, language, regions } });
}
export async function getMovies({ genres = [], language, regions = [], sort = 'foryou' }) {
  const params = new URLSearchParams();
  if (genres.length) params.set('genres', genres.join(','));
  if (language) params.set('language', language);
  if (regions.length) params.set('regions', regions.join(','));
  if (sort) params.set('sort', sort);
  const { movies } = await request(`/movies?${params.toString()}`);
  return movies;
}
export async function getTrailerKey(movieId) {
  const { key } = await request(`/movies/${movieId}/trailer`);
  return key;
}
export function getWatchProviders(movieId, regions = []) {
  const params = new URLSearchParams();
  if (regions.length) params.set('regions', regions.join(','));
  return request(`/movies/${movieId}/providers?${params.toString()}`);
}
export function submitSwipe({ movieId, direction }) {
  return request('/swipes', { method: 'POST', body: { movieId, direction } });
}
export async function getFriends() {
  const { friends } = await request('/friends');
  return friends;
}
export function inviteFriend(identifier, asPartner = false) {
  return request('/friends/invite', { method: 'POST', body: { identifier, asPartner } });
}
export function acceptFriend(friendId) {
  return request(`/friends/${friendId}/accept`, { method: 'POST' });
}
export function promotePartner(friendId) {
  return request(`/friends/${friendId}/partner`, { method: 'POST' });
}
export function deleteMatch(friendId, movieId) {
  return request(`/friends/${friendId}/matches/${movieId}`, { method: 'DELETE' });
}
export async function getFriendSuperlikes(friendId) {
  const { movies } = await request(`/friends/${friendId}/superlikes`);
  return movies;
}
