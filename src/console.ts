import { format } from "node:util";
import { captureLog } from "./log-appender.js";

type ConsoleMethod = "debug" | "info" | "log" | "warn" | "error" | "trace";

const METHODS: ConsoleMethod[] = ["debug", "info", "log", "warn", "error", "trace"];

const LEVELS: Record<ConsoleMethod, string> = {
  debug: "debug",
  info: "info",
  log: "info",
  warn: "warn",
  error: "error",
  trace: "debug",
};

export interface ConsoleCaptureOptions {
  /** Which console methods to forward. Defaults to all of them. */
  methods?: ConsoleMethod[];
}

let uninstall: (() => void) | null = null;
// Guards against a feedback loop: the transport logs its own failures to
// console, which would otherwise be captured and shipped again.
let reentrant = false;

/**
 * Patches the global `console` so anything logged through it is forwarded to
 * Splatty. Returns a function that restores the original methods.
 */
export function installConsoleCapture(options: ConsoleCaptureOptions = {}): () => void {
  if (uninstall) return uninstall;

  const methods = options.methods ?? METHODS;
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

  for (const method of methods) {
    const original = console[method] as ((...args: unknown[]) => void) | undefined;
    if (typeof original !== "function") continue;
    originals.set(method, original);

    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]): void => {
      if (!reentrant) {
        reentrant = true;
        try {
          captureLog({
            level: LEVELS[method],
            message: format(...args),
            fields: { logger: "console" },
          });
        } catch {
          // Never let capture break the caller's logging.
        } finally {
          reentrant = false;
        }
      }
      original.apply(console, args);
    };
  }

  uninstall = () => {
    for (const [method, original] of originals) {
      (console as unknown as Record<string, unknown>)[method] = original;
    }
    uninstall = null;
  };
  return uninstall;
}

export function uninstallConsoleCapture(): void {
  uninstall?.();
}
