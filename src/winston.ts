import { Writable } from "node:stream";
import { captureLog } from "./log-appender.js";

interface WinstonInfo {
  level?: string;
  message?: unknown;
  timestamp?: string | number;
  [key: string]: unknown;
}

export interface SplattyWinstonTransportOptions {
  level?: string;
  silent?: boolean;
}

const RESERVED = new Set(["level", "message", "timestamp"]);

/**
 * A winston transport that forwards every entry to Splatty.
 *
 * ```ts
 * const logger = winston.createLogger({
 *   transports: [new winston.transports.Console(), new SplattyTransport()],
 * });
 * ```
 */
export class SplattyTransport extends Writable {
  level: string | undefined;
  silent: boolean;

  constructor(options: SplattyWinstonTransportOptions = {}) {
    super({ objectMode: true });
    this.level = options.level;
    this.silent = options.silent ?? false;
  }

  log(info: WinstonInfo, next?: () => void): void {
    if (!this.silent) {
      // Winston decorates `info` with symbol keys (level, message, splat);
      // Object.keys skips them, which is what we want in `fields`.
      const fields: Record<string, unknown> = {};
      for (const key of Object.keys(info)) {
        if (RESERVED.has(key)) continue;
        fields[key] = info[key];
      }

      captureLog({
        time: info.timestamp,
        level: info.level,
        message: typeof info.message === "string" ? info.message : String(info.message ?? ""),
        fields,
      });
    }
    next?.();
    this.emit("logged", info);
  }

  override _write(
    info: WinstonInfo,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.log(info);
    callback();
  }
}
