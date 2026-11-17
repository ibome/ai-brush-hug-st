export const isNovelAIV5 = (model) => /^nai-diffusion-5-(?:full|curated)(?:-inpainting)?$/.test(model || '');

export function novelAIImageModel(model) {
  // V5 Curated uses the official Curated inpainting route.
  if (model === 'nai-diffusion-5-curated') return 'nai-diffusion-4-5-curated-inpainting';
  if (model === 'nai-diffusion-4-curated-preview') return 'nai-diffusion-4-curated-inpainting';
  return `${model.replace(/-inpainting$/, '')}-inpainting`;
}

export function novelAIImageCapabilities(model) {
  const supported = /^nai-diffusion-(?:3|furry-3|4-(?:full|curated-preview)|4-5-(?:full|curated)|5-(?:full|curated))$/.test(model || '');
  return { image: supported, inpaint: supported, transparent: isNovelAIV5(model) };
}
