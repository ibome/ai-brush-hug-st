import { parseImageTags } from './chat.js';

const excluded = 'pre,code,script,style,textarea,[hidden],[aria-hidden="true"],.linghuashi-chat-images';
const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'UL', 'OL',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE']);

function renderedText(root) {
  let text = '';
  const pieces = [];
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  function visit(node) {
    if (node.nodeType === 3) {
      const start = text.length;
      text += node.data;
      pieces.push({ node, start, end: text.length });
    } else if (node.nodeType === 1) {
      if (node.matches(excluded)) { newline(); return; }
      if (node.tagName === 'BR') { text += '\n'; return; }
      const block = node !== root && blocks.has(node.tagName);
      if (block) newline();
      for (const child of node.childNodes) visit(child);
      if (block) newline();
    }
  }
  visit(root);
  return { text, pieces };
}

export function locatePromptRanges(root, entries, prefix, suffix) {
  if (!root) return [];
  const { text, pieces } = renderedText(root);
  const slots = parseImageTags(text, prefix, suffix);
  const point = (offset, end) => {
    const piece = pieces.find((item) => end
      ? item.start < offset && offset <= item.end : item.start <= offset && offset < item.end);
    return piece ? { node: piece.node, offset: offset - piece.start } : null;
  };
  const normalized = (value) => value.replace(/\s+/g, ' ').trim();
  const starts = [];
  let search = 0;
  while (prefix && search < text.length) {
    const start = text.indexOf(prefix, search);
    if (start < 0) break;
    starts.push(start);
    search = start + prefix.length;
  }
  function promptEnd(start, prompt) {
    const expected = normalized(prompt);
    let position = start + prefix.length;
    while (/\s/.test(text[position] || '') && position < text.length) position++;
    for (let index = 0; index < expected.length; index++) {
      if (expected[index] === ' ') {
        if (!/\s/.test(text[position] || '')) return null;
        while (position < text.length && /\s/.test(text[position])) position++;
      } else {
        if (text[position] !== expected[index]) return null;
        position++;
      }
    }
    if (position < text.length && !/\s/.test(text[position]) && !text.startsWith(suffix, position)) return null;
    return { start, end: position };
  }
  const pairs = [];
  let cursor = 0;
  for (const entry of entries) {
    let slot;
    if (starts.length === entries.length) {
      const start = starts[entry.index];
      slot = slots.find((item) => item.start === start) || promptEnd(start, entry.prompt);
    }
    else {
      const index = slots.findIndex((item, index) => index >= cursor
        && normalized(item.prompt) === normalized(entry.prompt));
      if (index >= 0) { slot = slots[index]; cursor = index + 1; }
    }
    if (!slot) continue;
    const start = point(slot.start, false), end = point(slot.end, true);
    if (!start || !end) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    pairs.push({ entry, range, start: slot.start });
  }
  return pairs.sort((left, right) => left.start - right.start);
}

export function locateSmartAnchors(root, entries) {
  if (!root) return [];
  const { text, pieces } = renderedText(root);
  let compact = '';
  const offsets = [];
  for (let index = 0; index < text.length; index++) {
    if (/\s/.test(text[index]) && compact.endsWith(' ')) continue;
    compact += /\s/.test(text[index]) ? ' ' : text[index];
    offsets.push(index);
  }
  return entries.flatMap((entry) => {
    const anchor = entry.record?.assistant?.anchor?.replace(/\s+/g, ' ').trim();
    if (!anchor || anchor.length < 2) return [];
    const start = compact.indexOf(anchor);
    if (start < 0 || compact.indexOf(anchor, start + 1) >= 0) return [];
    const end = offsets[start + anchor.length - 1] + 1;
    const piece = pieces.find((item) => item.start < end && end <= item.end);
    if (!piece) return [];
    let block = piece.node.parentElement;
    while (block && block !== root && !blocks.has(block.tagName)) block = block.parentElement;
    if (block && block !== root) return [{ entry, block }];
    const range = root.ownerDocument.createRange();
    range.setStart(piece.node, end - piece.start); range.collapse(true);
    return [{ entry, range }];
  });
}

export function replacePromptRange(range, element) {
  const document = range.startContainer.ownerDocument;
  const first = range.startContainer, startOffset = range.startOffset;
  const last = range.endContainer, endOffset = range.endOffset;
  const common = range.commonAncestorContainer;
  const texts = [];
  if (common.nodeType === 3) texts.push(common);
  else {
    const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range.intersectsNode(node)) texts.push(node);
    }
  }
  const hidden = [];
  if (common.nodeType === 1) {
    for (const node of common.querySelectorAll('*')) {
      const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
      if (range.comparePoint(node.parentNode, index) === 0 && range.comparePoint(node.parentNode, index + 1) === 0) {
        hidden.push({ node, value: node.getAttribute('hidden') });
        node.setAttribute('hidden', '');
      }
    }
  }
  // Preserve the actual message nodes and their event handlers. Deleting text
  // from right to left keeps ranges for earlier tags valid.
  const nodes = texts.map((node) => ({ node, original: node.data }));
  for (const item of [...nodes].reverse()) {
    const from = item.node === first ? startOffset : 0;
    const to = item.node === last ? endOffset : item.node.length;
    item.node.deleteData(from, to - from);
  }
  const right = first.splitText(startOffset);
  first.parentNode.insertBefore(element, right);
  for (const item of nodes) item.expected = item.node.data;
  return { element, nodes, right, rightText: right.data, hidden };
}

export function restorePromptRange({ element, nodes, right, rightText, hidden }) {
  const unchanged = element.isConnected && right.isConnected && right.data === rightText
    && nodes.every((item) => item.node.isConnected && item.node.data === item.expected);
  if (unchanged) {
    for (const item of nodes) item.node.data = item.original;
    right.remove();
    for (const { node, value } of hidden) {
      if (value === null) node.removeAttribute('hidden');
      else node.setAttribute('hidden', value);
    }
  }
  element.remove();
}
