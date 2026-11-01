import { ACCENTS } from '../config.js';

export const CHARACTER_THEMES = Object.freeze([
  { id: 'whale', title: '鲸鱼娘', accent: null },
  { id: 'claude', title: 'Claude小姐', accent: '#ae5133' },
  { id: 'gemini', title: 'Gemini娘', accent: '#1b806b' },
  { id: 'gpt', title: 'GPT娘', accent: '#62618a' },
  { id: 'glm', title: 'GLM娘', accent: '#826220' },
  { id: 'kimi', title: 'Kimi公主', accent: '#5b5386' },
  { id: 'grok', title: 'Grok小姐', accent: '#655199' },
  { id: 'doubao', title: '美国豆包', accent: '#2b6894' },
  { id: 'ancient', title: '古装男神', accent: '#366c62' },
]);

export function getCharacterTheme(id) {
  return CHARACTER_THEMES.find((theme) => theme.id === id) || CHARACTER_THEMES[0];
}

export function characterThemeAccent(id, configuredAccent) {
  return configuredAccent === ACCENTS[0]
    ? getCharacterTheme(id).accent || configuredAccent
    : configuredAccent;
}
