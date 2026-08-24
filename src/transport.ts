import { gzipSync } from "node:zlib";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { VERSION } from "./version.js";
import type { Configuration } from "./configuration.js";
import type { EventPayload, LogEntry } from "./types.js";

export const SDK_NAME = "splatty.js";
const KEEP_ALIVE_TIMEOUT_MS = 60_000;

export interface PostResult {
  status: number;
  body: string;
}

export class Transport {
  private readonly configuration: Configuration;
  // Per-transport pools, so closing one client cannot tear down another's
  // keep-alive connections.
  private readonly httpAgent: HttpAgent;
  private readonly httpsAgent: HttpsAgent;

  constructor(configuration: Configuration) {
    this.configuration = configuration;
    this.httpAgent = new HttpAgent({
      keepAlive: true,
      keepAliveMsecs: KEEP_ALIVE_TIMEOUT_MS,
    });
    this.httpsAgent = new HttpsAgent({
      keepAlive: true,
      keepAliveMsecs: KEEP_ALIVE_TIMEOUT_MS,
    });
  }

  async sendEnvelope(event: EventPayload): Promise<PostResult | null> {
    return this.post(this.serializeEnvelope(event));
  }

  async sendLogs(host: string, logs: LogEntry[]): Promise<PostResult | null> {
    if (!logs.length) return null;
    return this.post(this.serializeLogEnvelope(host, logs));
  }

  close(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
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
    const agent = isHttps ? this.httpsAgent : this.httpAgent;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PostResult | null) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const req = reqFn(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          method: "POST",
          path: `${url.pathname}${url.search}`,
          headers: this.envelopeHeaders(compressed.length),
          agent,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            finish({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      req.on("error", (err: Error) => {
        this.logFailure(url, err);
        finish(null);
      });

      // Idle/read timeout.
      req.setTimeout(this.configuration.readTimeoutMs, () => {
        req.destroy(new Error("read timed out"));
      });

      // Connect timeout — only meaningful on a fresh socket; a pooled
      // keep-alive socket is already connected.
      req.on("socket", (socket: Socket) => {
        if (!socket.connecting) return;
        const timer = setTimeout(() => {
          req.destroy(new Error("connection timed out"));
        }, this.configuration.openTimeoutMs);
        const clear = () => clearTimeout(timer);
        socket.once("connect", clear);
        socket.once("close", clear);
        socket.once("error", clear);
      });

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
