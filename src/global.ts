import type { Client } from "./client.js";
import type { Configuration } from "./configuration.js";
import type { LogAppender } from "./log-appender.js";

/**
 * Process-wide state, kept in its own module so integrations can reach the
 * active client without importing `index.ts` (which imports them back).
 */
let currentClient: Client | null = null;
let currentAppender: LogAppender | null = null;

export function getClient(): Client | null {
  return currentClient;
}

export function setClient(client: Client | null): void {
  currentClient = client;
}

export function getConfiguration(): Configuration | null {
  return currentClient?.configuration ?? null;
}

export function isEnabled(): boolean {
  return currentClient !== null && currentClient.configuration.isEnabled();
}

export function getLogAppender(): LogAppender | null {
  return currentAppender;
}

export function setLogAppender(appender: LogAppender | null): void {
  currentAppender = appender;
}
