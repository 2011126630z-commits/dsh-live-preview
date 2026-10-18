/**
 * Focus helpers: map "what changed in the file" onto "which block of the page".
 *
 * - `markSourceLines` stamps served HTML with `data-lp-line="<n>"` so the preview
 *   page can find the element nearest an edited source line.
 * - `diffHunk` reduces two revisions of a file to one changed line range.
 * - `findCssSelector` turns an edited CSS line back into the rule's selector.
 *
 * Everything is a heuristic. When a mapping cannot be found the caller falls
 * back to a plain status line instead of pretending to know the block.
 */

export function countLines(text) {
  let lines = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea']);
const SKIP_MARK_TAGS = new Set([
  'html',
  'head',
  'body',
  'meta',
  'link',
  'title',
  'base',
  'br',
  'hr',
  'img',
  'input',
  'source',
  'track',
  'wbr',
  'col',
  'area',
  'embed',
  'param',
  'script',
  'style',
]);

const TAG_PATTERN = /^<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/;

/**
 * Add a `data-lp-line` marker (1-based source line of the start tag) to every
 * ordinary element. Script/style/textarea contents are copied verbatim.
 */
export function markSourceLines(html) {
  const source = String(html);
  const out = [];
  let cursor = 0;
  let line = 1;
  while (cursor < source.length) {
    const lt = source.indexOf('<', cursor);
    if (lt < 0) {
      out.push(source.slice(cursor));
      break;
    }
    const before = source.slice(cursor, lt);
    out.push(before);
    line += countLines(before);

    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      const end = close < 0 ? source.length : close + 3;
      const chunk = source.slice(lt, end);
      out.push(chunk);
      line += countLines(chunk);
      cursor = end;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const close = source.indexOf('>', lt + 2);
      const end = close < 0 ? source.length : close + 1;
      const chunk = source.slice(lt, end);
      out.push(chunk);
      line += countLines(chunk);
      cursor = end;
      continue;
    }

    const match = TAG_PATTERN.exec(source.slice(lt));
    if (!match) {
      out.push('<');
      cursor = lt + 1;
      continue;
    }
    const tag = match[0];
    const tagName = match[2].toLowerCase();
    const closing = match[1] === '/';

    if (!closing && RAW_TEXT_TAGS.has(tagName)) {
      const closePattern = new RegExp(`</${tagName}\\s*>`, 'i');
      const rest = source.slice(lt + tag.length);
      const close = closePattern.exec(rest);
      const end = close ? lt + tag.length + close.index + close[0].length : source.length;
      const chunk = source.slice(lt, end);
      out.push(chunk);
      line += countLines(chunk);
      cursor = end;
      continue;
    }

    if (!closing && !SKIP_MARK_TAGS.has(tagName) && !/\bdata-lp-line\s*=/.test(tag)) {
      out.push(`<${match[2]} data-lp-line="${line}"${match[3]}>`);
    } else {
      out.push(tag);
    }
    line += countLines(tag);
    cursor = lt + tag.length;
  }
  return out.join('');
}

/**
 * Reduce two revisions to one changed 1-based line range in the new revision.
 * Returns the whole new file when the revisions share no line prefix/suffix.
 */
export function diffHunk(oldText, newText) {
  const oldLines = String(oldText).split(/\r?\n/);
  const newLines = String(newText).split(/\r?\n/);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const from = prefix + 1;
  const to = Math.max(from, newLines.length - suffix);
  return { from, to, added: newLines.length - oldLines.length };
}

/**
 * Find the selector of the CSS rule surrounding a 1-based line.
 * Returns null for at-rules, declarations outside a rule, or unparsable text.
 */
export function findCssSelector(text, line) {
  const lines = String(text).split(/\r?\n/);
  const start = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
  for (let index = start; index >= 0 && index >= start - 80; index -= 1) {
    const brace = lines[index].indexOf('{');
    if (brace < 0) continue;
    let selector = lines[index].slice(0, brace).trim();
    let walk = index - 1;
    while (!selector && walk >= 0 && walk >= start - 80) {
      selector = lines[walk].trim();
      walk -= 1;
    }
    selector = selector.split(/[;}]/).pop().trim();
    if (!selector || selector.startsWith('@') || selector.startsWith('//')) return null;
    if (selector.length > 200) return null;
    if (!/^[\w\s.#:>+~*\[\]="'()|-]+$/.test(selector)) return null;
    return selector;
  }
  return null;
}
