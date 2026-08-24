import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../src/express.js";
import { startSplatty, stopSplatty, type Harness } from "./helpers.js";

afterEach(async () => {
  await stopSplatty();
});

interface FakeReq {
  protocol?: string;
  method?: string;
  originalUrl?: string;
  id?: string;
  headers?: Record<string, string>;
  route?: { path?: string };
}

function fakeRequest(overrides: FakeReq = {}): FakeReq {
  return {
    protocol: "http",
    method: "GET",
    originalUrl: "/x",
    headers: { host: "example.com" },
    ...overrides,
  };
}

async function run(harness: Harness, req: FakeReq, err: unknown = new Error("boom")) {
  let forwarded: unknown;
  errorHandler()(err, req as never, {} as never, (e) => {
    forwarded = e;
  });
  // captureException is fire-and-forget inside the middleware.
  await new Promise((resolve) => setImmediate(resolve));
  return { forwarded, events: harness.events };
}

test("captures the exception and forwards it to the next handler", async () => {
  const harness = await startSplatty();
  const err = new Error("boom");
  const { forwarded, events } = await run(
    harness,
    fakeRequest({ method: "POST", originalUrl: "/x?y=1" }),
    err,
  );

  assert.equal(forwarded, err);
  assert.equal(events.length, 1);
  assert.equal(events[0].exception!.values[0].type, "Error");
  assert.equal(events[0].request!.method, "POST");
  assert.ok(String(events[0].request!.url).includes("/x?y=1"));
});

test("tags events with the request id header", async () => {
  const harness = await startSplatty();
  const { events } = await run(
    harness,
    fakeRequest({ headers: { host: "example.com", "x-request-id": "hdr-456" } }),
  );
  assert.equal(events[0].tags["request_id"], "hdr-456");
});

test("prefers req.id over the header", async () => {
  const harness = await startSplatty();
  const { events } = await run(
    harness,
    fakeRequest({ id: "req-abc-123", headers: { host: "e.com", "x-request-id": "hdr" } }),
  );
  assert.equal(events[0].tags["request_id"], "req-abc-123");
});

test("omits the tag without a request id", async () => {
  const harness = await startSplatty();
  const { events } = await run(harness, fakeRequest());
  assert.deepEqual(events[0].tags, {});
});

test("sets the transaction from the matched route", async () => {
  const harness = await startSplatty();
  const { events } = await run(
    harness,
    fakeRequest({ method: "GET", route: { path: "/users/:id" } }),
  );
  assert.equal(events[0].transaction, "GET /users/:id");
});

test("scrubs sensitive request headers by default", async () => {
  const harness = await startSplatty();
  const { events } = await run(
    harness,
    fakeRequest({
      headers: {
        host: "example.com",
        cookie: "session=abc",
        authorization: "Bearer secret",
        accept: "text/html",
      },
    }),
  );

  const headers = events[0].request!.headers!;
  assert.equal(headers["cookie"], "[Filtered]");
  assert.equal(headers["authorization"], "[Filtered]");
  assert.equal(headers["accept"], "text/html");
});

test("sends headers verbatim when sendDefaultPii is on", async () => {
  const harness = await startSplatty({ sendDefaultPii: true });
  const { events } = await run(
    harness,
    fakeRequest({ headers: { host: "example.com", cookie: "session=abc" } }),
  );
  assert.equal(events[0].request!.headers!["cookie"], "session=abc");
});

test("does nothing once closed", async () => {
  const harness = await startSplatty();
  await stopSplatty();
  const { forwarded, events } = await run(harness, fakeRequest());
  assert.ok(forwarded instanceof Error);
  assert.equal(events.length, 0);
});
