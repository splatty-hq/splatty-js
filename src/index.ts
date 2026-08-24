import { Configuration } from "./configuration.js";
import type { ConfigurationOptions } from "./configuration.js";
import { Client } from "./client.js";
import {
  getClient,
  getConfiguration,
  getLogAppender,
  isEnabled,
  setClient,
  setLogAppender,
} from "./global.js";
import { LogAppender } from "./log-appender.js";
import type { LogAppenderOptions } from "./log-appender.js";
import { installConsoleCapture } from "./console.js";
import { installProcessHandlers } from "./process.js";

export { Configuration, InvalidDsnError, MissingConfigError, DEFAULT_URL } from "./configuration.js";
export type { ConfigurationOptions } from "./configuration.js";
export { Client } from "./client.js";
export { Transport, SDK_NAME } from "./transport.js";
export type { PostResult } from "./transport.js";
export { Scrubber, FILTERED, SENSITIVE_HEADER_PATTERN } from "./scrubber.js";
export { buildExceptionEvent, buildMessageEvent } from "./event.js";
export { captureException, captureMessage } from "./capture.js";
export { encodeArgs, MAX_ARGS_LENGTH } from "./jobs.js";
export {
  LogAppender,
  captureLog,
  flushLogs,
  mapLevel,
  INTAKE_PATH_PATTERN,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_QUEUE_LIMIT,
} from "./log-appender.js";
export type { LogAppenderOptions } from "./log-appender.js";
export { installConsoleCapture, uninstallConsoleCapture } from "./console.js";
export { installProcessHandlers, uninstallProcessHandlers } from "./process.js";
export type { ProcessHandlerOptions } from "./process.js";
export { captureJobException, jobScope, instrumentWorker } from "./bullmq.js";
export type { JobContext, BullMQJob, BullMQWorker, BullMQOptions } from "./bullmq.js";
export { VERSION } from "./version.js";
export type {
  Level,
  Scope,
  RequestContext,
  StackFrame,
  ExceptionValue,
  EventPayload,
  LogRecord,
  LogEntry,
} from "./types.js";

export interface InitOptions extends ConfigurationOptions {
  /** Tuning for the log appender installed when `logs` is on. */
  logOptions?: LogAppenderOptions;
}

let teardowns: Array<() => void> = [];

/**
 * Configures the SDK and installs the integrations enabled by the config.
 * Accepts an options object or a Ruby-style configure block.
 */
export function init(
  options: InitOptions | ((config: Configuration) => void) = {},
): Client {
  uninstallIntegrations();

  let configuration: Configuration;
  let logOptions: LogAppenderOptions | undefined;
  if (typeof options === "function") {
    configuration = new Configuration();
    options(configuration);
  } else {
    const { logOptions: opts, ...rest } = options;
    logOptions = opts;
    configuration = new Configuration(rest);
  }
  configuration.validate();

  const created = new Client(configuration);
  setClient(created);

  if (configuration.isEnabled()) {
    if (configuration.logs) installLogAppender(logOptions);
    if (configuration.captureConsole) teardowns.push(installConsoleCapture());
    if (configuration.captureUnhandled) teardowns.push(installProcessHandlers());
  }

  return created;
}

export function client(): Client | null {
  return getClient();
}

export function configuration(): Configuration | null {
  return getConfiguration();
}

export function enabled(): boolean {
  return isEnabled();
}

export function logAppender(): LogAppender | null {
  return getLogAppender();
}

/** Ships anything the log appender still has queued. */
export function flush(): Promise<void> {
  return getLogAppender()?.flush() ?? Promise.resolve();
}

/** Flushes pending logs, removes the installed integrations and drops the client. */
export async function close(): Promise<void> {
  uninstallIntegrations();

  const appender = getLogAppender();
  if (appender) {
    // Close before dropping the client so the final batch can still be sent.
    await appender.close();
    setLogAppender(null);
  }

  getClient()?.close();
  setClient(null);
}

function installLogAppender(options?: LogAppenderOptions): void {
  if (getLogAppender()) return;
  setLogAppender(new LogAppender(options));
}

function uninstallIntegrations(): void {
  for (const teardown of teardowns) {
    try {
      teardown();
    } catch {
      // Best effort — a failed teardown must not block the rest.
    }
  }
  teardowns = [];
}
