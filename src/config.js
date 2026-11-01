import { storageKey } from './runtime.js';
import { readBrowserCache } from './browser-cache.js';

export const STORAGE_KEY = storageKey('tavern-draw-layout-v1');
export const ACCENTS = ['#2e5fe8', '#1373bc', '#b84568', '#906615'];
const LEGACY_ACCENTS = {
  '#218f78': ACCENTS[0],
  '#4279c5': ACCENTS[1],
  '#be586e': ACCENTS[2],
  '#9b7a21': ACCENTS[3],
};
export const DEVICES = {
  desktop: { label: '电脑', icon: 'monitor', width: 1120, height: 790 },
  tablet: { label: '平板', icon: 'tablet', width: 768, height: 850 },
  mobile: { label: '手机', icon: 'smartphone', width: 390, height: 844 },
};

export const DEFAULT_CONFIG = Object.freeze({
  name: '灵画师',
  surface: 'console',
  device: 'desktop',
  theme: 'light',
  state: 'ready',
  accent: ACCENTS[0],
  navigation: 'left',
  sidebarWidth: 148,
  density: 'standard',
  radius: 6,
  fontSize: 14,
  imageWidth: 100,
});

const numberInRange = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const accent = LEGACY_ACCENTS[source.accent] || source.accent;
  return {
    name: String(source.name === '绘境' ? DEFAULT_CONFIG.name : source.name || DEFAULT_CONFIG.name).trim().slice(0, 20) || DEFAULT_CONFIG.name,
    surface: ['console', 'chat'].includes(source.surface) ? source.surface : 'console',
    device: Object.hasOwn(DEVICES, source.device) ? source.device : 'desktop',
    theme: source.theme === 'dark' ? 'dark' : 'light',
    state: ['ready', 'queued', 'generating', 'success', 'error'].includes(source.state) ? source.state : 'ready',
    accent: ACCENTS.includes(accent) ? accent : ACCENTS[0],
    navigation: source.navigation === 'top' ? 'top' : 'left',
    sidebarWidth: numberInRange(source.sidebarWidth, 148, 120, 200),
    density: ['compact', 'standard', 'relaxed'].includes(source.density) ? source.density : 'standard',
    radius: numberInRange(source.radius, 6, 0, 8),
    fontSize: numberInRange(source.fontSize, 14, 13, 16),
    imageWidth: numberInRange(source.imageWidth, 100, 55, 100),
  };
}

export function readConfig() {
  try {
    return normalizeConfig(JSON.parse(readBrowserCache(STORAGE_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function downloadJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
