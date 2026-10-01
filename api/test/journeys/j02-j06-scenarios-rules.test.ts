/**
 * Journeys J2 (Planner refreshes a plan: duplicate the published scenario →
 * edit settings → run → compare → submit) and J6 (Rules Steward publishes a
 * new wage order: draft → Finance approval → publish → scenarios on the old
 * version go stale), on the seeded demo network through the real routes
 * (Req 8, 16; P4, P5, P6, P7, P12).
 */
import type { NetworkView, RuleVersionDetail, ScenarioComparison, ScenarioDetail } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SEASON, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { setupJourney, type Journey } from './support.js';

let j: Journey;
const PUBLISHED = demoId('scenario', DEMO_SEASON);
const PLN = { userId: demoUserId('PLN'), role: 'PLN' as const };

beforeAll(async () => {
  j = await setupJourney();
}, 120_000);

afterAll(async () => {
  await j?.dispose();
});

const scenario = async (id: string, role: 'PLN' | 'EXE' = 'PLN') => {
  const res = await j.call(role, 'GET', `/scenarios/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.scenario as ScenarioDetail;
};

describe('J2 — duplicate the published plan, edit, run, compare, submit', () => {
  let draft: ScenarioDetail;

  it('published settings are read-only (P4); only a Planner may duplicate (P12)', async () => {
    const published = await scenario(PUBLISHED);
    expect(published).toMatchObject({ status: 'published', editable: false });
    await j.audited({ status: 409 }, () =>
      j.call('PLN', 'PATCH', `/scenarios/${PUBLISHED}`, { body: { settings: { ...published.settings, growth: 1.2 } } }),
    );
    expect((await scenario(PUBLISHED)).settings).toEqual(published.settings);
    // The Executive can view but not duplicate; the Planner user acting as Executive is refused too.
    await j.audited({ status: 403 }, () => j.call('EXE', 'POST', `/scenarios/${PUBLISHED}/duplicate`, { body: {} }));
    await j.audited({ status: 403 }, () => j.as(j.emails.PLN, 'EXE', 'POST', `/scenarios/${PUBLISHED}/duplicate`, { body: {} }));
    await j.audited({ status: 403 }, () => j.call('STM', 'POST', `/scenarios/${PUBLISHED}/duplicate`, { body: {} }));
  });

  it('duplicates the published scenario as a Draft with the same settings and inputs', async () => {
    const { res, event } = await j.audited({ status: 201, ...PLN }, () =>
      j.call('PLN', 'POST', `/scenarios/${PUBLISHED}/duplicate`, { body: { name: 'Christmas 2026 — 10% growth' } }),
    );
    draft = res.body.scenario as ScenarioDetail;
    expect(event?.object_id).toBe(draft.id);
    const published = await scenario(PUBLISHED);
    expect(draft).toMatchObject({ status: 'draft', parentScenarioId: PUBLISHED, editable: true, synthetic: true });
    expect(draft.settings).toEqual(published.settings);
    expect(draft.ruleVersions.map((r) => r.ruleVersionId).sort()).toEqual(published.ruleVersions.map((r) => r.ruleVersionId).sort());
    // Not run yet: it can't be submitted.
    expect(draft.submitBlocker).not.toBeNull();
    await j.audited({ status: 409 }, () => j.call('PLN', 'POST', `/scenarios/${draft.id}/submit`, { body: {} }));
  });

  it('edits settings, runs; a settings change after the run makes it stale and blocks submit (P5)', async () => {
    const { res } = await j.audited({ status: 200, ...PLN }, () =>
      j.call('PLN', 'PATCH', `/scenarios/${draft.id}`, { body: { settings: { ...draft.settings, growth: 1.1 } } }),
    );
    expect((res.body.scenario as ScenarioDetail).settings.growth).toBe(1.1);
    const ran = await j.audited({ status: 201, ...PLN }, () => j.call('PLN', 'POST', `/scenarios/${draft.id}/run`, { body: {} }));
    expect(ran.res.body.scenario).toMatchObject({ stale: false, submitBlocker: null, latestRun: { status: 'succeeded' } });

    const edited = await j.audited({ status: 200, ...PLN }, () =>
      j.call('PLN', 'PATCH', `/scenarios/${draft.id}`, { body: { settings: { ...draft.settings, growth: 1.12 } } }),
    );
    expect(edited.res.body.scenario).toMatchObject({ stale: true, staleReasons: ['settings_changed'], submitBlocker: 'stale' });
    await j.audited({ status: 409 }, () => j.call('PLN', 'POST', `/scenarios/${draft.id}/submit`, { body: {} }));
    // Recalculate: fresh again.
    const rerun = await j.audited({ status: 201, ...PLN }, () => j.call('PLN', 'POST', `/scenarios/${draft.id}/run`, { body: {} }));
    expect(rerun.res.body.scenario).toMatchObject({ stale: false, submitBlocker: null });
  });

  it('compares the draft with the published plan: settings diff and result deltas', async () => {
    const res = await j.call('PLN', 'GET', '/scenarios/compare', { query: { a: PUBLISHED, b: draft.id } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = res.body as ScenarioComparison;
    expect(c.settings).toEqual([{ key: 'growth', from: draft.settings.growth, to: 1.12 }]);
    expect(c.results.headcount.b).toBeGreaterThanOrEqual(c.results.headcount.a ?? 0);
    // Finance sees the comparison too; a Store Manager sees Published scenarios only (the draft is a 404).
    expect((await j.call('FIN', 'GET', '/scenarios/compare', { query: { a: PUBLISHED, b: draft.id } })).status).toBe(200);
    expect((await j.call('STM', 'GET', '/scenarios/compare', { query: { a: PUBLISHED, b: draft.id } })).status).toBe(404);
    expect((await j.call('STF', 'GET', '/scenarios/compare', { query: { a: PUBLISHED, b: draft.id } })).status).toBe(403);
  });

  it('submits; the submitted settings are frozen (P4) and the approvers are asked', async () => {
    await j.audited({ status: 403 }, () => j.call('EXE', 'POST', `/scenarios/${draft.id}/submit`, { body: {} }));
    const { event } = await j.audited({ status: 200, ...PLN }, () => j.call('PLN', 'POST', `/scenarios/${draft.id}/submit`, { body: {} }));
    expect(event).toMatchObject({ action: 'submit', object_id: draft.id });
    expect((await scenario(draft.id)).status).toBe('submitted');
    await j.audited({ status: 409 }, () =>
      j.call('PLN', 'PATCH', `/scenarios/${draft.id}`, { body: { settings: { ...draft.settings, growth: 1.3 } } }),
    );
    expect((await scenario(draft.id)).settings.growth).toBe(1.12);
    expect((await j.call('HR', 'GET', `/approvals/${draft.id}`)).body.approval).toMatchObject({ submissionNo: 1, planReady: false });
  });
});

describe('J6 — a new wage order: draft, Finance approval, publish, stale scenarios', () => {
  let wagesSetId: string;
  let oldVersionId: string;
  let version: RuleVersionDetail;
  let pinned: string;
  let publishedView: NetworkView;

  it('the Planner has a fresh Draft on the current rules; the network view of the published plan is recorded', async () => {
    const created = await j.audited({ status: 201, ...PLN }, () =>
      j.call('PLN', 'POST', '/scenarios', { body: { name: 'Pinned to the old wage order', season: DEMO_SEASON } }),
    );
    pinned = (created.res.body.scenario as ScenarioDetail).id;
    await j.audited({ status: 201, ...PLN }, () => j.call('PLN', 'POST', `/scenarios/${pinned}/run`, { body: {} }));
    expect((await scenario(pinned)).stale).toBe(false);
    publishedView = (await j.call('PLN', 'GET', `/scenarios/${PUBLISHED}/network`, { query: { date: '2026-12-19' } })).body.view as NetworkView;
  });

  it('the Rules Steward drafts a new version of the wage rules (P12: only RST edits rules)', async () => {
    const sets = await j.call('RST', 'GET', '/rule-sets', { query: { synthetic: 'true' } });
    expect(sets.status).toBe(200);
    const wages = (sets.body.ruleSets as { id: string; type: string }[]).find((s) => s.type === 'wages');
    expect(wages).toBeDefined();
    wagesSetId = wages?.id ?? '';
    oldVersionId = demoId('rule_version', 'wages:1');

    const body = { effectiveFrom: '2026-11-01', changeNote: 'Wage order NCR-26 (demo)', synthetic: true };
    await j.audited({ status: 403 }, () => j.call('PLN', 'POST', `/rule-sets/${wagesSetId}/versions`, { body }));
    await j.audited({ status: 403 }, () => j.as(j.emails.RST, 'FIN', 'POST', `/rule-sets/${wagesSetId}/versions`, { body }));
    const { res } = await j.audited({ status: 201, userId: demoUserId('RST'), role: 'RST' }, () =>
      j.call('RST', 'POST', `/rule-sets/${wagesSetId}/versions`, { body }),
    );
    version = res.body.version as RuleVersionDetail;
    expect(version).toMatchObject({ status: 'draft', isCostRule: true, version: 2 });

    const payload = version.payload as { hourlyRateByRegion: Record<string, number> };
    const edited = { ...payload, hourlyRateByRegion: { ...payload.hourlyRateByRegion, NCR: 95 } };
    await j.audited({ status: 200, userId: demoUserId('RST'), role: 'RST' }, () =>
      j.call('RST', 'PATCH', `/rule-versions/${version.id}`, { body: { payload: edited } }),
    );
    // The impact panel lists the scenarios on the current version.
    const detail = await j.call('PLN', 'GET', `/rule-versions/${version.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.impact.scenarioIds).toContain(pinned);
  });

  it('a cost rule needs Finance approval before it can be published', async () => {
    await j.audited({ status: 200, userId: demoUserId('RST'), role: 'RST' }, () => j.call('RST', 'POST', `/rule-versions/${version.id}/submit`));
    // The Rules Steward publishes non-cost rules only; Finance can't publish before approving.
    await j.audited({ status: 403 }, () => j.call('RST', 'POST', `/rule-versions/${version.id}/publish`));
    await j.audited({ status: 409 }, () => j.call('FIN', 'POST', `/rule-versions/${version.id}/publish`));
    await j.audited({ status: 403 }, () => j.call('RST', 'POST', `/rule-versions/${version.id}/approve`, { body: {} }));
    // Without the role switcher, the Rules Steward can't act as Finance.
    await j.audited({ status: 403 }, () => j.as(j.emails.RST, 'FIN', 'POST', `/rule-versions/${version.id}/approve`, { body: {}, strict: true }));
    const { res } = await j.audited({ status: 200, userId: demoUserId('FIN'), role: 'FIN' }, () =>
      j.call('FIN', 'POST', `/rule-versions/${version.id}/approve`, { body: { comment: 'Matches the wage board order' } }),
    );
    expect(res.body.version).toMatchObject({ status: 'approved', financeApprovedBy: demoUserId('FIN') });
  });

  it('Finance publishes: the old version is superseded and the scenarios using it go stale (P5) and cannot be submitted', async () => {
    const { res, event } = await j.audited({ status: 200, userId: demoUserId('FIN'), role: 'FIN' }, () =>
      j.call('FIN', 'POST', `/rule-versions/${version.id}/publish`),
    );
    expect(event?.action).toBe('publish');
    expect(res.body).toMatchObject({ version: { status: 'published' }, supersededVersionId: oldVersionId });
    expect(res.body.staleScenarioIds).toContain(pinned);

    const stale = await scenario(pinned);
    expect(stale).toMatchObject({ stale: true, submitBlocker: 'stale' });
    await j.audited({ status: 409 }, () => j.call('PLN', 'POST', `/scenarios/${pinned}/submit`, { body: {} }));

    const history = await j.call('EXE', 'GET', `/rule-sets/${wagesSetId}/versions`, { query: { synthetic: 'true' } });
    expect((history.body.versions as { id: string; status: string }[]).map((v) => [v.id, v.status])).toEqual(
      expect.arrayContaining([
        [version.id, 'published'],
        [oldVersionId, 'superseded'],
      ]),
    );
  });

  it('P6: the published plan keeps its recorded rule versions and results', async () => {
    const published = await scenario(PUBLISHED);
    expect(published.status).toBe('published');
    expect(published.ruleVersions.map((r) => r.ruleVersionId)).toContain(oldVersionId);
    expect(published.latestRun?.ruleVersionIds).toContain(oldVersionId);
    const view = (await j.call('PLN', 'GET', `/scenarios/${PUBLISHED}/network`, { query: { date: '2026-12-19' } })).body.view as NetworkView;
    expect(view.provenance.ruleVersionIds).toContain(oldVersionId);
    expect(view.kpis).toEqual(publishedView.kpis);
  });

  it('refreshing the stale scenario re-pins a new Draft to the new wage order', async () => {
    const { res } = await j.audited({ status: 201, ...PLN }, () => j.call('PLN', 'POST', `/scenarios/${pinned}/refresh`, { body: {} }));
    const fresh = res.body.scenario as ScenarioDetail;
    expect(fresh).toMatchObject({ status: 'draft', parentScenarioId: pinned, stale: false });
    expect(fresh.ruleVersions.map((r) => r.ruleVersionId)).toContain(version.id);
    expect(fresh.ruleVersions.map((r) => r.ruleVersionId)).not.toContain(oldVersionId);
  });

  it('a non-cost rule (lead times) is published by the Rules Steward without Finance', async () => {
    const sets = (await j.call('RST', 'GET', '/rule-sets', { query: { synthetic: 'true' } })).body.ruleSets as { id: string; type: string }[];
    const leadTimes = sets.find((s) => s.type === 'lead_times')?.id ?? '';
    const created = await j.audited({ status: 201 }, () =>
      j.call('RST', 'POST', `/rule-sets/${leadTimes}/versions`, {
        body: { effectiveFrom: '2026-11-01', changeNote: 'Longer onboarding (demo)', synthetic: true },
      }),
    );
    const id = (created.res.body.version as RuleVersionDetail).id;
    await j.audited({ status: 403 }, () => j.call('FIN', 'POST', `/rule-versions/${id}/publish`));
    const { res } = await j.audited({ status: 200, userId: demoUserId('RST'), role: 'RST' }, () => j.call('RST', 'POST', `/rule-versions/${id}/publish`));
    expect(res.body.version).toMatchObject({ status: 'published', isCostRule: false, financeApprovedBy: null });
  });
});
