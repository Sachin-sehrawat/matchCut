export const GENRES = ['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Horror', 'Romance', 'Thriller', 'Documentary', 'Animation', 'Fantasy'];
export const LANGUAGES = ['English', 'Spanish', 'French', 'Korean', 'Hindi', 'Japanese', 'Telugu', 'Tamil', 'Kannada', 'Malayalam'];
export const REGIONS = ['United States', 'United Kingdom', 'India', 'South Korea', 'France', 'Mexico', 'Global'];

export const FALLBACK_MOVIES = [
  { id: 'm1', title: 'Glass Horizon', desc: 'A satellite engineer must choose between the mission and her estranged brother stranded on the station.', rating: 8.1, genres: ['Sci-Fi', 'Drama'], partnerLiked: true },
  { id: 'm2', title: 'Late Ferry', desc: 'Two strangers share a night crossing after missing the last train home, and neither wants it to end.', rating: 7.4, genres: ['Romance', 'Drama'], partnerLiked: false },
  { id: 'm3', title: 'Static & Silence', desc: 'A retired hacker is pulled back in when her old crew resurfaces with one impossible last job.', rating: 7.8, genres: ['Thriller', 'Action'], partnerLiked: true },
  { id: 'm4', title: 'Paper Cities', desc: 'An architect discovers the model city she built as a child is somehow rebuilding itself, brick by brick.', rating: 6.9, genres: ['Fantasy'], partnerLiked: false },
  { id: 'm5', title: 'Low Tide', desc: 'A small fishing town unravels after a decades-old secret washes ashore with the tide.', rating: 8.4, genres: ['Drama', 'Thriller'], partnerLiked: true },
  { id: 'm6', title: 'Nightshift Diner', desc: 'The odd-hours regulars keep an all-night diner running through a citywide blackout.', rating: 7.0, genres: ['Comedy'], partnerLiked: false },
];

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
export function avatarBgFor(id) {
  const palette = ['var(--color-neutral-700)', 'var(--color-accent-700)', 'var(--color-neutral-900)', 'var(--color-neutral-500)'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h += id.charCodeAt(i);
  return palette[h % palette.length];
}
