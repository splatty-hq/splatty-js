import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { Transport } from "../src/transport.js";
import type { EventPayload, LogEntry } from "../src/types.js";
import { buildConfiguration } from "./helpers.js";

interface Recorded {
  path: string;
  method: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

let server: Server;
let port: number;
let requests: Recorded[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        path: req.url ?? "",
        method: req.method ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.statusCode = 202;
      res.end("");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function transport(): Transport {
  requests = [];
  return new Transport(
    buildConfiguration({ url: `http://127.0.0.1:${port}`, dsn: "abc" }),
  );
}

function decode(body: Buffer): string[] {
  return gunzipSync(body).toString("utf8").split("\n");
}

test("sendEnvelope posts a gzipped three-line body", async () => {
  const t = transport();
  const event = { event_id: "deadbeef".repeat(4), exception: { values: [] } };
  await t.sendEnvelope(event as unknown as EventPayload);
  t.close();

  const req = requests[0];
  assert.equal(req.path, "/api/envelope");
  assert.equal(req.method, "POST");
  assert.equal(req.headers["authorization"], "Bearer abc");
  assert.equal(req.headers["content-type"], "application/x-splatty-envelope");
  assert.equal(req.headers["content-encoding"], "gzip");

  const lines = decode(req.body);
  assert.equal(lines.length, 3);
  const envelopeHeader = JSON.parse(lines[0]);
  const itemHeader = JSON.parse(lines[1]);
  const payload = JSON.parse(lines[2]);

  assert.equal(envelopeHeader.event_id, "deadbeef".repeat(4));
  assert.equal(envelopeHeader.sdk.name, "splatty.js");
  assert.equal(envelopeHeader.dsn, "abc");
  assert.equal(itemHeader.type, "event");
  assert.equal(itemHeader.length, Buffer.byteLength(JSON.stringify(payload), "utf8"));
});

test("sendLogs posts an envelope with a log item", async () => {
  const t = transport();
  const logs = [{ level: "info", message: "hello" }] as unknown as LogEntry[];
  await t.sendLogs("test-host", logs);
  t.close();

  const req = requests[0];
  assert.equal(req.path, "/api/envelope");
  assert.equal(req.headers["authorization"], "Bearer abc");
  assert.equal(req.headers["content-encoding"], "gzip");

  const lines = decode(req.body);
  assert.equal(lines.length, 3);
  const itemHeader = JSON.parse(lines[1]);
  const payload = JSON.parse(lines[2]);
  assert.equal(itemHeader.type, "log");
  assert.equal(itemHeader.item_count, 1);
  assert.equal(payload.host, "test-host");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].message, "hello");
});

test("sendLogs skips when there is nothing to send", async () => {
  const t = transport();
  const result = await t.sendLogs("h", []);
  t.close();
  assert.equal(result, null);
  assert.equal(requests.length, 0);
});

test("a transport failure resolves to null instead of throwing", async () => {
  const config = buildConfiguration({
    url: "http://127.0.0.1:1",
    dsn: "abc",
    openTimeoutMs: 200,
    readTimeoutMs: 200,
  });
  const t = new Transport(config);
  const result = await t.sendEnvelope({ event_id: "x" } as unknown as EventPayload);
  t.close();
  assert.equal(result, null);
});
