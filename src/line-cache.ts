import { readFileSync, statSync } from "node:fs";

/** Entries past this are dropped oldest-first. */
const MAX_FILES = 100;
/** Generated or vendored blobs masquerading as source are skipped. */
const MAX_FILE_BYTES = 512 * 1024;
/** Keeps one minified line from dominating the payload. */
export const MAX_LINE_LENGTH = 1000;

export interface SourceContext {
  pre_context: string[];
  context_line: string;
  post_context: string[];
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  lines: string[] | null;
}

const cache = new Map<string, CachedFile>();

function readLines(path: string): string[] | null {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((line) => {
      const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;
      return stripped.length > MAX_LINE_LENGTH
        ? stripped.slice(0, MAX_LINE_LENGTH)
        : stripped;
    });
  } catch {
    return null;
  }
}

/**
 * Keyed by mtime and size, so a file edited under a long-lived process is
 * re-read rather than served stale. Unreadable files are cached as `null` so a
 * frame in a file we cannot read costs one stat, not one read, per event.
 */
function linesFor(path: string): string[] | null {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) return null;

  const cached = cache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.lines;
  }

  if (cache.size >= MAX_FILES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  const lines = readLines(path);
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, lines });
  return lines;
}

/**
 * Source lines around `lineno`, or null when the file cannot be read — a
 * deleted file, a Node internal, an eval'd module, a directory.
 */
export function sourceContext(
  path: string | null,
  lineno: number | null,
  contextLines: number,
): SourceContext | null {
  if (!path || !lineno || lineno < 1 || contextLines < 1) return null;
  if (path.startsWith("node:") || path.startsWith("data:")) return null;

  const lines = linesFor(path);
  if (!lines) return null;

  const index = lineno - 1;
  const line = lines[index];
  if (line === undefined) return null;

  return {
    pre_context: lines.slice(Math.max(index - contextLines, 0), index),
    context_line: line,
    post_context: lines.slice(index + 1, index + 1 + contextLines),
  };
}

export function clearLineCache(): void {
  cache.clear();
}
