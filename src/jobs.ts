export const MAX_ARGS_LENGTH = 2048;

/**
 * Serializes job arguments for the `job_args` extra, truncating anything that
 * would bloat the event.
 */
export function encodeArgs(args: unknown): string | null {
  if (args === null || args === undefined) return null;
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    return null;
  }
  if (typeof json !== "string") return null;
  if (json.length <= MAX_ARGS_LENGTH) return json;
  return `${json.slice(0, MAX_ARGS_LENGTH)}...(truncated)`;
}
