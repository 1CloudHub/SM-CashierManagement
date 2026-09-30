/**
 * RBAC runtime configuration (task 8.1/8.2).
 *
 * `DEMO_ROLE_SWITCHER` switches the demo role switcher (requirement 3) — on
 * unless set to `false`/`0`/`off`/`no`. With it on, every signed-in user may
 * make any of the 8 roles active; roles they don't hold use the demo scopes
 * from design.md › Role switcher (Store Manager = the demo QC store, Staff =
 * the demo cashier PT-02, everyone else global).
 */
export interface RbacConfig {
  readonly demoRoleSwitcher: boolean;
  /** `store.code` of the Store Manager demo store (SM Supermarket – Quezon City). */
  readonly demoStoreCode: string;
  /** `staff.employee_no` of the Staff demo cashier, at the demo store. */
  readonly demoStaffEmployeeNo: string;
}

export const DEFAULT_RBAC_CONFIG: RbacConfig = {
  demoRoleSwitcher: true,
  demoStoreCode: 'smsm-qc',
  demoStaffEmployeeNo: 'PT-02',
};

/** Parses a boolean flag; anything unrecognised falls back to `fallback`. */
export function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(v)) return false;
  if (['true', '1', 'on', 'yes'].includes(v)) return true;
  return fallback;
}

export function rbacConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RbacConfig {
  return {
    demoRoleSwitcher: parseFlag(env.DEMO_ROLE_SWITCHER, DEFAULT_RBAC_CONFIG.demoRoleSwitcher),
    demoStoreCode: env.DEMO_STORE_CODE || DEFAULT_RBAC_CONFIG.demoStoreCode,
    demoStaffEmployeeNo: env.DEMO_STAFF_EMPLOYEE_NO || DEFAULT_RBAC_CONFIG.demoStaffEmployeeNo,
  };
}
