/**
 * Erlang C (M/M/c) queueing primitives — DOM-001 "Erlang C lane sizing".
 *
 * Conventions: arrival rate λ in transactions per hour, handle time in
 * seconds, offered load A = λ·h in Erlangs (dimensionless).
 */
import type { ServiceTarget } from './types.js';

/** Hard ceiling on lanes searched for a single interval (guards runaway loops). */
const MAX_AGENTS = 10_000;

/** Offered load A = λ·h (Erlangs) for λ per hour and handle time in seconds. */
export function offeredLoad(lambdaPerHour: number, ahtSec: number): number {
  return (lambdaPerHour * ahtSec) / 3600;
}

/**
 * Erlang B blocking probability via the numerically stable recurrence
 * B(0)=1, B(k) = A·B(k−1) / (k + A·B(k−1)).
 */
export function erlangB(agents: number, load: number): number {
  let b = 1;
  for (let k = 1; k <= agents; k += 1) {
    b = (load * b) / (k + load * b);
  }
  return b;
}

/**
 * Erlang C probability that an arriving customer waits, P(wait).
 * Returns 1 when the queue is unstable (c ≤ A) and 0 with no load.
 */
export function erlangC(agents: number, load: number): number {
  if (load <= 0) return 0;
  if (agents <= load) return 1;
  const b = erlangB(agents, load);
  return (agents * b) / (agents - load * (1 - b));
}

/** Share of customers served within `thresholdSec`: 1 − P(wait)·e^{−(c−A)·T/h}. */
export function serviceLevel(agents: number, load: number, ahtSec: number, thresholdSec: number): number {
  if (load <= 0) return 1;
  if (agents <= load) return 0;
  return 1 - erlangC(agents, load) * Math.exp((-(agents - load) * thresholdSec) / ahtSec);
}

/** Average speed of answer (queue wait) in seconds: P(wait)·h/(c−A). */
export function averageWaitSec(agents: number, load: number, ahtSec: number): number {
  if (load <= 0) return 0;
  if (agents <= load) return Number.POSITIVE_INFINITY;
  return (erlangC(agents, load) * ahtSec) / (agents - load);
}

/**
 * Minimum number of open lanes c (> A) whose service level meets the target.
 * Zero arrivals need zero lanes (the minimum-lane floor is applied later).
 */
export function requiredAgents(lambdaPerHour: number, ahtSec: number, target: ServiceTarget): number {
  const load = offeredLoad(lambdaPerHour, ahtSec);
  if (load <= 0) return 0;
  let c = Math.floor(load) + 1;
  while (c < MAX_AGENTS && serviceLevel(c, load, ahtSec, target.thresholdSec) < target.serviceLevel) {
    c += 1;
  }
  return c;
}
