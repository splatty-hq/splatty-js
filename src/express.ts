import * as splatty from "./index";
import type { RequestContext } from "./types";

interface ExpressRequest {
  protocol?: string;
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | undefined;
}

interface ExpressResponse {
  statusCode?: number;
}

type NextFn = (err?: unknown) => void;

function buildRequestContext(req: ExpressRequest): RequestContext {
  const host = req.get?.("host") ?? (req.headers?.["host"] as string | undefined) ?? "";
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

export function errorHandler() {
  return (
    err: unknown,
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFn,
  ): void => {
    if (splatty.enabled()) {
      void splatty.captureException(err, { request: buildRequestContext(req) });
    }
    next(err);
  };
}
