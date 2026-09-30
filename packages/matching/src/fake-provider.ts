/**
 * Deterministic travel-time provider for tests and the demo (no I/O).
 *
 * Minutes are a pure function of (home area, store, mode, window): a stable
 * FNV-1a hash picks a base car time of 8–67 min per home-area/store pair,
 * scaled by a day-part congestion factor and, for public transport, by the
 * speed factor. `overrides` pins specific pairs (`homeAreaId|storeId|mode`).
 */
import { homeAreaId } from './privacy.js';
import {
  DEFAULT_PT_SPEED_FACTOR,
  TRAVEL_MODES,
  type TimeWindowId,
  type TravelMode,
  type TravelTimeEntry,
  type TravelTimeProvider,
  type TravelTimeRequest,
} from './travel.js';

export interface FakeTravelTimeProviderOptions {
  readonly supportedModes?: readonly TravelMode[];
  readonly overrides?: Readonly<Record<string, number>>;
  readonly computedAt?: string;
}

const CONGESTION: Readonly<Record<string, number>> = { early: 0.9, midday: 1, evening: 1.25 };

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export class FakeTravelTimeProvider implements TravelTimeProvider {
  readonly name = 'fake';
  readonly supportedModes: readonly TravelMode[];
  readonly #overrides: Readonly<Record<string, number>>;
  readonly #computedAt: string;

  constructor(opts: FakeTravelTimeProviderOptions = {}) {
    this.supportedModes = opts.supportedModes ?? TRAVEL_MODES;
    this.#overrides = opts.overrides ?? {};
    this.#computedAt = opts.computedAt ?? '1970-01-01T00:00:00Z';
  }

  minutes(areaId: string, storeId: string, mode: TravelMode, window: TimeWindowId): number {
    const pinned = this.#overrides[`${areaId}|${storeId}|${mode}`];
    if (pinned !== undefined) return pinned;
    const car = 8 + (fnv1a(`${areaId}|${storeId}`) % 60);
    const part = window.split('-')[1] ?? 'midday';
    const scaled = car * (CONGESTION[part] ?? 1) * (mode === 'public_transport' ? DEFAULT_PT_SPEED_FACTOR : 1);
    return Math.max(1, Math.round(scaled));
  }

  async computeMatrix(req: TravelTimeRequest): Promise<readonly TravelTimeEntry[]> {
    if (!this.supportedModes.includes(req.mode)) throw new Error(`fake provider: ${req.mode} not supported`);
    const out: TravelTimeEntry[] = [];
    for (const area of req.homeAreas) {
      const id = homeAreaId(area);
      for (const storeId of req.storeIds) {
        out.push({ homeAreaId: id, storeId, mode: req.mode, window: req.window, minutes: this.minutes(id, storeId, req.mode, req.window), computedAt: this.#computedAt });
      }
    }
    return out;
  }
}
