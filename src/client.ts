import { Configuration } from "./configuration.js";
import { Transport } from "./transport.js";
import { Scrubber } from "./scrubber.js";
import { buildExceptionEvent, buildMessageEvent } from "./event.js";
import type { EventPayload, Scope } from "./types.js";

export class Client {
  readonly configuration: Configuration;
  readonly transport: Transport;
  private readonly scrubber: Scrubber;

  constructor(configuration: Configuration) {
    this.configuration = configuration;
    this.transport = new Transport(configuration);
    this.scrubber = new Scrubber(configuration);
  }

  async captureException(err: unknown, scope: Scope = {}): Promise<string | null> {
    const event = this.process(buildExceptionEvent(err, this.configuration, scope));
    if (!event) return null;
    await this.transport.sendEnvelope(event);
    return event.event_id;
  }

  async captureMessage(
    message: string,
    options: { level?: string; scope?: Scope } = {},
  ): Promise<string | null> {
    const { level = "info", scope = {} } = options;
    const event = this.process(
      buildMessageEvent(message, this.configuration, level, scope),
    );
    if (!event) return null;
    await this.transport.sendEnvelope(event);
    return event.event_id;
  }

  close(): void {
    this.transport.close();
  }

  private process(event: EventPayload): EventPayload | null {
    return this.filter(this.scrubber.scrub(event));
  }

  private filter(event: EventPayload): EventPayload | null {
    const hook = this.configuration.beforeSend;
    if (!hook) return event;
    return hook(event) ?? null;
  }
}
