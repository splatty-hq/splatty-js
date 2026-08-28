import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sourceContext,
  clearLineCache,
  MAX_LINE_LENGTH,
} from "../src/line-cache.js";

function fixture(lines = 10): string {
  const dir = mkdtempSync(join(tmpdir(), "splatty-linecache-"));
  const path = join(dir, "sample.js");
  const body = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
  writeFileSync(path, `${body}\n`);
  return path;
}

beforeEach(() => clearLineCache());

test("sourceContext returns the lines around the frame", () => {
  const context = sourceContext(fixture(), 5, 2);
  assert.deepEqual(context, {
    pre_context: ["line 3", "line 4"],
    context_line: "line 5",
    post_context: ["line 6", "line 7"],
  });
});

test("sourceContext clamps at file boundaries", () => {
  const path = fixture();

  assert.deepEqual(sourceContext(path, 1, 3), {
    pre_context: [],
    context_line: "line 1",
    post_context: ["line 2", "line 3", "line 4"],
  });
  assert.deepEqual(sourceContext(path, 10, 3), {
    pre_context: ["line 7", "line 8", "line 9"],
    context_line: "line 10",
    post_context: [],
  });
});

test("sourceContext gives up on what it cannot read", () => {
  const path = fixture();
  const dir = join(path, "..");

  assert.equal(sourceContext(join(dir, "missing.js"), 3, 2), null);
  assert.equal(sourceContext(dir, 3, 2), null);
  assert.equal(sourceContext(path, 99, 2), null);
  assert.equal(sourceContext(path, 0, 2), null);
  assert.equal(sourceContext(null, 3, 2), null);
  assert.equal(sourceContext(path, 3, 0), null);
  assert.equal(sourceContext("node:internal/process/task_queues", 3, 2), null);
});

test("sourceContext re-reads a file that changed", () => {
  const path = fixture();
  assert.equal(sourceContext(path, 5, 1)?.context_line, "line 5");

  const body = Array.from({ length: 10 }, (_, i) => `changed ${i + 1}`).join("\n");
  writeFileSync(path, `${body}\n`);
  const later = new Date(Date.now() + 2000);
  utimesSync(path, later, later);

  assert.equal(sourceContext(path, 5, 1)?.context_line, "changed 5");
});

test("sourceContext truncates very long lines", () => {
  const path = fixture();
  writeFileSync(path, `${"x".repeat(MAX_LINE_LENGTH + 500)}\n`);
  const later = new Date(Date.now() + 2000);
  utimesSync(path, later, later);

  assert.equal(sourceContext(path, 1, 1)?.context_line.length, MAX_LINE_LENGTH);
});

test("sourceContext skips oversized files", () => {
  const path = fixture();
  writeFileSync(path, "a\n".repeat(512 * 1024));
  const later = new Date(Date.now() + 2000);
  utimesSync(path, later, later);

  assert.equal(sourceContext(path, 1, 1), null);
});

test("sourceContext keeps CRLF sources clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "splatty-linecache-"));
  const path = join(dir, "crlf.js");
  writeFileSync(path, "one\r\ntwo\r\nthree\r\n");

  assert.deepEqual(sourceContext(path, 2, 1), {
    pre_context: ["one"],
    context_line: "two",
    post_context: ["three"],
  });
});
