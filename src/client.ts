import { Configuration } from "./configuration";
import { Transport } from "./transport";
import { buildExceptionEvent, buildMessageEvent } from "./event";
import type { Scope } from "./types";

export class Client {
  readonly configuration: Configuration;
  readonly transport: Transport;

  constructor(configuration: Configuration) {
    this.configuration = configuration;
    this.transport = new Transport(configuration);
  }

  async captureException(err: unknown, scope: Scope = {}): Promise<string | null> {
    let event = buildExceptionEvent(err, this.configuration, scope);
    const filtered = this.filter(event);
    if (!filtered) return null;
    event = filtered;
    await this.transport.sendEnvelope(event);
    return event.event_id;
  }

  async captureMessage(
    message: string,
    options: { level?: string; scope?: Scope } = {},
  ): Promise<string | null> {
    const { level = "info", scope = {} } = options;
    let event = buildMessageEvent(message, this.configuration, level, scope);
    const filtered = this.filter(event);
    if (!filtered) return null;
    event = filtered;
    await this.transport.sendEnvelope(event);
    return event.event_id;
  }

  close(): void {
    this.transport.close();
  }

  private filter(event: ReturnType<typeof buildExceptionEvent>) {
    const hook = this.configuration.beforeSend;
    if (!hook) return event;
    return hook(event) ?? null;
  }
}
