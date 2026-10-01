/**
 * Auto-match all gaps (task 16.4; Req 11.7; P15, P16).
 *
 * Proposes, for a set of open shifts across the network, a combination of
 *   - offers to individual cashiers (ranked and filtered by
 *     {@link rankCandidates}, so every proposed cashier is eligible with their
 *     hours counted across all stores — P16), and
 *   - store-to-store moves from stores with a surplus in the same department,
 *     date and time window (the lending manager later picks who goes, Req 14),
 * that covers the MOST open shifts with the LEAST total travel.
 *
 * It is a min-cost maximum-cardinality assignment, solved exactly with
 * successive shortest augmenting paths (Bellman-Ford on the residual graph):
 *
 *   source ─1→ open shift ─(travel)→ cashier ─1→ sink
 *                         └(travel)→ surplus group ─count→ sink
 *
 * Each cashier receives at most one proposed offer per run, so the
 * eligibility computed against their existing shifts stays valid for the
 * whole proposal. The result is a proposal only: nothing is sent here.
 *
 * Outputs carry only pseudonymous ID, home store and barangay/city (P15).
 */
import { hasActiveConsent, type IsoDate } from './privacy.js';
import { rankCandidates, type LaborLimits, type MatchCandidate, type OpenShift, type RankedCandidate } from './matching.js';
import { timeWindowOf, type TimeWindowId, type TravelMode, type TravelTimeMatrix } from './travel.js';

/** Spare cashiers at a store for a department, date and window (from the network view, task 14). */
export interface SurplusSupply {
  readonly storeId: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly window: TimeWindowId;
  readonly count: number;
}

/** Store-to-store travel minutes, or `undefined` when not computed. */
export type StoreTravelTime = (fromStoreId: string, toStoreId: string, mode: TravelMode, window: TimeWindowId) => number | undefined;

export interface AutoMatchInput {
  readonly openShifts: readonly OpenShift[];
  readonly candidates: readonly MatchCandidate[];
  readonly matrix: TravelTimeMatrix;
  readonly surplus?: readonly SurplusSupply[];
  readonly storeTravel?: StoreTravelTime;
  readonly mode: TravelMode;
  readonly maxTravelMin: number;
  readonly limits?: LaborLimits;
}

export interface ProposedOffer {
  readonly shiftId: string;
  readonly storeId: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly startHour: number;
  readonly endHour: number;
  readonly window: TimeWindowId;
  readonly travelMin: number;
  /** The cashier as ranked for this shift (pseudonymous; never a name). */
  readonly candidate: RankedCandidate;
}

export interface ProposedMove {
  readonly fromStoreId: string;
  readonly toStoreId: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly window: TimeWindowId;
  /** Cashiers to borrow; the lending store manager chooses who (Req 14). */
  readonly count: number;
  readonly travelMin: number;
  readonly shiftIds: readonly string[];
}

export interface UnfilledShift {
  readonly shiftId: string;
  readonly storeId: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly window: TimeWindowId;
}

export interface AutoMatchSummary {
  readonly openShifts: number;
  readonly covered: number;
  readonly offers: number;
  readonly moves: number;
  /** Cashiers moved store to store (sum of move counts). */
  readonly movedCashiers: number;
  readonly storesInvolved: number;
  readonly totalTravelMin: number;
  /** Mean travel per covered shift (0 when nothing is covered). */
  readonly averageTravelMin: number;
  /** Staff left out for lack of consent; counted only (P15). */
  readonly excludedWithoutConsent: number;
}

export interface AutoMatchProposal {
  readonly mode: TravelMode;
  readonly maxTravelMin: number;
  readonly offers: readonly ProposedOffer[];
  readonly moves: readonly ProposedMove[];
  readonly unfilled: readonly UnfilledShift[];
  readonly summary: AutoMatchSummary;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const surplusKey = (s: { storeId: string; departmentId: string; date: string; window: string }) =>
  `${s.storeId}\u0000${s.departmentId}\u0000${s.date}\u0000${s.window}`;

/** Supply options for each open shift, in canonical order. */
interface Prepared {
  readonly slots: readonly (OpenShift & { readonly window: TimeWindowId })[];
  /** Per slot: eligible cashiers with travel, ranked. */
  readonly offerEdges: readonly (readonly RankedCandidate[])[];
  readonly groups: readonly SurplusSupply[];
  /** Per slot: (group index, travel) for every reachable surplus group. */
  readonly moveEdges: readonly (readonly { readonly group: number; readonly travelMin: number }[])[];
  readonly excludedWithoutConsent: number;
}

function prepare(input: AutoMatchInput): Prepared {
  if (!Number.isFinite(input.maxTravelMin) || input.maxTravelMin <= 0) throw new Error(`Invalid maxTravelMin ${input.maxTravelMin}`);
  const seen = new Set<string>();
  for (const s of input.openShifts) {
    if (seen.has(s.shiftId)) throw new Error(`Duplicate open shift ${s.shiftId}`);
    seen.add(s.shiftId);
  }
  const slots = [...input.openShifts]
    .sort((a, b) => byString(a.date, b.date) || a.startHour - b.startHour || byString(a.storeId, b.storeId) || byString(a.shiftId, b.shiftId))
    .map((s) => ({ ...s, window: timeWindowOf(s.date, s.startHour) }));

  // Merge duplicate surplus rows; drop non-positive counts.
  const merged = new Map<string, SurplusSupply>();
  for (const s of input.surplus ?? []) {
    if (!Number.isInteger(s.count) || s.count < 0) throw new Error(`Invalid surplus count ${s.count} at ${s.storeId}`);
    if (s.count === 0) continue;
    const k = surplusKey(s);
    const prev = merged.get(k);
    merged.set(k, prev ? { ...prev, count: prev.count + s.count } : { ...s });
  }
  const groups = [...merged.values()].sort((a, b) => byString(surplusKey(a), surplusKey(b)));

  const excludedWithoutConsent = input.candidates.filter((c) => !hasActiveConsent(c.location)).length;
  const offerEdges = slots.map(
    (shift) =>
      rankCandidates({ shift, mode: input.mode, maxTravelMin: input.maxTravelMin, window: shift.window, ...(input.limits ? { limits: input.limits } : {}) }, input.candidates, input.matrix)
        .ranked,
  );
  const moveEdges = slots.map((shift) => {
    const out: { group: number; travelMin: number }[] = [];
    if (!input.storeTravel) return out;
    groups.forEach((g, group) => {
      if (g.storeId === shift.storeId || g.departmentId !== shift.departmentId || g.date !== shift.date || g.window !== shift.window) return;
      const travelMin = input.storeTravel?.(g.storeId, shift.storeId, input.mode, shift.window);
      if (travelMin === undefined || !Number.isFinite(travelMin) || travelMin < 0 || travelMin > input.maxTravelMin) return;
      out.push({ group, travelMin });
    });
    return out;
  });
  return { slots, offerEdges, groups, moveEdges, excludedWithoutConsent };
}

/** One slot's chosen supply: a cashier (offer) or a surplus group (move). */
type Choice = { readonly kind: 'offer'; readonly candidate: RankedCandidate } | { readonly kind: 'move'; readonly group: number; readonly travelMin: number };

function build(input: AutoMatchInput, p: Prepared, choices: readonly (Choice | null)[]): AutoMatchProposal {
  const offers: ProposedOffer[] = [];
  const unfilled: UnfilledShift[] = [];
  const moveMap = new Map<string, { group: SurplusSupply; toStoreId: string; travelMin: number; shiftIds: string[] }>();
  p.slots.forEach((s, i) => {
    const c = choices[i] ?? null;
    if (c === null) {
      unfilled.push({ shiftId: s.shiftId, storeId: s.storeId, departmentId: s.departmentId, date: s.date, window: s.window });
    } else if (c.kind === 'offer') {
      offers.push({
        shiftId: s.shiftId,
        storeId: s.storeId,
        departmentId: s.departmentId,
        date: s.date,
        startHour: s.startHour,
        endHour: s.endHour,
        window: s.window,
        travelMin: c.candidate.travelMin,
        candidate: c.candidate,
      });
    } else {
      const g = p.groups[c.group] as SurplusSupply;
      const k = `${surplusKey(g)}\u0000${s.storeId}`;
      const m = moveMap.get(k) ?? { group: g, toStoreId: s.storeId, travelMin: c.travelMin, shiftIds: [] };
      m.shiftIds.push(s.shiftId);
      moveMap.set(k, m);
    }
  });
  const moves: ProposedMove[] = [...moveMap.values()]
    .map((m) => ({
      fromStoreId: m.group.storeId,
      toStoreId: m.toStoreId,
      departmentId: m.group.departmentId,
      date: m.group.date,
      window: m.group.window,
      count: m.shiftIds.length,
      travelMin: m.travelMin,
      shiftIds: m.shiftIds,
    }))
    .sort((a, b) => byString(a.date, b.date) || byString(a.window, b.window) || byString(a.toStoreId, b.toStoreId) || byString(a.fromStoreId, b.fromStoreId));

  const movedCashiers = moves.reduce((a, m) => a + m.count, 0);
  const covered = offers.length + movedCashiers;
  const totalTravelMin = offers.reduce((a, o) => a + o.travelMin, 0) + moves.reduce((a, m) => a + m.travelMin * m.count, 0);
  const stores = new Set<string>([...offers.map((o) => o.storeId), ...moves.flatMap((m) => [m.fromStoreId, m.toStoreId])]);
  return {
    mode: input.mode,
    maxTravelMin: input.maxTravelMin,
    offers,
    moves,
    unfilled,
    summary: {
      openShifts: p.slots.length,
      covered,
      offers: offers.length,
      moves: moves.length,
      movedCashiers,
      storesInvolved: stores.size,
      totalTravelMin,
      averageTravelMin: covered === 0 ? 0 : Math.round((totalTravelMin / covered) * 10) / 10,
      excludedWithoutConsent: p.excludedWithoutConsent,
    },
  };
}

// ---------------------------------------------------------------------------
// Min-cost max-flow (successive shortest paths, Bellman-Ford)
// ---------------------------------------------------------------------------

interface Edge {
  readonly to: number;
  cap: number;
  readonly cost: number;
  readonly rev: number;
}

class FlowGraph {
  readonly adj: Edge[][];
  constructor(n: number) {
    this.adj = Array.from({ length: n }, () => []);
  }
  add(from: number, to: number, cap: number, cost: number): number {
    const a = this.adj[from] as Edge[];
    const b = this.adj[to] as Edge[];
    a.push({ to, cap, cost, rev: b.length });
    b.push({ to: from, cap: 0, cost: -cost, rev: a.length - 1 });
    return a.length - 1;
  }
  /** Augments one unit at a time along the cheapest path until none remains. */
  run(s: number, t: number): void {
    const n = this.adj.length;
    const EPS = 1e-9;
    for (;;) {
      const dist = new Array<number>(n).fill(Infinity);
      const prevNode = new Array<number>(n).fill(-1);
      const prevEdge = new Array<number>(n).fill(-1);
      dist[s] = 0;
      for (let iter = 0; iter < n - 1; iter++) {
        let changed = false;
        for (let u = 0; u < n; u++) {
          const du = dist[u] as number;
          if (du === Infinity) continue;
          (this.adj[u] as Edge[]).forEach((e, i) => {
            if (e.cap > 0 && du + e.cost < (dist[e.to] as number) - EPS) {
              dist[e.to] = du + e.cost;
              prevNode[e.to] = u;
              prevEdge[e.to] = i;
              changed = true;
            }
          });
        }
        if (!changed) break;
      }
      if (dist[t] === Infinity) return;
      for (let v = t; v !== s; v = prevNode[v] as number) {
        const e = (this.adj[prevNode[v] as number] as Edge[])[prevEdge[v] as number] as Edge;
        e.cap -= 1;
        (this.adj[v] as Edge[])[e.rev]!.cap += 1;
      }
    }
  }
}

/**
 * Network-wide proposal: the maximum number of open shifts covered, and among
 * those the minimum total travel. Deterministic for the same inputs in any order.
 */
export function autoMatch(input: AutoMatchInput): AutoMatchProposal {
  const p = prepare(input);
  const staffIds = [...new Set(p.offerEdges.flatMap((r) => r.map((c) => c.staffId)))].sort(byString);
  const staffNode = new Map(staffIds.map((id, i) => [id, i]));
  const S = 0;
  const slotBase = 1;
  const staffBase = slotBase + p.slots.length;
  const groupBase = staffBase + staffIds.length;
  const T = groupBase + p.groups.length;
  const g = new FlowGraph(T + 1);

  p.slots.forEach((_, i) => g.add(S, slotBase + i, 1, 0));
  const slotEdges: { kind: 'offer' | 'move'; index: number; edge: number; travelMin: number }[][] = p.slots.map(() => []);
  p.slots.forEach((_, i) => {
    for (const c of p.offerEdges[i] ?? []) {
      const index = staffNode.get(c.staffId) as number;
      slotEdges[i]!.push({ kind: 'offer', index, edge: g.add(slotBase + i, staffBase + index, 1, c.travelMin), travelMin: c.travelMin });
    }
    for (const m of p.moveEdges[i] ?? []) {
      slotEdges[i]!.push({ kind: 'move', index: m.group, edge: g.add(slotBase + i, groupBase + m.group, 1, m.travelMin), travelMin: m.travelMin });
    }
  });
  staffIds.forEach((_, j) => g.add(staffBase + j, T, 1, 0));
  p.groups.forEach((grp, k) => g.add(groupBase + k, T, grp.count, 0));
  g.run(S, T);

  const choices: (Choice | null)[] = p.slots.map((_, i) => {
    const used = slotEdges[i]!.find((e) => (g.adj[slotBase + i] as Edge[])[e.edge]!.cap === 0);
    if (!used) return null;
    if (used.kind === 'move') return { kind: 'move', group: used.index, travelMin: used.travelMin };
    const staffId = staffIds[used.index] as string;
    return { kind: 'offer', candidate: (p.offerEdges[i] ?? []).find((c) => c.staffId === staffId) as RankedCandidate };
  });
  return build(input, p, choices);
}

/**
 * Baseline: fill gaps one at a time (canonical order), each with its nearest
 * still-unused supply. Used to show (and test) that {@link autoMatch} never
 * covers fewer shifts or, at equal coverage, needs more travel.
 */
export function greedyMatch(input: AutoMatchInput): AutoMatchProposal {
  const p = prepare(input);
  const usedStaff = new Set<string>();
  const remaining = p.groups.map((grp) => grp.count);
  const choices: (Choice | null)[] = p.slots.map((_, i) => {
    const offer = (p.offerEdges[i] ?? []).find((c) => !usedStaff.has(c.staffId));
    const move = [...(p.moveEdges[i] ?? [])].filter((m) => (remaining[m.group] as number) > 0).sort((a, b) => a.travelMin - b.travelMin || a.group - b.group)[0];
    if (offer && (!move || offer.travelMin <= move.travelMin)) {
      usedStaff.add(offer.staffId);
      return { kind: 'offer', candidate: offer };
    }
    if (move) {
      remaining[move.group] = (remaining[move.group] as number) - 1;
      return { kind: 'move', group: move.group, travelMin: move.travelMin };
    }
    return null;
  });
  return build(input, p, choices);
}
