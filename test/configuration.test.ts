import { test } from "node:test";
import assert from "node:assert/strict";
import { Configuration, DEFAULT_URL } from "../src/configuration.js";
import { buildConfiguration } from "./helpers.js";

const silent = { warn: () => {} };

test("envelopeUrl is built from url", () => {
  const config = buildConfiguration({ url: "http://host.example:3001", dsn: "abc123" });
  assert.equal(config.dsnKey(), "abc123");
  assert.equal(config.envelopeUrl(), "http://host.example:3001/api/envelope");
});

test("envelopeUrl strips a trailing slash", () => {
  const config = buildConfiguration({ url: "https://example.com/", dsn: "abc" });
  assert.equal(config.envelopeUrl(), "https://example.com/api/envelope");
});

test("validate disables when url is missing", () => {
  const config = new Configuration({ dsn: "abc", logger: silent });
  config.url = "";
  config.validate();
  assert.equal(config.isEnabled(), false);
});

test("validate disables when dsn is missing", () => {
  const config = new Configuration({ url: "https://example.com", logger: silent });
  config.dsn = undefined;
  config.validate();
  assert.equal(config.isEnabled(), false);
});

test("validate disables when url is invalid", () => {
  const config = new Configuration({ url: "not-a-url", dsn: "abc", logger: silent });
  config.validate();
  assert.equal(config.isEnabled(), false);
});

test("disabled when dsn is blank", () => {
  const config = new Configuration({ url: "https://example.com", dsn: "", logger: silent });
  assert.equal(config.isEnabled(), false);
});

test("validate does nothing when already disabled", () => {
  const config = new Configuration({ enabled: false, logger: silent });
  config.url = "";
  config.dsn = undefined;
  config.validate();
  assert.equal(config.isEnabled(), false);
});

test("sendDefaultPii defaults to false and logs default to true", () => {
  const config = new Configuration();
  assert.equal(config.sendDefaultPii, false);
  assert.equal(config.logs, true);
  assert.equal(config.captureConsole, false);
  assert.equal(config.captureUnhandled, false);
});

test("url falls back to the shared default", () => {
  const previous = process.env.SPLATTY_URL;
  delete process.env.SPLATTY_URL;
  try {
    assert.equal(new Configuration().url, DEFAULT_URL);
    assert.equal(DEFAULT_URL, "https://splatty.app");
  } finally {
    if (previous !== undefined) process.env.SPLATTY_URL = previous;
  }
});
