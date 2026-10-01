/**
 * Background-job worker for the API benchmark, in its own process (like the
 * jobs Lambda behind SQS): reads job ids on stdin, runs the API's real
 * `processPlanningJob` with its own pool, reports `@@done <id> <outcome>`.
 * Running it out of process keeps the CPU-bound job from blocking the API
 * benchmark's event loop (which would distort status-poll latencies).
 */
import { createInterface } from 'node:readline';
import { createPool } from '../../../api/src/db/pool.js';
import { processPlanningJob } from '../../../api/src/jobs/planning-jobs.js';

const url = process.argv.slice(2).filter((a) => a !== '--')[0];
if (!url) throw new Error('usage: worker.ts <database url>');
const pool = createPool({ connectionString: url, max: 2 });
const write = (line: string) => process.stdout.write(`@@${line}\n`);

let chain: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  const jobId = line.trim();
  if (!jobId) return;
  chain = chain.then(async () => {
    try {
      write(`done ${jobId} ${await processPlanningJob(pool, jobId)}`);
    } catch (error) {
      write(`done ${jobId} error ${String(error).replace(/\s+/g, ' ')}`);
    }
  });
}).on('close', () => {
  void chain.then(() => pool.end()).then(() => process.exit(0));
});
write('ready');
