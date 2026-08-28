import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { SDK_NAME } from "./transport.js";
import { VERSION } from "./version.js";
import type { Configuration } from "./configuration.js";
import type { EventPayload, Scope, StackFrame, ExceptionValue } from "./types.js";
import { sourceContext } from "./line-cache.js";

const APP_ROOT = process.cwd();
const APP_ROOT_PREFIXES = ["/app/", `${APP_ROOT}/`];

function inApp(path: string | null): boolean {
  if (!path) return false;
  const hit = APP_ROOT_PREFIXES.some((p) => path.startsWith(p));
  return hit && !path.includes("/node_modules/");
}

function shortFilename(path: string | null): string | null {
  if (!path) return path;
  for (const prefix of APP_ROOT_PREFIXES) {
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  return path;
}

const FRAME_AT = /^\s*at\s+(?:(.*?)\s+\()?(.+?)(?::(\d+))(?::(\d+))?\)?$/;

function parseStack(
  stack: string | undefined,
  contextLines: number,
): StackFrame[] {
  if (!stack) return [];
  const lines = stack.split("\n").slice(1);
  const frames: StackFrame[] = [];
  for (const raw of lines) {
    const m = raw.match(FRAME_AT);
    if (!m) continue;
    const fn = m[1] ? m[1].trim() : null;
    const file = m[2] ?? null;
    const lineno = m[3] ? Number(m[3]) : null;
    const colno = m[4] ? Number(m[4]) : null;
    const abs = file?.startsWith("file://") ? file.slice("file://".length) : file;
    const frame: StackFrame = {
      filename: shortFilename(abs),
      abs_path: abs,
      function: fn,
      lineno,
      colno,
      in_app: inApp(abs),
    };
    const context = sourceContext(abs, lineno, contextLines);
    if (context) Object.assign(frame, context);
    frames.push(frame);
  }
  return frames.reverse();
}

function exceptionValue(err: Error, contextLines: number): ExceptionValue {
  return {
    type: err.name || "Error",
    value: typeof err.message === "string" ? err.message : String(err.message),
    stacktrace: { frames: parseStack(err.stack, contextLines) },
  };
}

function nonErrorValue(current: unknown): ExceptionValue {
  let value: string;
  if (typeof current === "string") {
    value = current;
  } else {
    try {
      value = JSON.stringify(current) ?? String(current);
    } catch {
      value = String(current);
    }
  }
  return { type: "NonError", value, stacktrace: { frames: [] } };
}

function exceptionChain(err: unknown, contextLines: number): ExceptionValue[] {
  const chain: ExceptionValue[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      chain.unshift(exceptionValue(current, contextLines));
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      chain.unshift(nonErrorValue(current));
      break;
    }
  }
  return chain;
}

function basePayload(
  configuration: Configuration,
  scope: Scope,
): Omit<EventPayload, "level"> {
  const payload: Omit<EventPayload, "level"> = {
    event_id: randomBytes(16).toString("hex"),
    timestamp: new Date().toISOString(),
    platform: "node",
    environment: configuration.environment,
    server_name: configuration.serverName || hostname(),
    sdk: { name: SDK_NAME, version: VERSION },
    tags: scope.tags ?? {},
    extra: scope.extra ?? {},
    contexts: {
      runtime: { name: "node", version: process.version },
      ...(scope.contexts ?? {}),
    },
  };
  if (configuration.release) payload.release = configuration.release;
  if (scope.transaction) payload.transaction = scope.transaction;
  if (scope.request) payload.request = scope.request;
  return payload;
}

export function buildExceptionEvent(
  err: unknown,
  configuration: Configuration,
  scope: Scope = {},
): EventPayload {
  return {
    ...basePayload(configuration, scope),
    level: String(scope.level ?? "error"),
    exception: { values: exceptionChain(err, configuration.contextLines) },
  };
}

export function buildMessageEvent(
  message: string,
  configuration: Configuration,
  level: string = "info",
  scope: Scope = {},
): EventPayload {
  return {
    ...basePayload(configuration, scope),
    level,
    message: { formatted: String(message) },
  };
}
