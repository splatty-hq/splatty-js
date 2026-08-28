# Splatty (JS)

JavaScript/TypeScript client for [Splatty](https://github.com/splatty-hq/splatty).
Captures exceptions and logs and ships them over the envelope protocol.
Mirrors [`splatty-ruby`](https://github.com/splatty-hq/splatty-ruby).

No runtime dependencies. Every integration is duck-typed against the library it
adapts, so installing Splatty never pulls in Express, pino, winston or BullMQ —
you only wire up the ones you already use.

- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Capturing events](#capturing-events)
- [Express](#express)
- [Background jobs](#background-jobs)
- [Logs](#logs)
- [Shutting down](#shutting-down)
- [Entry points](#entry-points)
- [API reference](#api-reference)
- [Wire protocol](#wire-protocol)

## Installation

```sh
npm install splatty
```

Requires Node 18 or newer. Ships both CommonJS and ESM builds with TypeScript
declarations, so `import` and `require` both work:

```ts
import * as splatty from "splatty";
```

```js
const splatty = require("splatty");
```

## Quick start

```ts
import * as splatty from "splatty";

splatty.init({
  url: process.env.SPLATTY_URL ?? "https://splatty.app",
  dsn: process.env.SPLATTY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  release: process.env.SPLATTY_RELEASE,
});

try {
  doSomething();
} catch (e) {
  await splatty.captureException(e);
}
```

`init()` validates the config, creates the client and installs whichever
integrations the config asks for. Call it once, as early in boot as you can.

## Configuration

| option | env | default | what it does |
|---|---|---|---|
| `url` | `SPLATTY_URL` | `https://splatty.app` | Server base URL; the SDK posts to `<url>/api/envelope` |
| `dsn` | `SPLATTY_DSN` | — (required) | Project key, sent as `Authorization: Bearer <dsn>` |
| `environment` | `NODE_ENV` / `RAILS_ENV` | `development` | Stamped on every event and log entry |
| `release` | `SPLATTY_RELEASE` | — | Stamped on every event and log entry |
| `enabled` | — | `true` | Set `false` to turn every capture into a no-op |
| `logs` | — | `true` | Install the batching log appender |
| `logOptions` | — | — | Appender tuning, see [Logs](#logs) |
| `captureConsole` | — | `false` | Patch `console` so its output is shipped as logs |
| `captureUnhandled` | — | `false` | Install `uncaughtException` / `unhandledRejection` handlers |
| `sendDefaultPii` | — | `false` | Send request headers verbatim instead of filtering them |
| `contextLines` | — | `5` | Source lines sent either side of a stack frame; `0` disables |
| `serverName` | — | `os.hostname()` | Overrides the reported host |
| `openTimeoutMs` | — | `5000` | Connect timeout |
| `readTimeoutMs` | — | `10000` | Idle/read timeout |
| `logger` | — | `null` (falls back to `console`) | Where the SDK writes its own warnings |
| `beforeSend` | — | — | Last chance to mutate or drop an event |

A configure-block form is available too, matching the Ruby SDK:

```ts
splatty.init((config) => {
  config.dsn = process.env.SPLATTY_DSN;
  config.environment = "production";
  config.logs = false;
});
```

### Filtering sensitive data

By default (`sendDefaultPii = false`) sensitive request headers — `Cookie`,
`Authorization`, CSRF tokens, API keys, session and password headers — are
replaced with `[Filtered]` before an event leaves the process. Matching is
case-insensitive, so `cookie` and `Cookie` are both caught.

Set `sendDefaultPii = true` only if you understand that cookies and auth tokens
will then be transmitted and stored.

### Bad config never throws

A missing `dsn`, an empty `url` or a `url` that won't parse makes Splatty warn
once and disable itself. `init()` still returns a client, every capture becomes
a no-op, and your app boots as normal.

```ts
splatty.init({ dsn: undefined });
// [Splatty] disabled: config.dsn is required
splatty.enabled(); // false
```

## Capturing events

```ts
await splatty.captureException(err);
await splatty.captureMessage("hello", { level: "info" });
```

Both resolve to the event id, or to `null` when Splatty is disabled or the
event was dropped by `beforeSend`.

Note the two signatures differ: `captureException` takes a scope as its second
argument, while `captureMessage` takes an options object with the scope nested
under `scope`.

```ts
await splatty.captureException(err, {
  level: "error",                       // default "error"
  transaction: "POST /checkout",
  tags: { area: "billing" },            // indexed, string values
  extra: { orderId, cartSize: 12 },     // free-form JSON
  contexts: { app: { build: "1.2.3" } },
  request: { url, method, headers },
});

await splatty.captureMessage("cache miss storm", {
  level: "warn",                        // default "info"
  scope: { tags: { area: "cache" }, extra: { misses: 4213 } },
});
```

### Reported once

An exception object is only reported once. A job failure that surfaces through
both a worker hook and a process handler produces a single event — the second
call resolves to `null`. Deduplication is per object identity, so two distinct
`new Error("boom")` instances are two events.

### `beforeSend`

Runs after header scrubbing, right before the event is serialized. Return
`null` to drop it.

```ts
splatty.init({
  dsn,
  beforeSend: (event) => {
    if (event.exception?.values.at(-1)?.type === "AbortError") return null;
    event.tags["region"] = process.env.FLY_REGION ?? "unknown";
    return event;
  },
});
```

## Express

```ts
import express from "express";
import { errorHandler } from "splatty/express";

const app = express();

// ...routes...

app.use(errorHandler());
```

Register it after your routes and before any error renderer. The middleware
reports the exception and hands it to the next error handler, so your own error
responses are untouched.

Events carry the request URL, method and headers, a `request_id` tag (from
`req.id` if something like `pino-http` set one, otherwise the `X-Request-Id`
header) and a `transaction` built from the matched route, e.g. `GET /users/:id`.

To report an error yourself from inside a route while keeping the same request
context, reuse `buildScope`:

```ts
import { buildScope } from "splatty/express";

app.get("/users/:id", async (req, res) => {
  try {
    res.json(await loadUser(req.params.id));
  } catch (e) {
    await splatty.captureException(e, buildScope(req));
    res.status(500).end();
  }
});
```

## Background jobs

Job failures happen outside the request cycle, so they need their own wiring.

### BullMQ

```ts
import { Worker } from "bullmq";
import { instrumentWorker } from "splatty/bullmq";

const worker = new Worker("mailers", handler);
const uninstall = instrumentWorker(worker);
```

Reports the failure that exhausts a job's retries — attempts BullMQ still
intends to retry stay quiet, the same way the Ruby SDK ignores Active Job
retries. Worker-level errors (a dropped Redis connection, an unparseable
payload) are reported too. `instrumentWorker` returns a function that detaches
both listeners again.

```ts
instrumentWorker(worker, {
  captureRetries: true,   // report every attempt, not just the last (default false)
  backend: "bullmq",      // value of the job_backend tag
});
```

Events are tagged with `job_backend`, `job_class` (the job name) and
`job_queue`, get a `transaction` of the job name, and carry `job_id`,
`job_attempts` and `job_args` as extra data. Arguments are JSON-serialized and
truncated at 2048 characters with a `...(truncated)` suffix.

### Any other queue

Agenda, Bee-Queue, Graphile Worker, a hand-rolled poller — anything with an
error hook can report through the same shape:

```ts
import { captureJobException } from "splatty/bullmq";

agenda.on("fail", async (err, job) => {
  await captureJobException(err, {
    backend: "agenda",
    jobClass: job.attrs.name,
    queue: "default",
    jobId: job.attrs._id,
    attempts: job.attrs.failCount,
    args: job.attrs.data,
    extra: { lockedAt: job.attrs.lockedAt },
  });
});
```

### Crashes nothing else caught

```ts
splatty.init({ dsn, captureUnhandled: true });
```

Installs `uncaughtException` (reported at `fatal`) and `unhandledRejection`
(reported at `error`) handlers, both tagged with `mechanism`. The event is
shipped and pending logs are flushed, then Node's default crash behaviour is
restored — print the error and exit 1 — as long as Splatty is the only listener
for that event.

To keep the process alive and handle the crash yourself, install the handlers
directly:

```ts
import { installProcessHandlers } from "splatty/process";

installProcessHandlers({ exit: false });
```

## Logs

`init()` installs a batching log appender unless you pass `logs: false`. It
buffers entries in memory and ships them as `log` envelope items every 15
seconds, or immediately once `batchSize` entries have piled up. The flush timer
is unref'd, so it never keeps a process alive on its own.

Entries about Splatty's own intake paths are dropped, so a dogfooded app can't
feed itself: every shipped batch would otherwise become a new request log, which
becomes another batch. The dropped paths are `/api/envelope`, `/api/logs` and
`/api/metrics`, each also matching an optional numeric project id
(`/api/42/logs`) and a trailing slash.

### pino

```ts
import pino from "pino";
import { splattyStream } from "splatty/pino";

const logger = pino(
  { level: "info" },
  pino.multistream([{ stream: process.stdout }, { stream: splattyStream() }]),
);
```

`splattyStream()` parses pino's NDJSON output, maps its numeric levels, drops
`pid`/`hostname`, and forwards the rest as fields. Pass
`splattyStream({ messageKey: "message", ignore: ["req"] })` if you've customized
pino's output.

### winston

```ts
import winston from "winston";
import { SplattyTransport } from "splatty/winston";

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new SplattyTransport({ level: "info" }),
  ],
});
```

### console

```ts
splatty.init({ dsn, captureConsole: true });
```

Patches `console.log`/`info`/`warn`/`error`/`debug`/`trace` so their output is
forwarded as well as printed. Arguments are formatted with `util.format`, so
`console.warn("disk %s%% full", 91)` ships as `disk 91% full`.

For finer control — a subset of methods, or install/remove at will:

```ts
import { installConsoleCapture, uninstallConsoleCapture } from "splatty/console";

const restore = installConsoleCapture({ methods: ["warn", "error"] });
// ...
restore(); // or uninstallConsoleCapture()
```

### Anything else

Hand the appender a record directly:

```ts
splatty.captureLog({
  level: "info",
  message: "checkout completed",
  time: new Date(),
  fields: { request_id: reqId, path: "/checkout", status: 200, duration_ms: 42 },
});
```

Returns `false` when the entry was dropped (Splatty disabled, no appender
installed, below the configured level, or an intake path).

### Entry shape

`request_id`, `method`, `path`, `status`, `duration_ms` (or `duration`),
`controller` and `action` are lifted out of `fields` into top-level columns.
Everything left in `fields` is stringified into a string map. A `sql` field is
inlined into the message: `Load — SELECT 1`.

Levels are normalized to `debug`, `info`, `warn`, `error` or `fatal`; anything
unrecognized becomes `info`.

### Tuning

```ts
splatty.init({
  dsn,
  logOptions: {
    level: "info",          // drop anything below this level
    batchSize: 100,         // flush once this many entries are queued
    flushIntervalMs: 15_000,
    queueLimit: 5_000,      // over this, the oldest entry is dropped
    host: os.hostname(),
  },
});
```

## Shutting down

```ts
await splatty.flush(); // ship queued logs, keep running
await splatty.close(); // flush, remove installed integrations, drop the client
```

`close()` is async because the final log batch still has to go over the wire.
It removes the integrations `init()` installed (console patch, process
handlers); teardowns you got back from `instrumentWorker` or
`installConsoleCapture` are yours to call.

## Entry points

| import | contents |
|---|---|
| `splatty` | `init`, capture functions, config, and everything below re-exported |
| `splatty/express` | `errorHandler`, `buildScope` |
| `splatty/bullmq` | `instrumentWorker`, `captureJobException`, `jobScope` |
| `splatty/process` | `installProcessHandlers`, `uninstallProcessHandlers` |
| `splatty/pino` | `splattyStream` |
| `splatty/winston` | `SplattyTransport` |
| `splatty/console` | `installConsoleCapture`, `uninstallConsoleCapture` |

The BullMQ, console and process helpers are also re-exported from the root, so
`import { instrumentWorker } from "splatty"` works. The Express, pino and
winston adapters are subpath-only, so importing the root never drags an adapter
you don't use into your bundle.

## API reference

**Lifecycle** — `init(options | configureFn): Client`, `flush(): Promise<void>`,
`close(): Promise<void>`.

**Accessors** — `client(): Client | null`, `configuration(): Configuration |
null`, `enabled(): boolean`, `logAppender(): LogAppender | null`.

**Capture** — `captureException(err, scope?)`, `captureMessage(message, {
level?, scope? })`, `captureLog(record)`, `captureJobException(err, context)`.

**Building blocks**, if you're assembling your own pipeline — `Client`,
`Configuration`, `Transport`, `Scrubber`, `LogAppender`, `buildExceptionEvent`,
`buildMessageEvent`, `jobScope`, `encodeArgs`, `mapLevel`, `flushLogs`.

**Constants** — `VERSION`, `SDK_NAME`, `DEFAULT_URL`, `FILTERED`,
`SENSITIVE_HEADER_PATTERN`, `INTAKE_PATH_PATTERN`, `MAX_ARGS_LENGTH`,
`DEFAULT_BATCH_SIZE`, `DEFAULT_FLUSH_INTERVAL_MS`, `DEFAULT_QUEUE_LIMIT`.

**Types** — `Level`, `Scope`, `RequestContext`, `StackFrame`, `ExceptionValue`,
`EventPayload`, `LogRecord`, `LogEntry`, `ConfigurationOptions`, `InitOptions`,
`LogAppenderOptions`, `ProcessHandlerOptions`, `JobContext`, `BullMQJob`,
`BullMQWorker`, `BullMQOptions`, `PostResult`.

## Wire protocol

Everything is POSTed gzipped to `<url>/api/envelope` over a keep-alive
connection, with `Content-Type: application/x-splatty-envelope` and
`Authorization: Bearer <dsn>`. The body is three newline-separated lines: an
envelope header, an item header, and the JSON payload.

```
{"event_id":"…","sent_at":"…","dsn":"…","sdk":{"name":"splatty.js","version":"0.1.0"}}
{"type":"event","content_type":"application/json","length":1234}
{"event_id":"…","timestamp":"…","platform":"node","level":"error","exception":{…}}
```

Log batches use the same shape. Their envelope header carries no `event_id`,
and the item header is `{"type":"log","item_count":N,"content_type":
"application/vnd.splatty.items.log+json","length":…}` over a
`{"host":…,"items":[…]}` payload.

Transport failures never throw and never bubble into your code — they're warned
about through `config.logger` and the send resolves to `null`.

## Development

```sh
npm run typecheck
npm test
npm run build
```

## License

MIT.
