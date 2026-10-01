/**
 * Background-job worker Lambda (task 14.2; task 24 jobs stack): consumes the
 * jobs queue one message at a time with partial batch responses.
 *
 * Each message is a `PlanningJobMessage` (`{ type, jobId }`); everything else
 * is loaded from the database, so a redelivered or duplicate message is
 * harmless (`processPlanningJob` resumes from checkpoints and never redoes a
 * finished job). A failure is reported for the message so SQS retries it and,
 * after `maxReceiveCount` receives, moves it to the dead-letter queue.
 *
 * The same function also runs the shift-offer expiry sweep (task 17.1,
 * Req 13.2/13.5) when EventBridge invokes it on its schedule: due offers move
 * to `expired` and their senders are notified. The API expires due offers
 * lazily before every offer read and write too, so the schedule only makes
 * the sender's notification timely.
 *
 * Deployed by infra/lib/jobs-stack.ts from `dist/jobs-worker/index.mjs`.
 */
import { PLANNING_JOB_TYPES, type PlanningJobMessage } from '@lanewise/shared';
import type { ScheduledEvent, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import type pg from 'pg';
import { createPool } from '../db/pool.js';
import { expireDueOffers } from '../db/repositories/offers.js';
import { processPlanningJob } from './planning-jobs.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseJobMessage(body: string): PlanningJobMessage {
  const parsed = JSON.parse(body) as Partial<PlanningJobMessage> | null;
  if (!parsed || !(PLANNING_JOB_TYPES as readonly string[]).includes(parsed.type ?? '') || !UUID.test(parsed.jobId ?? '')) {
    throw new Error('not a planning job message');
  }
  return { type: parsed.type as PlanningJobMessage['type'], jobId: parsed.jobId as string };
}

type Log = (level: 'info' | 'error', msg: string, fields?: Record<string, unknown>) => void;

const defaultLog: Log = (level, msg, fields = {}) => {
  console.log(JSON.stringify({ level, msg, service: 'lanewise-jobs-worker', env: process.env.LANEWISE_ENV, ...fields }));
};

/** An EventBridge scheduled invocation (the offer expiry sweep) rather than an SQS batch. */
export function isScheduledEvent(event: unknown): event is ScheduledEvent {
  const e = event as Partial<ScheduledEvent> | null;
  return e !== null && typeof e === 'object' && e.source === 'aws.events' && e['detail-type'] === 'Scheduled Event';
}

export function createWorkerHandler(db: () => pg.Pool, log: Log = defaultLog, now: () => Date = () => new Date()) {
  return async (event: SQSEvent | ScheduledEvent): Promise<SQSBatchResponse> => {
    if (isScheduledEvent(event)) {
      const expired = await expireDueOffers(db(), now());
      log('info', 'offer expiry sweep', { expired });
      return { batchItemFailures: [] };
    }
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records ?? []) {
      try {
        const job = parseJobMessage(record.body);
        const outcome = await processPlanningJob(db(), job.jobId);
        log('info', 'job processed', { messageId: record.messageId, type: job.type, jobId: job.jobId, outcome });
      } catch (error) {
        log('error', 'job failed', { messageId: record.messageId, error: error instanceof Error ? error.message : String(error) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

let pool: pg.Pool | null = null;

/** Lambda entry point: the same `DATABASE_URL` configuration as the API. */
export const handler = createWorkerHandler(() => {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  pool = createPool({ connectionString, max: 1, applicationName: 'lanewise-jobs-worker' });
  return pool;
});
