/**
 * Job queue for background planning jobs (task 14.2; ADR-0002; task 24 jobs
 * stack).
 *
 * In AWS the API sends `{ type, jobId }` to the SQS queue `JOBS_QUEUE_URL`
 * and the worker Lambda (`./worker.ts`) processes it. Without a queue —
 * local runs and tests — the in-process queue runs the same processor right
 * away, so the job lifecycle (queued → running → succeeded) is identical.
 */
import type { PlanningJobMessage } from '@lanewise/shared';
import type pg from 'pg';
import { processPlanningJob } from './planning-jobs.js';

export interface JobQueue {
  /** Hands a job to the worker. Rejects when the job could not be queued. */
  enqueue(message: PlanningJobMessage): Promise<void>;
}

/** Minimal SQS client surface (the AWS SDK ships with the Lambda runtime). */
export interface SqsSender {
  send(command: unknown): Promise<unknown>;
}

/** SQS-backed queue. The SDK is loaded lazily so tests and local runs never need it. */
export function createSqsQueue(queueUrl: string, client?: SqsSender): JobQueue {
  let sqs: Promise<{ client: SqsSender; command: (input: Record<string, unknown>) => unknown }> | null = null;
  const load = () => {
    sqs ??= import('@aws-sdk/client-sqs').then((m) => ({
      client: client ?? (new m.SQSClient({}) as unknown as SqsSender),
      command: (input: Record<string, unknown>) => new m.SendMessageCommand(input as never),
    }));
    return sqs;
  };
  return {
    async enqueue(message) {
      const { client: c, command } = await load();
      await c.send(command({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    },
  };
}

/** In-process fallback: processes the job immediately with the same code as the worker. */
export function createInProcessQueue(db: () => pg.Pool): JobQueue {
  return {
    async enqueue(message) {
      await processPlanningJob(db(), message.jobId);
    },
  };
}
