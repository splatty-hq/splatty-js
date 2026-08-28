import type { EventPayload } from "./types.js";

export interface ConfigurationOptions {
  url?: string;
  dsn?: string;
  environment?: string;
  release?: string;
  enabled?: boolean;
  /** Ship logs through the batching appender (mirrors Ruby's `config.logs`). */
  logs?: boolean;
  /** Patch the global `console` so its output is forwarded as logs. */
  captureConsole?: boolean;
  /** Install `uncaughtException` / `unhandledRejection` handlers on `process`. */
  captureUnhandled?: boolean;
  /** Send request headers verbatim instead of filtering the sensitive ones. */
  sendDefaultPii?: boolean;
  /** Source lines to send either side of a stack frame. 0 disables. */
  contextLines?: number;
  serverName?: string;
  openTimeoutMs?: number;
  readTimeoutMs?: number;
  logger?: Pick<Console, "warn"> | null;
  beforeSend?: (event: EventPayload) => EventPayload | null | undefined;
}

export class InvalidDsnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDsnError";
  }
}

export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

export const DEFAULT_URL = "https://splatty.app";

export class Configuration {
  url: string;
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  enabled: boolean;
  logs: boolean;
  captureConsole: boolean;
  captureUnhandled: boolean;
  sendDefaultPii: boolean;
  contextLines: number;
  serverName: string | undefined;
  openTimeoutMs: number;
  readTimeoutMs: number;
  logger: Pick<Console, "warn"> | null;
  beforeSend: ConfigurationOptions["beforeSend"];

  constructor(options: ConfigurationOptions = {}) {
    this.url = options.url ?? process.env.SPLATTY_URL ?? DEFAULT_URL;
    this.dsn = options.dsn ?? process.env.SPLATTY_DSN;
    this.environment =
      options.environment ??
      process.env.NODE_ENV ??
      process.env.RAILS_ENV ??
      "development";
    this.release = options.release ?? process.env.SPLATTY_RELEASE;
    this.enabled = options.enabled ?? true;
    this.logs = options.logs ?? true;
    this.captureConsole = options.captureConsole ?? false;
    this.captureUnhandled = options.captureUnhandled ?? false;
    this.sendDefaultPii = options.sendDefaultPii ?? false;
    this.contextLines = options.contextLines ?? 5;
    this.serverName = options.serverName;
    this.openTimeoutMs = options.openTimeoutMs ?? 5_000;
    this.readTimeoutMs = options.readTimeoutMs ?? 10_000;
    this.logger = options.logger ?? null;
    this.beforeSend = options.beforeSend;
  }

  validate(): void {
    if (!this.enabled) return;
    if (!this.url) return this.disable("config.url is required");
    if (!this.dsn) return this.disable("config.dsn is required");
    let parsed: URL;
    try {
      parsed = new URL(this.url);
    } catch (e) {
      return this.disable(`config.url is invalid: ${(e as Error).message}`);
    }
    if (!parsed.host) {
      return this.disable("config.url must include scheme + host");
    }
  }

  disable(message: string): void {
    this.enabled = false;
    const full = `[Splatty] disabled: ${message}`;
    if (this.logger) {
      this.logger.warn(full);
    } else {
      console.warn(full);
    }
  }

  isEnabled(): boolean {
    return this.enabled && !!this.dsn && !!this.url;
  }

  envelopeUrl(): string {
    return `${this.url.replace(/\/+$/, "")}/api/envelope`;
  }

  dsnKey(): string {
    return this.dsn ?? "";
  }
}
