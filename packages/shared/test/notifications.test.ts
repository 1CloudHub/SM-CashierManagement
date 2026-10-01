import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MANDATORY_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_NAMES,
  NOTIFICATION_FILTER_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  eventsInCategories,
  notificationCategory,
  notificationLink,
  resolvePreferences,
  shouldEmail,
  showsInApp,
  type NotificationCategory,
  type NotificationPreferenceOverrides,
} from '../src/index.js';

const overridesArb: fc.Arbitrary<NotificationPreferenceOverrides> = fc.dictionary(
  fc.constantFrom(...NOTIFICATION_CATEGORIES),
  fc.record({ in_app: fc.boolean(), email: fc.boolean() }, { requiredKeys: [] }),
) as fc.Arbitrary<NotificationPreferenceOverrides>;

const eventArb = fc.oneof(fc.constantFrom(...NOTIFICATION_EVENT_NAMES), fc.constantFrom('legacy.event', 'demo_data.reset'));
const severityArb = fc.constantFrom(...NOTIFICATION_SEVERITIES);

describe('notification catalogue', () => {
  it('every event name matches the notification.event check and has a category', () => {
    for (const event of NOTIFICATION_EVENT_NAMES) {
      expect(event).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
      expect(NOTIFICATION_CATEGORIES).toContain(notificationCategory(event));
    }
    expect(notificationCategory('legacy.event')).toBeNull();
  });

  it('category names fit the notification_preference.event check', () => {
    for (const c of NOTIFICATION_CATEGORIES) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('filter tabs cover the catalogue categories and eventsInCategories is exact', () => {
    for (const categories of Object.values(NOTIFICATION_FILTER_CATEGORIES)) {
      const events = eventsInCategories(categories);
      for (const e of NOTIFICATION_EVENT_NAMES) {
        expect(events.includes(e)).toBe(categories.includes(NOTIFICATION_EVENTS[e].category));
      }
    }
  });
});

describe('channel policy (requirement 20.2, 20.3)', () => {
  it('email only when the preference allows, except mandatory categories and critical items', () => {
    fc.assert(
      fc.property(eventArb, severityArb, overridesArb, (event, severity, overrides) => {
        const emailed = shouldEmail(event, severity, overrides);
        const category = notificationCategory(event);
        if (category === null) {
          expect(emailed).toBe(false);
          return;
        }
        const mandatory = severity === 'critical' || MANDATORY_NOTIFICATION_CATEGORIES.includes(category);
        if (emailed && !mandatory) {
          // The user did not turn email off for this category, and the event emails at all.
          expect(overrides[category]?.email).not.toBe(false);
          expect(NOTIFICATION_EVENTS[event as keyof typeof NOTIFICATION_EVENTS].email).toBe('always');
        }
        if (mandatory) expect(emailed).toBe(true);
        if (!mandatory && overrides[category]?.email === false) expect(emailed).toBe(false);
      }),
    );
  });

  it('in-app follows the preference except for mandatory or critical items', () => {
    fc.assert(
      fc.property(eventArb, severityArb, overridesArb, (event, severity, overrides) => {
        const category = notificationCategory(event);
        const shown = showsInApp(event, severity, overrides);
        if (category === null || severity === 'critical' || MANDATORY_NOTIFICATION_CATEGORIES.includes(category)) {
          expect(shown).toBe(true);
        } else {
          expect(shown).toBe(overrides[category]?.in_app !== false);
        }
      }),
    );
  });

  it('in-app-only events are not emailed unless critical', () => {
    expect(shouldEmail('offer.resolved', 'info', {})).toBe(false);
    expect(shouldEmail('scenario_run.completed', 'info', {})).toBe(false);
    expect(shouldEmail('scenario_run.failed', 'critical', { scenarios: { email: false } })).toBe(true);
    expect(shouldEmail('approval.decided', 'info', { approvals: { email: false } })).toBe(true);
  });

  it('resolvePreferences lists every category, defaults on, mandatory locked on', () => {
    fc.assert(
      fc.property(overridesArb, (overrides) => {
        const prefs = resolvePreferences(overrides);
        expect(prefs.map((p) => p.category)).toEqual([...NOTIFICATION_CATEGORIES]);
        for (const p of prefs) {
          const locked = MANDATORY_NOTIFICATION_CATEGORIES.includes(p.category as NotificationCategory);
          expect(p.locked).toBe(locked);
          expect(p.inApp).toBe(locked || overrides[p.category]?.in_app !== false);
          expect(p.email).toBe(locked || overrides[p.category]?.email !== false);
        }
      }),
    );
  });
});

describe('deep links (requirement 20.6)', () => {
  it('every event links to an app path', () => {
    fc.assert(
      fc.property(eventArb, fc.constantFrom('scenario', 'rule_version', 'ingestion_run', 'shift'), fc.uuid(), (event, objectType, objectId) => {
        const link = notificationLink({ event, objectType, objectId, params: { ruleSetId: 'rs-1' } });
        expect(link.startsWith('/')).toBe(true);
        expect(link.startsWith('//')).toBe(false);
      }),
    );
  });

  it('links to the addressed object where the screen takes one', () => {
    const id = '0b8e6f1c-7a52-4d5e-9a41-5e2b1c9d7f00';
    expect(notificationLink({ event: 'scenario.stale', objectType: 'scenario', objectId: id, params: {} })).toBe(
      `/scenarios/${id}/settings`,
    );
    expect(notificationLink({ event: 'approval.budget_requested', objectType: 'scenario', objectId: id, params: {} })).toBe(
      `/approvals?scenario=${id}`,
    );
    expect(
      notificationLink({ event: 'rule_version.published', objectType: 'rule_version', objectId: id, params: { ruleSetId: 'r/1' } }),
    ).toBe(`/rules/r%2F1/edit?version=${id}`);
    expect(notificationLink({ event: 'shift.changed', objectType: 'shift', objectId: id, params: {} })).toBe('/my-roster');
  });
});
