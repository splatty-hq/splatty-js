export type Level = "debug" | "info" | "warn" | "error" | "fatal";

export interface RequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface Scope {
  level?: Level | string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  request?: RequestContext | null;
}

export interface StackFrame {
  filename: string | null;
  abs_path: string | null;
  function: string | null;
  lineno: number | null;
  colno?: number | null;
  in_app: boolean;
}

export interface ExceptionValue {
  type: string;
  value: string;
  stacktrace: { frames: StackFrame[] };
}

export interface EventPayload {
  event_id: string;
  timestamp: string;
  platform: string;
  environment?: string;
  release?: string;
  server_name?: string;
  sdk: { name: string; version: string };
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  contexts: Record<string, unknown>;
  request?: RequestContext | null;
  level: string;
  message?: { formatted: string };
  exception?: { values: ExceptionValue[] };
}

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  request_id?: string;
  method?: string;
  path?: string;
  status?: number;
  duration_ms?: number | null;
  controller?: string;
  action?: string;
  environment?: string;
  release?: string;
  host?: string;
  fields?: Record<string, string>;
}
