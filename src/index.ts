import { Configuration } from "./configuration";
import type { ConfigurationOptions } from "./configuration";
import { Client } from "./client";
import type { Scope } from "./types";

export { Configuration, InvalidDsnError, MissingConfigError } from "./configuration";
export type { ConfigurationOptions } from "./configuration";
export { Client } from "./client";
export { Transport, SDK_NAME } from "./transport";
export { buildExceptionEvent, buildMessageEvent } from "./event";
export { VERSION } from "./version";
export type {
  Level,
  Scope,
  RequestContext,
  StackFrame,
  ExceptionValue,
  EventPayload,
  LogEntry,
} from "./types";

let currentClient: Client | null = null;

export function init(
  options: ConfigurationOptions | ((config: Configuration) => void) = {},
): Client {
  let configuration: Configuration;
  if (typeof options === "function") {
    configuration = new Configuration();
    options(configuration);
  } else {
    configuration = new Configuration(options);
  }
  configuration.validate();
  currentClient = new Client(configuration);
  return currentClient;
}

export function client(): Client | null {
  return currentClient;
}

export function configuration(): Configuration | null {
  return currentClient?.configuration ?? null;
}

export function enabled(): boolean {
  return currentClient !== null && currentClient.configuration.isEnabled();
}

export async function captureException(
  err: unknown,
  scope: Scope = {},
): Promise<string | null> {
  if (!enabled()) return null;
  return currentClient!.captureException(err, scope);
}

export async function captureMessage(
  message: string,
  options: { level?: string; scope?: Scope } = {},
): Promise<string | null> {
  if (!enabled()) return null;
  return currentClient!.captureMessage(message, options);
}

export function close(): void {
  currentClient?.close();
  currentClient = null;
}
