import { getClient, isEnabled } from "./global.js";
import type { Scope } from "./types.js";

/**
 * Exceptions already reported once. The Ruby SDK stamps an ivar on the
 * exception; a WeakSet is the JS equivalent and keeps the objects collectable.
 */
const captured = new WeakSet<object>();

function alreadyCaptured(err: unknown): boolean {
  return typeof err === "object" && err !== null && captured.has(err);
}

function markCaptured(err: unknown): void {
  if (typeof err !== "object" || err === null) return;
  if (Object.isFrozen(err)) return;
  captured.add(err);
}

/**
 * Reports an exception. Returns the event id, or null when Splatty is
 * disabled or this exact exception object was already reported — so a failure
 * that surfaces through two integrations still produces a single event.
 */
export async function captureException(
  err: unknown,
  scope: Scope = {},
): Promise<string | null> {
  if (!isEnabled()) return null;
  if (alreadyCaptured(err)) return null;
  markCaptured(err);
  return getClient()!.captureException(err, scope);
}

export async function captureMessage(
  message: string,
  options: { level?: string; scope?: Scope } = {},
): Promise<string | null> {
  if (!isEnabled()) return null;
  return getClient()!.captureMessage(message, options);
}
