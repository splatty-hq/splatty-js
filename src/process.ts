import { captureException } from "./capture.js";
import { isEnabled } from "./global.js";
import { flushLogs } from "./log-appender.js";

export interface ProcessHandlerOptions {
  /**
   * After the event is shipped, restore Node's default behaviour (print the
   * error and exit 1) when Splatty is the only listener for that event.
   * Leaving this on keeps crash semantics unchanged. Defaults to true.
   */
  exit?: boolean;
}

function listenerCount(event: string): number {
  return (process as unknown as { listenerCount(e: string): number }).listenerCount(event);
}

let uninstall: (() => void) | null = null;

/**
 * Reports crashes that escape every other integration — the Node counterpart
 * of the Ruby SDK's Solid Queue thread-error hook.
 */
export function installProcessHandlers(
  options: ProcessHandlerOptions = {},
): () => void {
  if (uninstall) return uninstall;
  const exit = options.exit ?? true;

  const report = async (
    err: unknown,
    mechanism: "uncaughtException" | "unhandledRejection",
    level: string,
  ): Promise<void> => {
    if (isEnabled()) {
      try {
        await captureException(err, { level, tags: { mechanism } });
        await flushLogs();
      } catch {
        // A failure to report must not mask the original crash.
      }
    }
    if (exit && listenerCount(mechanism) <= 1) {
      console.error(err);
      process.exit(1);
    }
  };

  const onUncaughtException = (err: unknown): void => {
    void report(err, "uncaughtException", "fatal");
  };

  const onUnhandledRejection = (reason: unknown): void => {
    void report(reason, "unhandledRejection", "error");
  };

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  uninstall = () => {
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
    uninstall = null;
  };
  return uninstall;
}

export function uninstallProcessHandlers(): void {
  uninstall?.();
}
