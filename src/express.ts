import { captureException } from "./capture.js";
import { isEnabled } from "./global.js";
import type { RequestContext, Scope } from "./types.js";

interface ExpressRequest {
  protocol?: string;
  method?: string;
  originalUrl?: string;
  url?: string;
  id?: string | number;
  headers?: Record<string, string | string[] | undefined>;
  route?: { path?: string };
  baseUrl?: string;
  get?: (name: string) => string | undefined;
}

interface ExpressResponse {
  statusCode?: number;
}

type NextFn = (err?: unknown) => void;

function header(req: ExpressRequest, name: string): string | undefined {
  const viaGetter = req.get?.(name);
  if (viaGetter) return viaGetter;
  const raw = req.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function buildRequestContext(req: ExpressRequest): RequestContext {
  const host = header(req, "host") ?? "";
  const scheme = req.protocol ?? "http";
  const path = req.originalUrl ?? req.url ?? "";
  const headers: Record<string, string> = {};
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v.join(", ");
    }
  }
  return {
    url: `${scheme}://${host}${path}`,
    method: req.method,
    headers,
  };
}

function requestId(req: ExpressRequest): string | undefined {
  if (req.id !== undefined && req.id !== null && req.id !== "") return String(req.id);
  return header(req, "x-request-id");
}

function transaction(req: ExpressRequest): string | undefined {
  const routePath = req.route?.path;
  if (!routePath) return undefined;
  const base = req.baseUrl ?? "";
  return `${req.method ?? "GET"} ${base}${routePath}`;
}

export function buildScope(req: ExpressRequest): Scope {
  const scope: Scope = { request: buildRequestContext(req) };
  const id = requestId(req);
  if (id) scope.tags = { request_id: id };
  const name = transaction(req);
  if (name) scope.transaction = name;
  return scope;
}

/**
 * Express error middleware. Reports the exception and hands it back to the
 * next error handler, so the app's own error rendering is untouched.
 *
 * ```ts
 * app.use(errorHandler());
 * ```
 */
export function errorHandler() {
  return (
    err: unknown,
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFn,
  ): void => {
    if (isEnabled()) {
      void captureException(err, buildScope(req));
    }
    next(err);
  };
}
