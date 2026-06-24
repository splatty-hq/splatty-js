import type { EventPayload } from "./types";

export interface ConfigurationOptions {
  url?: string;
  dsn?: string;
  environment?: string;
  release?: string;
  enabled?: boolean;
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

export const DEFAULT_URL = "https://splatty.k0va1.dev";

export class Configuration {
  url: string;
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  enabled: boolean;
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
    this.serverName = options.serverName;
    this.openTimeoutMs = options.openTimeoutMs ?? 5_000;
    this.readTimeoutMs = options.readTimeoutMs ?? 10_000;
    this.logger = options.logger ?? null;
    this.beforeSend = options.beforeSend;
  }

  validate(): void {
    if (!this.enabled) return;
    if (!this.url) throw new MissingConfigError("config.url is required");
    if (!this.dsn) throw new MissingConfigError("config.dsn is required");
    let parsed: URL;
    try {
      parsed = new URL(this.url);
    } catch (e) {
      throw new InvalidDsnError((e as Error).message);
    }
    if (!parsed.host) {
      throw new InvalidDsnError("config.url must include scheme + host");
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
