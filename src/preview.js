import './styles/plugin.css';
import { normalizeConfig, readConfig, STORAGE_KEY } from './config.js';
import { mountPlugin, applyConfig, restoreCredentials } from './ui/plugin.js';

await restoreCredentials();
mountPlugin(document.getElementById('plugin-root'), readConfig());

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'draw-lab:config') applyConfig(normalizeConfig(event.data.config));
});

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) applyConfig(readConfig());
});

if (window.parent !== window) {
  window.parent.postMessage({ type: 'draw-lab:ready' }, location.origin);
}
