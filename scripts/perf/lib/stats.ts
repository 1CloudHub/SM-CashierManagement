/** Small timing/statistics helpers for the perf benchmark. */
import { performance } from 'node:perf_hooks';

export interface Summary {
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

/** Nearest-rank percentile (p in 0..100) of an unsorted sample. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? Number.NaN;
}

export function summarize(samples: readonly number[]): Summary {
  const n = samples.length;
  return {
    n,
    min: n ? Math.min(...samples) : Number.NaN,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: n ? Math.max(...samples) : Number.NaN,
    mean: n ? samples.reduce((a, b) => a + b, 0) / n : Number.NaN,
  };
}

export const now = (): number => performance.now();

/** Times `fn` `runs` times after `warmup` untimed calls; returns the samples in ms. */
export async function sample(fn: () => unknown, runs: number, warmup = 0): Promise<number[]> {
  for (let i = 0; i < warmup; i += 1) await fn();
  const out: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = now();
    await fn();
    out.push(now() - t0);
  }
  return out;
}

export async function timed<T>(fn: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const t0 = now();
  const value = await fn();
  return { value, ms: now() - t0 };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
