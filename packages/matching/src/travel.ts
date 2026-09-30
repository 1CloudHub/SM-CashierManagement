/**
 * Travel-time matrix (task 16.2, Req 11.2, 11.3).
 *
 * Travel time runs from a staff member's home area (barangay) to a store, per
 * mode and time window, and is precomputed as a matrix. Matching only ever
 * reads the matrix; it never calls a routing service itself.
 *
 * The real provider — the Amazon Location Service route matrix (car) — is
 * wired in task 24 behind {@link TravelTimeProvider}. Public-transport times
 * are estimated from car times with a speed factor until a transit source is
 * chosen (design Q22). Providers receive barangay-level home areas only;
 * resolving a barangay to a routable point is the provider's concern and no
 * coordinate ever enters this package.
 */
import { dayOfWeek } from './calendar.js';
import { homeAreaId, type HomeArea, type IsoDate, type IsoDateTime } from './privacy.js';

export type TravelMode = 'public_transport' | 'car';
export const TRAVEL_MODES: readonly TravelMode[] = ['public_transport', 'car'];

/** Map ring bands (minutes) per mode: 15/30/45 by public transport, 20/40/60 by car. */
export const RING_BANDS_MIN: Readonly<Record<TravelMode, readonly [number, number, number]>> = {
  public_transport: [15, 30, 45],
  car: [20, 40, 60],
};

export type RingBand = 1 | 2 | 3;

/** Innermost ring (1–3) that contains `minutes`, or `null` beyond the outer ring. */
export function ringBand(mode: TravelMode, minutes: number): RingBand | null {
  const [a, b, c] = RING_BANDS_MIN[mode];
  if (minutes <= a) return 1;
  if (minutes <= b) return 2;
  if (minutes <= c) return 3;
  return null;
}

export type DayType = 'weekday' | 'weekend';
/** Day parts: early 00:00–10:00, midday 10:00–16:00, evening 16:00–24:00. */
export type DayPart = 'early' | 'midday' | 'evening';
export type TimeWindowId = `${DayType}-${DayPart}`;

export const TIME_WINDOWS: readonly TimeWindowId[] = [
  'weekday-early',
  'weekday-midday',
  'weekday-evening',
  'weekend-early',
  'weekend-midday',
  'weekend-evening',
];

/** The precomputed window a shift starting at `startHour` on `date` falls in. */
export function timeWindowOf(date: IsoDate, startHour: number): TimeWindowId {
  const dow = dayOfWeek(date);
  const dayType: DayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
  const h = ((startHour % 24) + 24) % 24;
  const part: DayPart = h < 10 ? 'early' : h < 16 ? 'midday' : 'evening';
  return `${dayType}-${part}`;
}

/** One cell of the matrix (DOM-002 TravelTime). */
export interface TravelTimeEntry {
  readonly homeAreaId: string;
  readonly storeId: string;
  readonly mode: TravelMode;
  readonly window: TimeWindowId;
  readonly minutes: number;
  readonly computedAt: IsoDateTime;
}

export interface TravelTimeRequest {
  readonly homeAreas: readonly HomeArea[];
  readonly storeIds: readonly string[];
  readonly mode: TravelMode;
  readonly window: TimeWindowId;
}

/**
 * Injectable source of travel times. Implementations may do I/O (the Amazon
 * Location Service adapter will); this package only defines the contract.
 */
export interface TravelTimeProvider {
  readonly name: string;
  /** Modes the provider computes itself; others are derived (see {@link precomputeMatrix}). */
  readonly supportedModes: readonly TravelMode[];
  computeMatrix(request: TravelTimeRequest): Promise<readonly TravelTimeEntry[]>;
}

const key = (homeArea: string, storeId: string, mode: TravelMode, window: TimeWindowId) =>
  `${homeArea}\u0000${storeId}\u0000${mode}\u0000${window}`;

/** Immutable, precomputed home-area × store × mode × window lookup. */
export class TravelTimeMatrix {
  readonly #cells: ReadonlyMap<string, TravelTimeEntry>;

  private constructor(cells: ReadonlyMap<string, TravelTimeEntry>) {
    this.#cells = cells;
  }

  static fromEntries(entries: Iterable<TravelTimeEntry>): TravelTimeMatrix {
    const cells = new Map<string, TravelTimeEntry>();
    for (const e of entries) {
      if (!Number.isFinite(e.minutes) || e.minutes < 0) {
        throw new Error(`Invalid travel time ${e.minutes} for ${e.homeAreaId} → ${e.storeId}`);
      }
      const k = key(e.homeAreaId, e.storeId, e.mode, e.window);
      if (cells.has(k)) throw new Error(`Duplicate travel time for ${e.homeAreaId} → ${e.storeId} (${e.mode}, ${e.window})`);
      cells.set(k, { ...e });
    }
    return new TravelTimeMatrix(cells);
  }

  get size(): number {
    return this.#cells.size;
  }

  /** Minutes from the home area to the store, or `undefined` when not computed. */
  lookup(homeArea: HomeArea | string, storeId: string, mode: TravelMode, window: TimeWindowId): number | undefined {
    const id = typeof homeArea === 'string' ? homeArea : homeAreaId(homeArea);
    return this.#cells.get(key(id, storeId, mode, window))?.minutes;
  }

  entries(): TravelTimeEntry[] {
    return [...this.#cells.values()];
  }
}

/**
 * Public-transport estimate = car minutes × speed factor (design Q22).
 * Placeholder until DOM-003 fixes the configured value.
 */
export const DEFAULT_PT_SPEED_FACTOR = 1.5;

export function derivePublicTransport(
  carEntries: readonly TravelTimeEntry[],
  speedFactor: number = DEFAULT_PT_SPEED_FACTOR,
): TravelTimeEntry[] {
  if (!Number.isFinite(speedFactor) || speedFactor < 1) {
    throw new Error(`Public-transport speed factor must be >= 1, got ${speedFactor}`);
  }
  return carEntries
    .filter((e) => e.mode === 'car')
    .map((e) => ({ ...e, mode: 'public_transport' as const, minutes: Math.ceil(e.minutes * speedFactor) }));
}

export interface PrecomputeOptions {
  readonly homeAreas: readonly HomeArea[];
  readonly storeIds: readonly string[];
  readonly modes?: readonly TravelMode[];
  readonly windows?: readonly TimeWindowId[];
  readonly publicTransportSpeedFactor?: number;
}

/**
 * Build the full matrix for every requested mode and window. Modes the
 * provider does not support are derived from car times (public transport
 * only). Entries for pairs that were not requested are dropped.
 */
export async function precomputeMatrix(provider: TravelTimeProvider, opts: PrecomputeOptions): Promise<TravelTimeMatrix> {
  const modes = opts.modes ?? TRAVEL_MODES;
  const windows = opts.windows ?? TIME_WINDOWS;
  const wantedAreas = new Set(opts.homeAreas.map(homeAreaId));
  const wantedStores = new Set(opts.storeIds);
  const direct = modes.filter((m) => provider.supportedModes.includes(m));
  const derived = modes.filter((m) => !provider.supportedModes.includes(m));
  for (const m of derived) {
    if (m !== 'public_transport' || !provider.supportedModes.includes('car')) {
      throw new Error(`Provider ${provider.name} cannot supply ${m} travel times`);
    }
  }
  const fetchModes = derived.length > 0 && !direct.includes('car') ? [...direct, 'car' as const] : direct;

  const out: TravelTimeEntry[] = [];
  for (const window of windows) {
    for (const mode of fetchModes) {
      const got = await provider.computeMatrix({ homeAreas: opts.homeAreas, storeIds: opts.storeIds, mode, window });
      const clean = got.filter(
        (e) => e.mode === mode && e.window === window && wantedAreas.has(e.homeAreaId) && wantedStores.has(e.storeId),
      );
      if (modes.includes(mode)) out.push(...clean);
      if (mode === 'car' && derived.length > 0) out.push(...derivePublicTransport(clean, opts.publicTransportSpeedFactor));
    }
  }
  return TravelTimeMatrix.fromEntries(out);
}
