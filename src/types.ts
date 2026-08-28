export type Level = "debug" | "info" | "warn" | "error" | "fatal";

export interface RequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface Scope {
  level?: Level | string;
  transaction?: string;
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
  pre_context?: string[];
  context_line?: string;
  post_context?: string[];
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
  transaction?: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  contexts: Record<string, unknown>;
  request?: RequestContext | null;
  level: string;
  message?: { formatted: string };
  exception?: { values: ExceptionValue[] };
}

/**
 * Neutral log shape the appender understands. Logger adapters (pino, winston,
 * console) translate their own record into this before enqueueing.
 */
export interface LogRecord {
  time?: Date | number | string;
  level?: string;
  message?: string;
  fields?: Record<string, unknown>;
}

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number | null;
  controller: string;
  action: string;
  environment: string;
  release: string;
  host: string;
  fields: Record<string, string>;
}
