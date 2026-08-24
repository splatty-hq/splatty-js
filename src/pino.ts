import { captureLog } from "./log-appender.js";

const PINO_LEVELS: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

export interface PinoStreamOptions {
  /** Key pino writes the message under. Defaults to pino's own `msg`. */
  messageKey?: string;
  /** Extra keys to drop from `fields` (`pid` and `hostname` are always dropped). */
  ignore?: string[];
}

const ALWAYS_IGNORED = ["pid", "hostname", "level", "time"];

/**
 * A pino destination that forwards every line to Splatty.
 *
 * ```ts
 * const logger = pino({ level: "info" }, pino.multistream([
 *   { stream: process.stdout },
 *   { stream: splattyStream() },
 * ]));
 * ```
 */
export function splattyStream(
  options: PinoStreamOptions = {},
): { write(chunk: string): void } {
  const messageKey = options.messageKey ?? "msg";
  const ignored = new Set([...ALWAYS_IGNORED, messageKey, ...(options.ignore ?? [])]);

  return {
    write(chunk: string): void {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(chunk) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;

      const rawLevel = parsed["level"];
      const level =
        typeof rawLevel === "number"
          ? (PINO_LEVELS[rawLevel] ?? "info")
          : String(rawLevel ?? "info");

      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (ignored.has(key)) continue;
        fields[key] = value;
      }

      captureLog({
        time: parsed["time"] as number | string | undefined,
        level,
        message: String(parsed[messageKey] ?? ""),
        fields,
      });
    },
  };
}
