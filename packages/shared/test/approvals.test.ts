/**
 * Approval workflow model (task 12; Req 9; P10 approval sequencing, step
 * ordering, P12 approver roles). fast-check drives the reference model with
 * random command sequences by random roles.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_DECISIONS,
  APPROVAL_STEP_KINDS,
  APPROVER_ROLE_BY_STEP,
  ROLE_CODES,
  STEP_DECISIONS,
  applyApprovalCommand,
  approvalActionsFor,
  awaitsRole,
  isPlanReady,
  isStepSecured,
  stepStatusOf,
  submissionStatuses,
  type ApprovalCommand,
  type ApprovalState,
} from '../src/index.js';

const DRAFT: ApprovalState = { scenarioStatus: 'draft', stale: false, submissionNo: 0, steps: [] };

function submitted(): ApprovalState {
  const out = applyApprovalCommand(DRAFT, { kind: 'submit' });
  if (!out.ok) throw new Error('submit refused');
  return out.state;
}

function run(state: ApprovalState, ...commands: ApprovalCommand[]): ApprovalState {
  return commands.reduce((s, c) => {
    const out = applyApprovalCommand(s, c);
    if (!out.ok) throw new Error(`${c.kind} refused: ${out.reason}`);
    return out.state;
  }, state);
}

const text = fc.oneof(fc.constant(''), fc.constant('   '), fc.string({ minLength: 1, maxLength: 12 }));

const commandArb: fc.Arbitrary<ApprovalCommand> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<ApprovalCommand>({ kind: 'submit' }) },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('decide' as const),
      role: fc.constantFrom(...ROLE_CODES),
      step: fc.constantFrom(...APPROVAL_STEP_KINDS),
      decision: fc.constantFrom(...APPROVAL_DECISIONS),
      comment: text,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('record_outside' as const),
      role: fc.constantFrom(...ROLE_CODES),
      step: fc.constantFrom(...APPROVAL_STEP_KINDS),
      reference: text,
      note: text,
    }),
  },
);

/** Commands biased towards the right approver, so long sequences reach publish. */
const likelyCommandArb: fc.Arbitrary<ApprovalCommand> = fc.oneof(
  commandArb,
  fc.constantFrom(...APPROVAL_STEP_KINDS).chain((step) =>
    fc.record({
      kind: fc.constant('decide' as const),
      role: fc.constant(APPROVER_ROLE_BY_STEP[step]),
      step: fc.constant(step),
      decision: fc.constantFrom(...STEP_DECISIONS[step], 'approve', 'approve'),
      comment: fc.constant('ok'),
    }),
  ),
  fc.record({
    kind: fc.constant('record_outside' as const),
    role: fc.constant('EXE' as const),
    step: fc.constantFrom('headcount' as const, 'budget' as const),
    reference: fc.constant('email 2 Oct'),
    note: fc.constant('Agreed in the ExCom meeting'),
  }),
);

const secure = fc.constantFrom<'approve' | 'outside'>('approve', 'outside');
const secureCmd = (step: 'headcount' | 'budget', how: 'approve' | 'outside'): ApprovalCommand =>
    how === 'outside'
  ? { kind: 'record_outside', role: 'EXE', step, reference: 'ref', note: 'note' }
  : { kind: 'decide', role: APPROVER_ROLE_BY_STEP[step], step, decision: 'approve' };

describe('P10 approval sequencing (reference model)', () => {
  it('a plan publishes only when headcount and budget of the current submission are secured', () => {
    fc.assert(
      fc.property(fc.array(likelyCommandArb, { maxLength: 40 }), (commands) => {
        let state = DRAFT;
        for (const command of commands) {
          if (state.scenarioStatus === 'published') break;
          const out = applyApprovalCommand(state, command);
          if (!out.ok) continue;
          if (out.published) {
            expect(command).toMatchObject({ kind: 'decide', step: 'plan', decision: 'approve', role: 'EXE' });
            expect(isStepSecured(stepStatusOf(state, 'headcount') ?? 'pending')).toBe(true);
            expect(isStepSecured(stepStatusOf(state, 'budget') ?? 'pending')).toBe(true);
            expect(out.state.scenarioStatus).toBe('published');
          } else {
            expect(out.state.scenarioStatus).not.toBe('published');
          }
          state = out.state;
        }
      }),
      { numRuns: 400 },
    );
  });

  it('reaches Published for some sequences (the property is not vacuous)', () => {
    const published = run(
      submitted(),
      { kind: 'record_outside', role: 'EXE', step: 'budget', reference: 'email 2 Oct', note: 'Board OK' },
      { kind: 'decide', role: 'HR', step: 'headcount', decision: 'approve' },
      { kind: 'decide', role: 'EXE', step: 'plan', decision: 'approve' },
    );
    expect(published.scenarioStatus).toBe('published');
    expect(submissionStatuses(published)).toEqual(['approved', 'secured_outside', 'approved']);
  });

  it('keeps every plan decision unavailable until both steps are secured (Req 9.4)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pending', 'approved', 'secured_outside'),
        fc.constantFrom('pending', 'approved', 'secured_outside'),
        fc.constantFrom(...APPROVAL_DECISIONS),
        (headcount, budget, decision) => {
          const s = submitted();
          const state: ApprovalState = {
            ...s,
            steps: s.steps.map((x) => (x.step === 'headcount' ? { ...x, status: headcount } : x.step === 'budget' ? { ...x, status: budget } : x)),
          };
          const ready = headcount !== 'pending' && budget !== 'pending';
          expect(isPlanReady(state)).toBe(ready);
          const out = applyApprovalCommand(state, { kind: 'decide', role: 'EXE', step: 'plan', decision, comment: 'why' });
          expect(out.ok).toBe(ready);
          if (!out.ok) expect(out.reason).toBe('not_ready');
          expect(approvalActionsFor('EXE', state).decide.plan.length > 0).toBe(ready);
        },
      ),
    );
  });
});

describe('step ordering and resets', () => {
  it('decides headcount and budget in either order with the same result (Req 9.2)', () => {
    fc.assert(
      fc.property(secure, secure, (h, b) => {
        const hb = run(submitted(), secureCmd('headcount', h), secureCmd('budget', b));
        const bh = run(submitted(), secureCmd('budget', b), secureCmd('headcount', h));
        expect(hb).toEqual({ ...bh, steps: hb.steps.map((s) => bh.steps.find((x) => x.step === s.step)) });
        expect(isPlanReady(hb)).toBe(true);
      }),
    );
  });

  it('returns to Draft on request-changes / reject, and a resubmission opens fresh steps (Req 9.6)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...APPROVAL_STEP_KINDS).chain((step) => fc.tuple(fc.constant(step), fc.constantFrom(...STEP_DECISIONS[step].filter((d) => d !== 'approve')))),
        ([step, decision]) => {
          let state = run(submitted(), secureCmd('headcount', 'outside'), secureCmd('budget', 'approve'));
          if (step !== 'plan') state = { ...state, steps: state.steps.map((s) => (s.step === step ? { ...s, status: 'pending' } : s)) };
          const role = APPROVER_ROLE_BY_STEP[step];
          const refused = applyApprovalCommand(state, { kind: 'decide', role, step, decision, comment: ' ' });
          expect(refused).toEqual({ ok: false, reason: 'comment_required' });
          const back = run(state, { kind: 'decide', role, step, decision, comment: 'Please revisit PT mix' });
          expect(back.scenarioStatus).toBe('draft');
          const again = run(back, { kind: 'submit' });
          expect(again.submissionNo).toBe(state.submissionNo + 1);
          expect(submissionStatuses(again)).toEqual(['pending', 'pending', 'pending']);
          // The earlier submission's record is kept as history.
          expect(submissionStatuses(again, state.submissionNo)).toEqual(submissionStatuses(back, state.submissionNo));
        },
      ),
    );
  });

  it('refuses any decision while the scenario is paused (stale) or not submitted', () => {
    fc.assert(
      fc.property(commandArb, (command) => {
        if (command.kind === 'submit') return;
        const paused = { ...submitted(), stale: true };
        expect(applyApprovalCommand(paused, command).ok).toBe(false);
        expect(applyApprovalCommand(DRAFT, command).ok).toBe(false);
      }),
    );
  });
});

describe('approver roles (Q3, Q19; P12)', () => {
  it('only the step approver decides, and only the Executive records off-system for headcount/budget', () => {
    fc.assert(
      fc.property(commandArb, (command) => {
        if (command.kind === 'submit') return;
        const out = applyApprovalCommand(run(submitted(), secureCmd('headcount', 'approve'), secureCmd('budget', 'approve')), command);
        const before = submitted();
        const fresh = applyApprovalCommand(before, command);
        for (const o of [out, fresh]) {
          if (!o.ok) continue;
          if (command.kind === 'decide') expect(command.role).toBe(APPROVER_ROLE_BY_STEP[command.step]);
          else {
            expect(command.role).toBe('EXE');
            expect(command.step).not.toBe('plan');
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('lists exactly the actions the model accepts', () => {
    const stateArb = fc.array(likelyCommandArb, { maxLength: 8 }).map((commands) =>
      commands.reduce((s, c) => {
        const o = applyApprovalCommand(s, c);
        return o.ok ? o.state : s;
      }, submitted()),
    );
    fc.assert(
      fc.property(stateArb, fc.constantFrom(...ROLE_CODES), fc.boolean(), (state0, role, stale) => {
        const state = { ...state0, stale };
        const actions = approvalActionsFor(role, state);
        for (const step of APPROVAL_STEP_KINDS) {
          for (const decision of APPROVAL_DECISIONS) {
            const ok = applyApprovalCommand(state, { kind: 'decide', role, step, decision, comment: 'c' }).ok;
            expect(actions.decide[step].includes(decision)).toBe(ok);
          }
          const recorded = applyApprovalCommand(state, { kind: 'record_outside', role, step, reference: 'r', note: 'n' }).ok;
          expect((actions.recordOutside as readonly string[]).includes(step)).toBe(recorded);
        }
        expect(awaitsRole(role, state)).toBe(
          APPROVAL_STEP_KINDS.some((k) => actions.decide[k].length > 0) || actions.recordOutside.length > 0,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('requires both a reference and a note for an off-system record (Req 9.3)', () => {
    const s = submitted();
    expect(applyApprovalCommand(s, { kind: 'record_outside', role: 'EXE', step: 'budget', reference: 'email', note: '' })).toEqual({
      ok: false,
      reason: 'reference_required',
    });
    expect(applyApprovalCommand(s, { kind: 'record_outside', role: 'EXE', step: 'plan', reference: 'x', note: 'y' })).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
  });
});
