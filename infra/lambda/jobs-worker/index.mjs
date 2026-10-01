// Background-job worker skeleton (task 24). Consumes the LaneWise jobs queue
// with partial batch responses: each message is `{ "type": string, ... }`.
// The deployed app uses the task 14.2 worker bundled from /api instead
// (bin/infra.ts passes `API_WORKER_BUNDLE_DIR`: hiring plans and long rosters,
// resumable, idempotent, cached per scenario version); this skeleton remains
// JobsStack's default so stack unit tests need no API build.
//
// No job types are registered here: every message is reported as a failure,
// so it is retried and then lands in the dead-letter queue instead of being
// silently dropped.
const HANDLERS = {};

function log(level, msg, fields = {}) {
  console.log(JSON.stringify({ level, msg, service: 'lanewise-jobs-worker', env: process.env.LANEWISE_ENV, ...fields }));
}

export async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records ?? []) {
    try {
      const job = JSON.parse(record.body);
      const run = HANDLERS[job?.type];
      if (!run) throw new Error(`no handler for job type "${job?.type}"`);
      await run(job);
      log('info', 'job completed', { messageId: record.messageId, type: job.type });
    } catch (error) {
      log('error', 'job failed', { messageId: record.messageId, error: error instanceof Error ? error.message : String(error) });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
