/** Metric records and the markdown report. */
import { cpus, freemem, loadavg, totalmem, type as osType, release } from 'node:os';
import { summarize, type Summary } from './stats.js';

export interface Target {
  /** e.g. "NFR-PERF-002" */
  readonly nfr: string;
  /** Statistic compared with the limit. */
  readonly stat: 'p95';
  readonly maxMs: number;
}

export type Verdict = 'PASS' | 'FAIL' | 'INFO';

export interface Metric extends Summary {
  readonly id: string;
  readonly group: 'domain' | 'matching' | 'api' | 'jobs' | 'setup';
  readonly name: string;
  /** Enforced target (PASS/FAIL); `null` = informational. */
  readonly target: Target | null;
  /** Reference limit shown for informational metrics (not enforced). */
  readonly reference?: string;
  readonly result: Verdict;
  readonly notes?: string;
  readonly samples: readonly number[];
}

export function metric(
  input: { id: string; group: Metric['group']; name: string; target?: Target | null; reference?: string; notes?: string },
  samples: readonly number[],
): Metric {
  const s = summarize(samples);
  const target = input.target ?? null;
  const result: Verdict = target === null || s.n === 0 ? 'INFO' : s[target.stat] <= target.maxMs ? 'PASS' : 'FAIL';
  return { ...input, target, ...s, result, samples: samples.map((x) => Math.round(x * 100) / 100) };
}

export function machineInfo(): Record<string, unknown> {
  const c = cpus();
  return {
    cpuCount: c.length,
    cpuModel: c[0]?.model ?? 'unknown',
    node: process.version,
    os: `${osType()} ${release()}`,
    totalMemGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    freeMemGiB: Math.round((freemem() / 2 ** 30) * 10) / 10,
    loadAvg1m: Math.round((loadavg()[0] ?? 0) * 100) / 100,
  };
}

function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

function targetText(m: Metric): string {
  if (m.target) return `${m.target.nfr} p95 ≤ ${fmt(m.target.maxMs)}`;
  return m.reference ? `(ref) ${m.reference}` : '–';
}

export function markdownTable(metrics: readonly Metric[]): string {
  const lines = ['| Metric | Target | n | p50 | p95 | max | Result |', '|---|---|---:|---:|---:|---:|---|'];
  for (const m of metrics) {
    const name = m.notes ? `${m.name} <br><sub>${m.notes}</sub>` : m.name;
    lines.push(`| ${name} | ${targetText(m)} | ${m.n} | ${fmt(m.p50)} | ${fmt(m.p95)} | ${fmt(m.max)} | ${m.result} |`);
  }
  return lines.join('\n');
}
