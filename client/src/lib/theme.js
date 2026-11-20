/**
 * Theme (light / dark / system) and chat wallpaper. Settings live on the server (so they
 * follow the user across devices); a copy in localStorage lets index.html apply the theme
 * before React loads, so there's no white flash in dark mode.
 */

export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System default' },
];

// Each wallpaper has a light-mode and a dark-mode colour. 'default' uses the CSS token.
export const WALLPAPERS = [
  { id: 'default', label: 'Default', light: '#efeae2', dark: '#0b141a' },
  { id: 'mint', label: 'Mint', light: '#d8f3dc', dark: '#0f2a1f' },
  { id: 'sky', label: 'Sky', light: '#dbeafe', dark: '#0f1f33' },
  { id: 'lavender', label: 'Lavender', light: '#ede9fe', dark: '#1d1733' },
  { id: 'sand', label: 'Sand', light: '#f7ecd9', dark: '#2a2214' },
  { id: 'slate', label: 'Slate', light: '#e2e8f0', dark: '#1a222c' },
];

const STORAGE_KEY = 'chat.appearance';
const media = window.matchMedia('(prefers-color-scheme: dark)');
let current = { theme: 'system', wallpaper: 'default' };

function save(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. — the server copy is the source of truth */
  }
}

export function loadSavedAppearance() {
  try {
    return { ...current, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return current;
  }
}

const isDark = (theme) => theme === 'dark' || (theme === 'system' && media.matches);

function render() {
  const dark = isDark(current.theme);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  const wp = WALLPAPERS.find((w) => w.id === current.wallpaper);
  if (wp && wp.id !== 'default') root.style.setProperty('--color-chat', dark ? wp.dark : wp.light);
  else root.style.removeProperty('--color-chat');
}

/** Apply (and remember) { theme, wallpaper }. */
export function applyAppearance(settings) {
  current = { ...current, ...settings };
  save(current);
  render();
}

// "System default" follows the OS live.
media.addEventListener('change', () => current.theme === 'system' && render());

// Before login: use whatever this browser last used.
applyAppearance(loadSavedAppearance());
