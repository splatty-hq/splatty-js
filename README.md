# Splatty (JS)

JavaScript/TypeScript client for [Splatty](https://github.com/k0va1/splatty).
Captures exceptions and logs and ships them over the envelope protocol.
Mirrors [`splatty-ruby`](https://github.com/k0va1/splatty-ruby).

## Installation

```sh
npm install splatty
```

## Usage

```ts
import * as splatty from "splatty";

splatty.init({
  url: process.env.SPLATTY_URL ?? "https://splatty.k0va1.dev",
  dsn: process.env.SPLATTY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  release: process.env.SPLATTY_RELEASE,
});

try {
  doSomething();
} catch (e) {
  await splatty.captureException(e);
}

await splatty.captureMessage("hello", { level: "info" });
```

### Express

```ts
import express from "express";
import { errorHandler } from "splatty/dist/express";

const app = express();

// ...routes...

app.use(errorHandler());
```

### Configuration

| option | env | default |
|---|---|---|
| `url` | `SPLATTY_URL` | `https://splatty.k0va1.dev` |
| `dsn` | `SPLATTY_DSN` | — (required) |
| `environment` | `NODE_ENV` / `RAILS_ENV` | `development` |
| `release` | `SPLATTY_RELEASE` | — |
| `serverName` | — | `os.hostname()` |
| `openTimeoutMs` | — | `5000` |
| `readTimeoutMs` | — | `10000` |
| `beforeSend` | — | — |

`beforeSend(event)` can mutate or drop an event by returning `null`.

## License

MIT.
