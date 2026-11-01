export function floatingMenuPosition(anchor, size, viewport) {
  const margin = 8;
  const gap = 10;
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  const clampX = (value) => Math.max(margin, Math.min(maxX, value));
  const clampY = (value) => Math.max(margin, Math.min(maxY, value));
  const right = anchor.x + anchor.width;
  const bottom = anchor.y + anchor.height;
  let x;
  let y = anchor.y + (anchor.height - size.height) / 2;
  if (right + gap + size.width <= viewport.width - margin) {
    x = right + gap;
  } else if (anchor.x - gap - size.width >= margin) {
    x = anchor.x - gap - size.width;
  } else {
    x = anchor.x + (anchor.width - size.width) / 2;
    y = anchor.y - gap - size.height >= margin
      ? anchor.y - gap - size.height
      : bottom + gap;
  }
  return { x: clampX(x), y: clampY(y) };
}
