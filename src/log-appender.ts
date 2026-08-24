import { hostname } from "node:os";
import { inspect } from "node:util";
import {
  getClient,
  getConfiguration,
  getLogAppender,
  isEnabled,
} from "./global.js";
import type { LogEntry, LogRecord } from "./types.js";

export const DEFAULT_BATCH_SIZE = 100;
export const DEFAULT_FLUSH_INTERVAL_MS = 15_000;
export const DEFAULT_QUEUE_LIMIT = 5_000;

/**
 * Drop log entries describing requests to Splatty's own intake endpoints.
 * Without this, dogfooded apps (the Splatty server logging to itself) generate
 * a positive feedback loop: every shipped batch becomes a new set of request
 * logs, which become another batch, etc.
 */
export const INTAKE_PATH_PATTERN = /^\/api\/(?:\d+\/)?(?:logs|metrics|envelope)\/?$/;

const LEVEL_ORDER: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export function mapLevel(level: string | undefined): string {
  switch (String(level ?? "").toLowerCase()) {
    case "trace":
    case "debug":
    case "verbose":
      return "debug";
    case "info":
    case "http":
    case "log":
      return "info";
    case "warn":
    case "warning":
      return "warn";
    case "error":
      return "error";
    case "fatal":
    case "crit":
    case "critical":
    case "alert":
    case "emerg":
      return "fatal";
    default:
      return "info";
  }
}

export interface LogAppenderOptions {
  /** Minimum level to ship; anything below is dropped. */
  level?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  queueLimit?: number;
  host?: string;
}

/**
 * Buffers log entries and ships them as `log` envelope items on an interval.
 * The Node counterpart of the Ruby SDK's SemanticLogger appender.
 */
export class LogAppender {
  readonly host: string;
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  readonly queueLimit: number;
  readonly level: string | undefined;

  private queue: LogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: LogAppenderOptions = {}) {
    this.level = options.level ? mapLevel(options.level) : undefined;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT;
    this.host = options.host ?? hostname();
    this.startTimer();
  }

  /** Enqueue a record. Returns false when the entry was dropped. */
  log(record: LogRecord): boolean {
    if (this.closed) return false;
    if (!isEnabled()) return false;
    if (this.intakeRequest(record)) return false;
    const entry = this.buildEntry(record);
    if (!this.passesLevel(entry.level)) return false;
    if (this.queue.length >= this.queueLimit) this.queue.shift();
    this.queue.push(entry);
    if (this.queue.length >= this.batchSize) void this.flush();
    return true;
  }

  /** Ship everything currently queued. */
  flush(): Promise<void> {
    this.pending = this.pending.then(() => this.drain()).catch(() => undefined);
    return this.pending;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopTimer();
    await this.flush();
  }

  get size(): number {
    return this.queue.length;
  }

  private passesLevel(level: string): boolean {
    if (!this.level) return true;
    return (LEVEL_ORDER[level] ?? 20) >= (LEVEL_ORDER[this.level] ?? 0);
  }

  private intakeRequest(record: LogRecord): boolean {
    const fields = record.fields;
    if (!fields) return false;
    const path = fields["path"];
    if (typeof path !== "string" || path === "") return false;
    return INTAKE_PATH_PATTERN.test(path);
  }

  private startTimer(): void {
    if (this.timer || this.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    // Never hold the event loop open just to flush logs.
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async drain(): Promise<void> {
    const maxBatch = this.batchSize * 4;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, maxBatch);
      await this.dispatch(batch);
    }
  }

  private async dispatch(batch: LogEntry[]): Promise<void> {
    const client = getClient();
    if (!client || !client.configuration.isEnabled()) return;
    await client.transport.sendLogs(this.host, batch);
  }

  private buildEntry(record: LogRecord): LogEntry {
    const configuration = getConfiguration();
    const fields = stringifyFields(record.fields ?? {});
    return {
      timestamp: toEpochMs(record.time),
      level: mapLevel(record.level),
      message: buildMessage(record.message ?? "", fields),
      request_id: extractString(fields, "request_id"),
      method: extractString(fields, "method"),
      path: extractString(fields, "path"),
      status: extractInt(fields, "status"),
      duration_ms:
        extractFloat(fields, "duration_ms") ?? extractFloat(fields, "duration"),
      controller: extractString(fields, "controller"),
      action: extractString(fields, "action"),
      environment: configuration?.environment ?? "",
      release: configuration?.release ?? "",
      host: this.host,
      fields,
    };
  }
}

function buildMessage(message: string, fields: Record<string, string>): string {
  const sql = (fields["sql"] ?? "").trim();
  if (!sql) return message;
  return message === "" ? sql : `${message} — ${sql}`;
}

function toEpochMs(time: LogRecord["time"]): number {
  if (time instanceof Date) return time.getTime();
  if (typeof time === "number") return Math.trunc(time);
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function stringifyFields(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    out[String(key)] =
      typeof value === "string"
        ? value
        : inspect(value, { depth: 2, breakLength: Infinity });
  }
  return out;
}

function extractString(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  delete fields[key];
  return value ?? "";
}

function extractInt(fields: Record<string, string>, key: string): number {
  const value = fields[key];
  delete fields[key];
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function extractFloat(fields: Record<string, string>, key: string): number | null {
  if (!(key in fields)) return null;
  const value = fields[key];
  delete fields[key];
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Enqueue a record on the appender installed by `init()`. Returns false when
 * logging is disabled or the entry was dropped.
 */
export function captureLog(record: LogRecord): boolean {
  const appender = getLogAppender();
  if (!appender) return false;
  return appender.log(record);
}

/** Ship everything the installed appender has queued. */
export function flushLogs(): Promise<void> {
  return getLogAppender()?.flush() ?? Promise.resolve();
}
