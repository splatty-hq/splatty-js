import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { SDK_NAME } from "./transport";
import { VERSION } from "./version";
import type { Configuration } from "./configuration";
import type { EventPayload, Scope, StackFrame, ExceptionValue } from "./types";

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

function parseStack(stack: string | undefined): StackFrame[] {
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
    frames.push({
      filename: shortFilename(abs),
      abs_path: abs,
      function: fn,
      lineno,
      colno,
      in_app: inApp(abs),
    });
  }
  return frames.reverse();
}

function exceptionValue(err: Error): ExceptionValue {
  return {
    type: err.name || "Error",
    value: typeof err.message === "string" ? err.message : String(err.message),
    stacktrace: { frames: parseStack(err.stack) },
  };
}

function exceptionChain(err: unknown): ExceptionValue[] {
  const chain: ExceptionValue[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      chain.unshift(exceptionValue(current));
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      chain.unshift({
        type: "NonError",
        value: typeof current === "string" ? current : JSON.stringify(current),
        stacktrace: { frames: [] },
      });
      break;
    }
  }
  return chain;
}

function basePayload(configuration: Configuration, scope: Scope): Omit<EventPayload, "level"> {
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
    request: scope.request ?? null,
  };
  if (configuration.release) payload.release = configuration.release;
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
    exception: { values: exceptionChain(err) },
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
