/**
 * @lanewise/matching — cross-store matching for LaneWise (tasks 16.2–16.4).
 * Pure TypeScript, no I/O: travel-time matrix model + provider contract, and
 * deterministic candidate eligibility/ranking for open shifts, and the
 * network-wide auto-match proposal (P15, P16).
 */
export * from './privacy.js';
export * from './travel.js';
export * from './fake-provider.js';
export * from './matching.js';
export * from './auto-match.js';
