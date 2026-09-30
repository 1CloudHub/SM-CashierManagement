import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STEP_KINDS,
  APPROVAL_STEP_STATUSES,
  APPROVER_ROLE_BY_STEP,
  SCENARIO_STATUSES,
  SCENARIO_TRANSITIONS,
  canPublishPlan,
  canTransitionScenario,
  isScenarioSettingsEditable,
  isStepSecured,
  type ApprovalStepKind,
  type ApprovalStepStatus,
  type ApprovalStepSummary,
  type ScenarioStatus,
} from '../src/index.js';

const statusArb = fc.constantFrom(...SCENARIO_STATUSES);
const stepStatusArb = fc.constantFrom(...APPROVAL_STEP_STATUSES);

describe('scenario lifecycle', () => {
  it('only Draft scenarios have editable settings (P4 read-only published/submitted)', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        expect(isScenarioSettingsEditable(status)).toBe(status === 'draft');
      }),
    );
  });

  it('canTransitionScenario agrees with the transition table and never self-loops', () => {
    fc.assert(
      fc.property(statusArb, statusArb, (from, to) => {
        const allowed = canTransitionScenario(from, to);
        expect(allowed).toBe(SCENARIO_TRANSITIONS[from].includes(to));
        if (from === to) expect(allowed).toBe(false);
      }),
    );
  });

  it('a scenario reaches Published only via Submitted -> Approved (P10 sequencing)', () => {
    // Any walk of valid transitions starting at Draft that ends in Published must
    // have passed through Submitted and Approved.
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 12 }), (choices) => {
        let current: ScenarioStatus = 'draft';
        const visited: ScenarioStatus[] = [current];
        for (const choice of choices) {
          const next = SCENARIO_TRANSITIONS[current];
          if (next.length === 0) break;
          current = next[choice % next.length] as ScenarioStatus;
          visited.push(current);
        }
        const firstPublished = visited.indexOf('published');
        if (firstPublished >= 0) {
          const before = visited.slice(0, firstPublished);
          expect(before).toContain('submitted');
          expect(before[before.length - 1]).toBe('approved');
        }
      }),
    );
  });

  it('Archived is terminal', () => {
    expect(SCENARIO_TRANSITIONS.archived).toEqual([]);
  });
});

describe('approval steps', () => {
  it('maps each step to its approving role (Q3)', () => {
    expect(APPROVER_ROLE_BY_STEP).toEqual({ headcount: 'HR', budget: 'FIN', plan: 'EXE' });
    expect(APPROVAL_STEP_KINDS).toEqual(['headcount', 'budget', 'plan']);
  });

  it('plan can be published iff headcount and budget of the current submission are secured (P10)', () => {
    const stepArb = (step: ApprovalStepKind, submissionNo: fc.Arbitrary<number>) =>
      fc.record({
        step: fc.constant(step),
        submissionNo,
        status: stepStatusArb,
      }) as fc.Arbitrary<ApprovalStepSummary>;

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.array(
          fc.oneof(
            stepArb('headcount', fc.integer({ min: 1, max: 5 })),
            stepArb('budget', fc.integer({ min: 1, max: 5 })),
            stepArb('plan', fc.integer({ min: 1, max: 5 })),
          ),
          { maxLength: 10 },
        ),
        (currentSubmission, steps) => {
          const current = steps.filter((s) => s.submissionNo === currentSubmission);
          const secured = (kind: ApprovalStepKind) =>
            current.some((s) => s.step === kind && isStepSecured(s.status));
          expect(canPublishPlan(currentSubmission, steps)).toBe(
            secured('headcount') && secured('budget'),
          );
        },
      ),
    );
  });

  it('only approved or secured-outside steps count as secured', () => {
    const secured: ApprovalStepStatus[] = APPROVAL_STEP_STATUSES.filter(isStepSecured);
    expect(secured.sort()).toEqual(['approved', 'secured_outside']);
  });
});
