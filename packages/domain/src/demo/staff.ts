/**
 * Deterministic demo cashier roster pool (names, contract types, preferred rest
 * days, availability exceptions). Synthetic only.
 */
import { addDays } from '../calendar.js';
import type { StaffMember } from '../labor.js';
import type { ContractType, IsoDate } from '../types.js';
import { createPrng, hashSeed } from './prng.js';

const GIVEN = [
  'Ana', 'Maria', 'Jose', 'Juan', 'Rosa', 'Carmela', 'Paolo', 'Liza', 'Mark', 'Joy',
  'Grace', 'Ramon', 'Kristine', 'Angelo', 'Bea', 'Carlo', 'Divina', 'Edwin', 'Faith', 'Gilbert',
  'Hazel', 'Ivy', 'Jericho', 'Karen', 'Leo', 'Mylene', 'Nestor', 'Orly', 'Precious', 'Queenie',
];
const FAMILY = [
  'Reyes', 'Santos', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Villanueva', 'Ramos',
  'Aquino', 'Castillo', 'Flores', 'Dela Cruz', 'Gonzales', 'Navarro', 'Pascual', 'Salazar', 'Tolentino', 'Valdez',
];

export interface StaffPoolSpec {
  readonly storeId: string;
  readonly departmentId: string;
  readonly counts: Readonly<Record<ContractType, number>>;
  /** First day of the period, used to place availability exceptions. */
  readonly periodStart: IsoDate;
  readonly periodDays: number;
  readonly seed?: number;
}

export function generateStaffPool(spec: StaffPoolSpec): StaffMember[] {
  const rng = createPrng(((spec.seed ?? 2026) ^ hashSeed(spec.departmentId)) >>> 0);
  const out: StaffMember[] = [];
  for (const type of ['FT', 'PT', 'FLOAT'] as const) {
    for (let i = 0; i < spec.counts[type]; i += 1) {
      const unavailable: IsoDate[] = [];
      // ~1 in 6 people has one unavailable day in the period.
      if (rng.next() < 1 / 6) unavailable.push(addDays(spec.periodStart, rng.int(0, Math.max(0, spec.periodDays - 1))));
      out.push({
        id: `${spec.departmentId}:${type.toLowerCase()}-${String(i + 1).padStart(3, '0')}`,
        name: `${rng.pick(GIVEN)} ${rng.pick(FAMILY)}`,
        storeId: spec.storeId,
        departmentId: spec.departmentId,
        contractType: type,
        preferredRestDay: (i * 3 + (type === 'FT' ? 1 : type === 'PT' ? 2 : 4)) % 7,
        unavailableDates: unavailable,
      });
    }
  }
  return out;
}
