import test from 'node:test';
import assert from 'node:assert/strict';
import { diffHunk, findCssSelector, markSourceLines } from '../lib/focus.js';

test('markSourceLines stamps element start lines and leaves script bodies alone', () => {
  const html = [
    '<!doctype html>',
    '<html>',
    '<body>',
    '  <section class="hero">',
    '    <h1>Hi</h1>',
    '    <script>var t = "<div>";</script>',
    '  </section>',
    '</body>',
    '</html>',
  ].join('\n');
  const marked = markSourceLines(html);
  assert.match(marked, /<section data-lp-line="4" class="hero">/);
  assert.match(marked, /<h1 data-lp-line="5">/);
  assert.match(marked, /var t = "<div>";/);
  assert.equal((marked.match(/data-lp-line=/g) || []).length, 2);
});

test('diffHunk finds the changed line range in the new revision', () => {
  const before = ['a', 'b', 'c', 'd', 'e'].join('\n');
  const after = ['a', 'b', 'C!', 'd', 'e'].join('\n');
  const hunk = diffHunk(before, after);
  assert.equal(hunk.from, 3);
  assert.equal(hunk.to, 3);
});

test('diffHunk covers insertions', () => {
  const before = ['a', 'b'].join('\n');
  const after = ['a', 'b', 'c', 'd'].join('\n');
  const hunk = diffHunk(before, after);
  assert.equal(hunk.from, 3);
  assert.ok(hunk.to >= 4);
});

test('findCssSelector resolves the rule around a declaration', () => {
  const css = ['.card {', '  color: red;', '  padding: 4px;', '}'].join('\n');
  assert.equal(findCssSelector(css, 3), '.card');
});

test('findCssSelector skips at-rules', () => {
  const css = ['@media (max-width: 600px) {', '  .card {', '    color: red;', '  }', '}'].join('\n');
  assert.equal(findCssSelector(css, 3), '.card');
  assert.equal(findCssSelector(css, 1), null);
});
