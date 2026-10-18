/**
 * Path helpers for the live-preview plugin.
 *
 * Everything here is pure or filesystem-only: no Cordis, no HTTP. That keeps
 * the security rules (containment, traversal, allow-lists) unit-testable
 * without a Harness profile.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Directory names skipped by the watcher, the file browser and the tree route. */
export const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.tmp',
  '.cache',
  'coverage',
];

/** Resolve an absolute path, resolving symlinks when the target exists. */
export async function realPathOrSelf(target) {
  const abs = path.resolve(target);
  try {
    return await fsp.realpath(abs);
  } catch {
    return abs;
  }
}

/** True when `target` is `root` itself or a descendant of it. */
export function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Convert an absolute path to a root-relative POSIX path. */
export function toPosixRel(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

/**
 * Resolve a root-relative URL path inside `root`.
 * Returns `null` when the result would leave `root`.
 */
export function safeResolve(root, relPath) {
  const cleaned = String(relPath == null ? '' : relPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (cleaned.includes('\0')) return null;
  const segments = cleaned.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '..') return null;
  }
  const abs = path.resolve(root, segments.join(path.sep));
  if (!isInside(root, abs)) return null;
  return abs;
}

/** Find the nearest allow-listed ancestor of `absPath`, or undefined. */
export async function findAllowedRoot(absPath, allowedRoots) {
  const target = await realPathOrSelf(absPath);
  let best;
  for (const candidate of allowedRoots) {
    const root = await realPathOrSelf(candidate);
    if (!isInside(root, target)) continue;
    if (!best || root.length > best.length) best = root;
  }
  return best;
}

/**
 * List one directory for the file browser.
 * Skips dot entries and ignore-list names, caps the entry count.
 */
export async function listDirectory(absDir, options = {}) {
  const ignore = new Set(options.ignore && options.ignore.length ? options.ignore : DEFAULT_IGNORE);
  const limit = Math.min(Math.max(Number(options.limit) || 400, 1), 2000);
  const dirents = await fsp.readdir(absDir, { withFileTypes: true });
  const entries = [];
  for (const dirent of dirents) {
    if (entries.length >= limit) break;
    const name = dirent.name;
    if (name.startsWith('.')) continue;
    if (ignore.has(name)) continue;
    if (dirent.isDirectory()) {
      entries.push({ name, type: 'directory' });
    } else if (dirent.isFile()) {
      const ext = path.extname(name).toLowerCase();
      entries.push({ name, type: 'file', html: ext === '.html' || ext === '.htm' });
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    entries,
    truncated: dirents.length > entries.length,
  };
}

/** Case-insensitive path comparison the way Windows needs it. */
export function samePath(a, b) {
  const left = path.resolve(String(a));
  const right = path.resolve(String(b));
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}
