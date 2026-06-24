import { gzipSync } from "node:zlib";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { VERSION } from "./version";
import type { Configuration } from "./configuration";
import type { EventPayload, LogEntry } from "./types";

export const SDK_NAME = "splatty.js";
const KEEP_ALIVE_TIMEOUT_MS = 60_000;

const httpAgent = new HttpAgent({ keepAlive: true, keepAliveMsecs: KEEP_ALIVE_TIMEOUT_MS });
const httpsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: KEEP_ALIVE_TIMEOUT_MS });

interface PostResult {
  status: number;
  body: string;
}

export class Transport {
  private readonly configuration: Configuration;

  constructor(configuration: Configuration) {
    this.configuration = configuration;
  }

  async sendEnvelope(event: EventPayload): Promise<PostResult | null> {
    const body = this.serializeEnvelope(event);
    return this.post(body);
  }

  async sendLogs(host: string, logs: LogEntry[]): Promise<PostResult | null> {
    if (!logs.length) return null;
    const body = this.serializeLogEnvelope(host, logs);
    return this.post(body);
  }

  close(): void {
    httpAgent.destroy();
    httpsAgent.destroy();
  }

  private envelopeHeaders(contentLength: number): Record<string, string> {
    return {
      "Content-Type": "application/x-splatty-envelope",
      "Authorization": `Bearer ${this.configuration.dsnKey()}`,
      "User-Agent": `${SDK_NAME}/${VERSION}`,
      "Content-Encoding": "gzip",
      "Content-Length": String(contentLength),
    };
  }

  private serializeEnvelope(event: EventPayload): string {
    const header = {
      event_id: event.event_id,
      sent_at: new Date().toISOString(),
      dsn: this.configuration.dsn,
      sdk: { name: SDK_NAME, version: VERSION },
    };
    const itemPayload = JSON.stringify(event);
    const itemHeader = {
      type: "event",
      content_type: "application/json",
      length: Buffer.byteLength(itemPayload, "utf8"),
    };
    return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${itemPayload}`;
  }

  private serializeLogEnvelope(host: string, logs: LogEntry[]): string {
    const header = {
      sent_at: new Date().toISOString(),
      dsn: this.configuration.dsn,
      sdk: { name: SDK_NAME, version: VERSION },
    };
    const itemPayload = JSON.stringify({ host, items: logs });
    const itemHeader = {
      type: "log",
      item_count: logs.length,
      content_type: "application/vnd.splatty.items.log+json",
      length: Buffer.byteLength(itemPayload, "utf8"),
    };
    return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${itemPayload}`;
  }

  private post(body: string): Promise<PostResult | null> {
    const url = new URL(this.configuration.envelopeUrl());
    const compressed = gzipSync(Buffer.from(body, "utf8"));
    const isHttps = url.protocol === "https:";
    const reqFn = isHttps ? httpsRequest : httpRequest;
    const agent = isHttps ? httpsAgent : httpAgent;

    return new Promise((resolve) => {
      const req = reqFn(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          method: "POST",
          path: `${url.pathname}${url.search}`,
          headers: this.envelopeHeaders(compressed.length),
          agent,
          timeout: this.configuration.readTimeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      const fail = (err: Error) => {
        this.logFailure(url, err);
        resolve(null);
      };

      req.on("error", fail);
      req.on("timeout", () => {
        req.destroy(new Error("request timed out"));
      });
      req.setTimeout(this.configuration.readTimeoutMs);
      req.write(compressed);
      req.end();
    });
  }

  private logFailure(url: URL, error: Error): void {
    const msg = `[splatty] transport failure ${url.toString()} ${error.name}: ${error.message}`;
    const logger = this.configuration.logger;
    if (logger) logger.warn(msg);
    else console.warn(msg);
  }
}
