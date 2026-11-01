import { getCharacterTheme } from './appearance.js';
import whaleIcon from '../assets/theme-icons/whale-icon.webp';
import claudeIcon from '../assets/theme-icons/claude-icon.webp';
import geminiIcon from '../assets/theme-icons/gemini-icon.webp';
import gptIcon from '../assets/theme-icons/gpt-icon.webp';
import glmIcon from '../assets/theme-icons/glm-icon.webp';
import kimiIcon from '../assets/theme-icons/kimi-icon.webp';
import grokIcon from '../assets/theme-icons/grok-icon.webp';
import doubaoIcon from '../assets/theme-icons/doubao-icon.webp';
import ancientIcon from '../assets/theme-icons/ancient-icon.webp';

const themeIcons = Object.freeze({
  whale: whaleIcon, claude: claudeIcon, gemini: geminiIcon,
  gpt: gptIcon, glm: glmIcon, kimi: kimiIcon,
  grok: grokIcon, doubao: doubaoIcon, ancient: ancientIcon,
});

export function pluginIcon(themeId, className = '') {
  const theme = getCharacterTheme(themeId);
  return `<img class="plugin-logo ${className}" data-icon-theme="${theme.id}" src="${themeIcons[theme.id]}" alt="${theme.title}插件图标" width="192" height="192" decoding="async" draggable="false" />`;
}
