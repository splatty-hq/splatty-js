import * as splatty from "../src/index.js";
import type { EventPayload, LogEntry } from "../src/types.js";
import type { InitOptions } from "../src/index.js";

export interface Harness {
  events: EventPayload[];
  logBatches: Array<{ host: string; logs: LogEntry[] }>;
}

const silentLogger = { warn: () => {} };

/**
 * Boots Splatty with its transport stubbed out, so tests can assert on the
 * payloads that would have gone over the wire.
 */
export async function startSplatty(overrides: Partial<InitOptions> = {}): Promise<Harness> {
  await splatty.close();
  splatty.init({
    url: "http://example.com",
    dsn: "abc",
    environment: "test",
    logs: false,
    logger: silentLogger,
    ...overrides,
  });

  const harness: Harness = { events: [], logBatches: [] };
  const transport = splatty.client()!.transport as unknown as {
    sendEnvelope: (event: EventPayload) => Promise<null>;
    sendLogs: (host: string, logs: LogEntry[]) => Promise<null>;
  };
  transport.sendEnvelope = async (event) => {
    harness.events.push(event);
    return null;
  };
  transport.sendLogs = async (host, logs) => {
    harness.logBatches.push({ host, logs });
    return null;
  };
  return harness;
}

export async function stopSplatty(): Promise<void> {
  await splatty.close();
}

export function buildConfiguration(
  overrides: Partial<ConstructorParameters<typeof splatty.Configuration>[0]> = {},
): splatty.Configuration {
  const config = new splatty.Configuration({
    url: "http://localhost:3000",
    dsn: "abc123",
    environment: "test",
    release: "0.0.1",
    logger: silentLogger,
    ...overrides,
  });
  config.validate();
  return config;
}
