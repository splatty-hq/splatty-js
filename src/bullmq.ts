import { captureException } from "./capture.js";
import { isEnabled } from "./global.js";
import { encodeArgs } from "./jobs.js";
import type { Scope } from "./types.js";

export interface JobContext {
  /** Queue backend name, e.g. "bullmq". Lands in the `job_backend` tag. */
  backend: string;
  jobClass?: string;
  queue?: string;
  jobId?: string | number;
  attempts?: number;
  args?: unknown;
  extra?: Record<string, unknown>;
}

/** Builds the scope the job integrations report with. */
export function jobScope(context: JobContext): Scope {
  const tags: Record<string, string> = { job_backend: context.backend };
  if (context.jobClass) tags["job_class"] = String(context.jobClass);
  if (context.queue) tags["job_queue"] = String(context.queue);

  const extra: Record<string, unknown> = { ...(context.extra ?? {}) };
  if (context.jobId !== undefined && context.jobId !== null) {
    extra["job_id"] = String(context.jobId);
  }
  if (typeof context.attempts === "number") extra["job_attempts"] = context.attempts;
  const args = encodeArgs(context.args);
  if (args !== null) extra["job_args"] = args;

  const scope: Scope = { tags, extra };
  if (context.jobClass) scope.transaction = String(context.jobClass);
  return scope;
}

/**
 * Reports a background job failure from any queue backend — use this to wire
 * up a queue this package has no dedicated adapter for.
 */
export function captureJobException(
  err: unknown,
  context: JobContext,
): Promise<string | null> {
  if (!isEnabled()) return Promise.resolve(null);
  return captureException(err, jobScope(context));
}

export interface BullMQJob {
  id?: string | number;
  name?: string;
  queueName?: string;
  data?: unknown;
  opts?: { attempts?: number } | null;
  attemptsMade?: number;
}

type Listener = (...args: never[]) => void;

export interface BullMQWorker {
  name?: string;
  on(event: string, listener: Listener): unknown;
  off?(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
}

export interface BullMQOptions {
  /**
   * Report every failed attempt instead of only the one that exhausts the
   * job's retries. Mirrors the Ruby SDK, which stays quiet while Active Job
   * still intends to retry.
   */
  captureRetries?: boolean;
  /** Backend name for the `job_backend` tag. Defaults to "bullmq". */
  backend?: string;
}

function retriesRemain(job: BullMQJob | undefined): boolean {
  if (!job) return false;
  const attempts = job.opts?.attempts ?? 1;
  const made = job.attemptsMade ?? 0;
  // BullMQ increments attemptsMade before emitting "failed".
  return made < attempts;
}

/**
 * Attaches Splatty to a BullMQ `Worker`, reporting job failures and worker
 * errors. Returns a function that detaches the listeners again.
 */
export function instrumentWorker(
  worker: BullMQWorker,
  options: BullMQOptions = {},
): () => void {
  const backend = options.backend ?? "bullmq";

  const onFailed = (job: BullMQJob | undefined, err: unknown): void => {
    if (!isEnabled()) return;
    if (!options.captureRetries && retriesRemain(job)) return;
    void captureJobException(err, {
      backend,
      jobClass: job?.name,
      queue: job?.queueName ?? worker.name,
      jobId: job?.id,
      attempts: job?.attemptsMade,
      args: job?.data,
    });
  };

  const onError = (err: unknown): void => {
    if (!isEnabled()) return;
    void captureJobException(err, { backend, queue: worker.name });
  };

  worker.on("failed", onFailed as unknown as Listener);
  worker.on("error", onError as unknown as Listener);

  return () => {
    const detach = worker.off ?? worker.removeListener;
    detach?.call(worker, "failed", onFailed as unknown as Listener);
    detach?.call(worker, "error", onError as unknown as Listener);
  };
}
