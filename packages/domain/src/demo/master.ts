/**
 * Demo master data and generator parameters for the prototype v3 sample
 * network (DOM-001 Fixture B): 8 stores across 4 formats, 24 departments,
 * hourly Aug 1 – Dec 31 2025.
 *
 * The v3 seeded dataset itself is not in the repository, so this is a
 * reconstruction that follows DOM-001's documented shape. Trading hours were
 * chosen so the dataset has exactly 47,548 rows; per-department volumes
 * (`baseDaily`), handle times, installed lanes, the demand-profile factors and
 * hourly shapes in generator.ts were calibrated offline so the pipeline, run
 * with DEMO_RULE_SET, reproduces the Fixture C figures on this snapshot (see
 * test/parity.test.ts). They are synthetic and make no claim about SM trading.
 */
import type { Department, StoreFormat, Store, TradingHoursRule } from '../types.js';

export type DemandProfile =
  | 'grocery'
  | 'express'
  | 'generalMerchandise'
  | 'fashion'
  | 'kidsToys'
  | 'home'
  | 'beauty'
  | 'shoesBags';

export interface DepartmentSeed {
  readonly department: Department;
  readonly profile: DemandProfile;
  /** 2025 mean transactions on a normal (Mon–Thu, non-payday) base-period day. */
  readonly baseDaily: number;
  /** Base-period average handle time (seconds). */
  readonly ahtSec: number;
  /** Mean items per transaction and mean price per item (₱). */
  readonly itemsPerTxn: number;
  readonly pricePerItem: number;
}

/** Trading hours by format (reconstructed so the dataset has exactly 47,548 hourly rows). */
export const TRADING_HOURS: Readonly<Record<StoreFormat, TradingHoursRule>> = {
  Supermarket: {
    default: { open: 8, close: 22 },
    byMonth: { 12: { open: 8, close: 23 } },
    byMonthDay: { '12-24': { close: 19 }, '12-25': { open: 11 }, '12-31': { close: 20 } },
  },
  Hypermarket: {
    default: { open: 8, close: 22 },
    byMonth: { 12: { open: 8, close: 23 } },
    byMonthDay: { '12-24': { close: 19 }, '12-25': { open: 11 }, '12-31': { close: 20 } },
  },
  'SM Store': {
    default: { open: 10, close: 22 },
    byMonth: { 12: { open: 10, close: 23 } },
    byMonthDay: { '12-24': { close: 19 }, '12-25': { open: 11 }, '12-31': { close: 20 } },
  },
  SaveMore: {
    default: { open: 8, close: 20 },
    byMonthDay: { '12-24': { close: 19 }, '12-25': { open: 11 } },
  },
};

export const DEMO_STORES: readonly Store[] = [
  { id: 'smsm-qc', name: 'SM Supermarket – Quezon City', format: 'Supermarket', region: 'NCR' },
  { id: 'smsm-ceb', name: 'SM Supermarket – Cebu City', format: 'Supermarket', region: 'Central Visayas' },
  { id: 'smhm-pam', name: 'SM Hypermarket – Pampanga', format: 'Hypermarket', region: 'Central Luzon' },
  { id: 'smhm-dav', name: 'SM Hypermarket – Davao', format: 'Hypermarket', region: 'Davao Region' },
  { id: 'sms-mnl', name: 'SM Store – Manila', format: 'SM Store', region: 'NCR' },
  { id: 'sms-mkt', name: 'SM Store – Makati', format: 'SM Store', region: 'NCR' },
  { id: 'svm-ilo', name: 'SaveMore – Iloilo', format: 'SaveMore', region: 'Western Visayas' },
  { id: 'svm-lpc', name: 'SaveMore – Las Piñas', format: 'SaveMore', region: 'NCR' },
];

function dept(
  storeId: string,
  key: string,
  name: string,
  installedLanes: number,
  minLanes: number,
  profile: DemandProfile,
  baseDaily: number,
  ahtSec: number,
  itemsPerTxn: number,
  pricePerItem: number,
): DepartmentSeed {
  const store = DEMO_STORES.find((s) => s.id === storeId);
  if (!store) throw new Error(`Unknown demo store ${storeId}`);
  return {
    department: {
      id: `${storeId}:${key}`,
      storeId,
      name,
      installedLanes,
      minLanes,
      tradingHours: TRADING_HOURS[store.format],
    },
    profile,
    baseDaily,
    ahtSec,
    itemsPerTxn,
    pricePerItem,
  };
}

export const DEMO_DEPARTMENT_SEEDS: readonly DepartmentSeed[] = [
  dept('smsm-qc', 'main', 'Main lanes', 32, 2, 'grocery', 1632.45, 146, 9, 95),
  dept('smsm-qc', 'express', 'Express lanes', 10, 1, 'express', 971, 70, 3, 80),
  dept('smsm-ceb', 'main', 'Main lanes', 24, 2, 'grocery', 1422, 150, 9, 90),
  dept('smsm-ceb', 'express', 'Express lanes', 10, 1, 'express', 942, 70, 3, 78),
  dept('smhm-pam', 'main', 'Main lanes', 44, 3, 'grocery', 2671, 160, 11, 88),
  dept('smhm-pam', 'express', 'Express lanes', 14, 1, 'express', 1439, 70, 3, 80),
  dept('smhm-pam', 'gm', 'General merchandise', 10, 1, 'generalMerchandise', 352, 110, 2, 420),
  dept('smhm-dav', 'main', 'Main lanes', 54, 3, 'grocery', 2804, 160, 11, 86),
  dept('smhm-dav', 'express', 'Express lanes', 12, 1, 'express', 1291, 70, 3, 78),
  dept('smhm-dav', 'gm', 'General merchandise', 10, 1, 'generalMerchandise', 280, 110, 2, 400),
  dept('sms-mnl', 'fashion', 'Ladies and men’s fashion', 16, 1, 'fashion', 671, 120, 2, 650),
  dept('sms-mnl', 'kids-toys', 'Kids and toys', 12, 1, 'kidsToys', 351, 120, 2, 480),
  dept('sms-mnl', 'home', 'Home and appliances', 10, 1, 'home', 274, 150, 1.5, 1200),
  dept('sms-mnl', 'beauty', 'Beauty and accessories', 10, 1, 'beauty', 419, 90, 2, 380),
  dept('sms-mnl', 'shoes-bags', 'Shoes and bags', 10, 1, 'shoesBags', 277, 110, 1.3, 1500),
  dept('sms-mkt', 'fashion', 'Ladies and men’s fashion', 16, 1, 'fashion', 671, 120, 2, 700),
  dept('sms-mkt', 'kids-toys', 'Kids and toys', 12, 1, 'kidsToys', 330, 120, 2, 500),
  dept('sms-mkt', 'home', 'Home and appliances', 10, 1, 'home', 255, 150, 1.5, 1300),
  dept('sms-mkt', 'beauty', 'Beauty and accessories', 10, 1, 'beauty', 449, 90, 2, 400),
  dept('sms-mkt', 'shoes-bags', 'Shoes and bags', 10, 1, 'shoesBags', 358, 110, 1.3, 1600),
  dept('svm-ilo', 'main', 'Main lanes', 12, 2, 'grocery', 593, 140, 8, 80),
  dept('svm-ilo', 'express', 'Express lanes', 8, 1, 'express', 562, 70, 3, 70),
  dept('svm-lpc', 'main', 'Main lanes', 20, 2, 'grocery', 777, 140, 8, 82),
  dept('svm-lpc', 'express', 'Express lanes', 6, 1, 'express', 560, 70, 3, 72),
];

export const DEMO_DEPARTMENTS: readonly Department[] = DEMO_DEPARTMENT_SEEDS.map((s) => s.department);
