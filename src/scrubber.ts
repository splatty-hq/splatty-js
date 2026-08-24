import type { Configuration } from "./configuration.js";
import type { EventPayload } from "./types.js";

export const FILTERED = "[Filtered]";
export const SENSITIVE_HEADER_PATTERN =
  /authoriz|cookie|csrf|xsrf|secret|token|password|api[-_]?key|session/i;

/**
 * Strips sensitive request headers from an event before it leaves the process.
 * Disabled wholesale by `config.sendDefaultPii`.
 */
export class Scrubber {
  private readonly configuration: Configuration;

  constructor(configuration: Configuration) {
    this.configuration = configuration;
  }

  scrub(event: EventPayload): EventPayload {
    if (this.configuration.sendDefaultPii) return event;
    if (!event || typeof event !== "object") return event;

    const request = event.request;
    if (request && typeof request === "object") {
      this.scrubHeaders(request.headers);
    }
    return event;
  }

  private scrubHeaders(headers: Record<string, string> | undefined): void {
    if (!headers || typeof headers !== "object") return;

    for (const name of Object.keys(headers)) {
      if (SENSITIVE_HEADER_PATTERN.test(name)) headers[name] = FILTERED;
    }
  }
}
