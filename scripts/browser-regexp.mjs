import { tokenizer } from 'acorn';

function hasLookbehind(pattern) {
  let escaped = false, characterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '[') characterClass = true;
    if (char === ']') characterClass = false;
    if (!characterClass && char === '(' && ['(?<=', '(?<!'].includes(pattern.slice(index, index + 4))) return true;
  }
  return false;
}

export function assertBrowserRegex(code, filename = 'client.js') {
  const tokens = [...tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' })];
  let checked = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const literal = token.type.label === 'regexp';
    const constructor = token.type.label === 'string' && tokens[index - 1]?.type.label === '('
      && tokens[index - 2]?.type.label === 'name' && tokens[index - 2].value === 'RegExp';
    if (!literal && !constructor) continue;
    checked++;
    if (hasLookbehind(literal ? token.value.pattern : token.value)) {
      throw new Error(`${filename}: RegExp lookbehind is incompatible with older iOS browsers`);
    }
  }
  return checked;
}
