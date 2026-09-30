# Requirements Document

> Status: Draft v0.3.0. Product name: LaneWise by SM Retail. Derived from `design.md` v0.7.0. Wireframes: `wireframes/index.html`.
> EARS acceptance criteria. Each requirement lists the design Correctness Properties it upholds (P1–P19) where applicable.

## Introduction

The Cashier Staffing Planner is a production rebuild of the SM Retail cashier staffing prototype (v3). It keeps the full prototype pipeline — hourly demand forecast, Erlang C lane sizing to a service target, shrinkage, shift building, a named weekly roster under Philippine labor rules, a network seasonal hiring plan, and a leadership summary — and wraps it in a multi-user web application.

The rebuild adds: passkey sign-in via Amazon Cognito restricted to the smretail.com and 1cloudhub.com domains; eight roles with region/store/self data scoping and a demo role switcher; saved, versioned, comparable and approvable scenarios (HR headcount + Finance budget → Executive plan); versioned business rule sets with a Finance approval gate for cost rules; data ingestion by file upload; visual planning (Day timeline, Week grid, Month coverage); a Metro Manila network map that matches open shifts to available cashiers by travel time from their consented home area, plus store-to-store borrowing; staff self-service (own roster, shift offers, time-off and swap requests); English and Filipino UI; and seeded demo data.

The system targets WCAG 2.2 AA. All screens work on phones, read-only except approvals and a small set of quick actions.

### Roles

ADM System Admin · EXE Executive · PLN Planner · STM Store Manager · HR · FIN Finance · RST Rules Steward · STF Staff (cashier). A user may hold several roles; permissions combine. In demo mode every signed-in user can switch to any role via "Viewing as", and the server enforces the active role.

## Glossary

- **Scenario:** a saved set of planning inputs for a season, with a lifecycle (Draft → Submitted → Published → Archived) and a stale flag.
- **Snapshot:** a pinned version of a dataset (POS, master data, staff) a scenario runs against.
- **Rule version:** an effective-dated version of a rule set (holidays, wages, premium multipliers, lead times).
- **Scope:** the stores a user may see, applied identically to every view, search result and export.
- **ShiftOverride:** an operational change a store manager makes to a published roster.
- **Home area:** a staff member's opt-in home location at barangay level, used for travel-based matching.

---

## Requirements

## Requirement 1: Authentication with passkeys and domain restriction

**User story:** As SM Retail IT, I want sign-in limited to passkeys and to our two email domains, so that only authorised staff from smretail.com and 1cloudhub.com can access the planner.

**Acceptance criteria** (upholds P13)

1. WHEN a person enters an email whose domain is not smretail.com or 1cloudhub.com, THEN the system SHALL refuse sign-up/sign-in and show "This work email domain isn't allowed."
2. THE system SHALL NOT create any account whose email domain is outside smretail.com and 1cloudhub.com.
3. WHEN a user with a registered passkey signs in, THEN the system SHALL authenticate them with the passkey and SHALL NOT offer a password option.
4. WHEN a user signs in for the first time or from a new device without a passkey, THEN the system SHALL send a one-time code to their work email, and upon verification SHALL let them register a passkey.
5. THE system SHALL use the email one-time code only to register or recover a passkey, never as a standing sign-in method.
6. WHEN a browser or device does not support passkeys, THEN the system SHALL show a message listing supported browsers and devices.
7. WHERE self sign-up is enabled (demo mode), ANY person with an email on the allowlist SHALL be able to create an account without an administrator invitation.
8. WHEN a session has been idle for 60 minutes, THEN the system SHALL sign the user out, SHALL warn 2 minutes before with a "Stay signed in" option, and SHALL return the user to the same URL after re-authentication.
9. WHEN a user manages passkeys, THEN the system SHALL let them list, add and remove devices but SHALL prevent removing their last passkey.

## Requirement 2: Roles, permissions and data scope

**User story:** As a security owner, I want every action authorised against the user's active role and data scope, so that people only see and change what their role allows for their stores.

**Acceptance criteria** (upholds P1, P12)

1. THE system SHALL authorise every request against the active role's permissions and data scope as defined by the RBAC matrix.
2. WHEN a user views any screen, search result or export, THEN every store shown SHALL be within that user's scope.
3. WHERE a role has no access to a navigation item, THE system SHALL hide it rather than show it disabled.
4. IF a user opens a deep link to an object outside their scope, THEN the system SHALL show a "No access" state and SHALL NOT reveal any attribute of the object.
5. THE system SHALL enforce scope on the server and SHALL NOT rely only on hiding filter options in the UI.
6. WHERE a user holds more than one role, THE system SHALL grant the union of those roles' permissions for the active role in use.

## Requirement 3: Demo-mode role switcher

**User story:** As a demo user, I want to switch between all eight roles, so that I can experience the app from each perspective.

**Acceptance criteria** (upholds P12)

1. WHERE demo mode is enabled, THE system SHALL show a "Viewing as" role switcher covering all 8 roles to every signed-in user.
2. WHEN a user switches role, THEN the system SHALL apply that role's permissions and scope to every subsequent request.
3. WHEN a user performs an audited action, THEN the audit event SHALL record both the signed-in user and the active role.
4. WHEN a user switches role, THEN the system SHALL keep the current page IF the new role can access it, ELSE navigate to Home.
5. WHERE demo mode is disabled, THE system SHALL hide the switcher and derive roles from the user's assignments.

## Requirement 4: Demand forecast, lane sizing and prototype parity

**User story:** As a planner, I want the rebuild's calculations to match the prototype, so that I can trust the numbers I already validated.

**Acceptance criteria** (upholds P2, P6)

1. THE system SHALL compute an hourly demand forecast, Erlang C lane requirement for the service target, shrinkage adjustment, shift plan, weekly roster and seasonal hiring plan using the prototype v3 method.
2. WHEN a scenario is run with the same data snapshot, rules version and settings as prototype v3, THEN the forecast, lane, roster and hiring-plan outputs SHALL match v3 within the parity tolerance defined in DOM-001 (integer outputs exact; cost within ±0.5%).
3. WHEN any result is produced, THEN the system SHALL record the rules version and data snapshot used to produce it.
4. THE system SHALL provide a "How it works" explanation on the department plan drawn from the methodology document.

## Requirement 5: Network view and department day plan

**User story:** As a planner, I want to see all stores and departments for a date and drill into one department's hourly plan, so that I can find and investigate capacity gaps.

**Acceptance criteria** (upholds P1)

1. WHEN a user opens the network view for a scenario and date, THEN the system SHALL show every in-scope store and department with its staffing status.
2. WHEN a user selects a department, THEN the system SHALL show its hourly demand, required lanes, shrinkage and shift builder for the chosen day.
3. THE system SHALL let the user export the current view as CSV respecting the active filters and scope.
4. WHERE a heatmap or chart is shown, THE system SHALL provide a "View as table" alternative and never encode meaning by colour alone.

## Requirement 6: Visual roster planning

**User story:** As a planner or store manager, I want Day, Week and Month roster views, so that I can build and read the roster the way that suits the task.

**Acceptance criteria**

1. THE system SHALL provide Day (timeline), Week (grid), Fortnight, Four weeks and Month (coverage) views of a roster, with a date navigator.
2. WHEN a user views the Day timeline, THEN the system SHALL show one row per cashier with shift bars, activity segments (meal, training, huddle) and a staffing-versus-need strip marking over- and under-staffing per time column.
3. WHEN a user views the Week grid, THEN the system SHALL show shift chips per cashier per day with a department colour band and letter, rest-day, unavailable and open-shift chips, a totals panel and department/colour filters.
4. THE system SHALL always pair category colours with a letter or label and SHALL NOT convey meaning by colour alone.
5. WHERE the viewport is a phone, THE system SHALL present the Day view as a list per cashier and the Week view as a list per day, editable only for emergency off / reassign.
6. WHEN a user opens a shift, THEN the system SHALL show its activities and offer edit, emergency off and reassign actions.
7. THE system SHALL show the labor-rule checks for the roster and flag any failing check.

## Requirement 7: Store-manager roster changes (overrides)

**User story:** As a store manager, I want to adjust the published roster for last-minute changes, so that I can cover emergency offs without waiting for a new plan.

**Acceptance criteria** (upholds P14)

1. WHERE a roster is published, THE store manager for that store SHALL be able to change it directly: emergency off, reassign, change times, add or remove a shift.
2. WHEN a store manager changes a published roster, THEN the system SHALL record a ShiftOverride and exactly one audit event, mark the change ✎ in the grid, and notify the affected cashier(s).
3. IF a change causes a labor-rule breach, THEN the system SHALL require a reason and record it on the override.
4. THE system SHALL NOT save any change that would leave a cashier without a 24-hour rest after 6 consecutive working days.
5. WHEN a store manager marks an emergency off, THEN the system SHALL offer a replacement from the eligible list, including "Find cover nearby".

## Requirement 8: Scenarios — create, version, compare

**User story:** As a planner, I want to save, duplicate, compare and manage scenarios, so that I can explore options without losing my work.

**Acceptance criteria** (upholds P3, P4, P5)

1. THE system SHALL let a planner create, duplicate, edit settings for, and archive scenarios, each pinned to a rules version and data snapshot.
2. THE system SHALL keep at most one Published scenario per season and mark it ★ as the default on planning screens.
3. WHEN a scenario is Submitted or Published, THEN the system SHALL treat its settings as read-only and SHALL require "Duplicate as draft" to make changes.
4. THE system SHALL flag a scenario stale exactly when its snapshot or rules version is superseded, or its settings changed after its last run.
5. IF a scenario is stale, THEN the system SHALL prevent submission and show a "Recalculate" banner; WHEN a submitted scenario becomes stale, THEN the system SHALL pause it and notify the approvers.
6. WHEN a user compares scenarios, THEN the system SHALL show the differences in inputs and results side by side.

## Requirement 9: Headcount, budget and plan approval

**User story:** As an executive, I want headcount and budget secured before I approve the plan, so that a published plan is always funded and staffed.

**Acceptance criteria** (upholds P10, P7)

1. WHEN a planner submits a scenario, THEN the system SHALL create three approval steps: Headcount (HR), Budget (Finance) and Plan (Executive).
2. THE system SHALL allow the Headcount and Budget steps to be decided in either order.
3. THE system SHALL allow only the Executive to record Headcount or Budget as secured outside the system, with a reference and note, and SHALL make that record visible to HR and Finance.
4. THE system SHALL keep the Plan approval action disabled until both Headcount and Budget are secured (in system or outside it).
5. WHEN the Executive approves the plan, THEN the system SHALL publish it, supersede the previous published plan, and notify all roles in scope.
6. WHEN any approver requests changes or the Executive rejects, THEN the system SHALL return the scenario to Draft (requiring a comment) and reset all approval steps on resubmission.
7. THE system SHALL record exactly one audit event for each submit, decision, off-system record and publish.

## Requirement 10: Hiring plan and leadership summary

**User story:** As HR and executives, I want a seasonal hiring plan and a one-page summary, so that we can recruit on time and brief leadership.

**Acceptance criteria** (upholds P2)

1. THE system SHALL produce a seasonal hiring plan with hires by store and role, a recruiting timeline and lead-time-driven milestones.
2. WHEN a hiring plan or a roster longer than 4 weeks is requested, THEN the system SHALL run it as a background job showing progress, allow the user to leave the page, and notify them on completion.
3. THE system SHALL generate a printable one-page leadership summary from a scenario and SHALL export it to PDF/print (A4).
4. WHEN a hiring milestone is due within 7 days or overdue, THEN the system SHALL notify HR and planners in scope.

## Requirement 11: Network map and cross-store matching

**User story:** As a planner or store manager, I want a Metro Manila map showing gaps, surplus and nearby available cashiers, so that I can cover open shifts across stores.

**Acceptance criteria** (upholds P1, P15, P16)

1. WHEN a user opens the network map, THEN the system SHALL plot in-scope SM stores as pins coloured by staffing gap, surplus or balanced, with layers for available staff by home area.
2. WHEN a user selects a store, THEN the system SHALL re-centre 15/30/45-minute travel-time rings on that store and list candidate cashiers.
3. THE system SHALL rank candidates by travel time, then labor-rule headroom, then fairness (fewest extra shifts this period), then cost.
4. THE system SHALL count a candidate's hours across all stores when checking labor-rule headroom.
5. THE system SHALL offer a shift only to cashiers who are trained on the department, available in the window, and would remain within every labor rule when their cross-store hours are counted.
6. THE system SHALL let a user filter the map by store format (SM Supermarket, Hypermarket, SaveMore, SM Store).
7. THE system SHALL provide an "Auto-match all gaps" action that proposes offers and store-to-store moves covering the most open shifts with the least total travel, for the user to review before sending.
8. THE system SHALL provide the map's information as an equivalent data table.

## Requirement 12: Location privacy and consent

**User story:** As a cashier, I want my location used only at barangay level and only if I consent, so that my privacy is protected under RA 10173.

**Acceptance criteria** (upholds P15)

1. THE system SHALL store a staff member's home area at barangay level only and SHALL NOT store or use an exact address or live GPS location.
2. THE system SHALL include a staff member in the map and in travel-based matching only WHERE they have given opt-in consent.
3. WHEN a staff member withdraws consent, THEN the system SHALL remove them from the map and from matching.
4. THE system SHALL NOT expose in any screen, export or API response a staff member's location more precisely than barangay.
5. WHERE a candidate is shown to a manager from another store, THE system SHALL show ID, home store and barangay only, and SHALL reveal the name only once an offer is accepted.

## Requirement 13: Shift offers to cashiers

**User story:** As a store manager, I want to broadcast an open shift to eligible cashiers' phones, so that the first available person can take it.

**Acceptance criteria** (upholds P16, P17)

1. WHEN a manager sends offers for an open shift, THEN the system SHALL broadcast the offer to the selected eligible cashiers with store, time, travel time, pay, transport allowance and expiry.
2. THE system SHALL expire an unaccepted offer 30 minutes after it is sent.
3. WHEN a cashier accepts an offer, THEN the system SHALL assign the shift to the first acceptor and move all other offers for that shift to expired or withdrawn at that moment.
4. THE system SHALL allow at most one accepted offer per open shift.
5. WHEN an offer is accepted, declined or expires, THEN the system SHALL notify the sender.
6. THE system SHALL apply a flat transport allowance by travel band, configured in the business rules.

## Requirement 14: Store-to-store borrowing

**User story:** As a planner, I want to borrow cashiers from a surplus store, so that I can cover a short store when individual offers are not enough.

**Acceptance criteria** (upholds P14, P16)

1. WHEN a user requests to borrow cashiers from another store, THEN the system SHALL notify that store's manager for approval.
2. THE system SHALL apply a borrow only after the lending store manager approves, EXCEPT a planner MAY override with a recorded reason.
3. WHEN a borrow is approved, THEN the system SHALL show the borrowed cashier in the receiving store's roster marked with home store and travel time, and SHALL count their hours toward their own weekly limits.

## Requirement 15: Staff self-service — roster, offers and requests

**User story:** As a cashier, I want to see my own roster and raise time-off and swap requests, so that I can manage my schedule without exposing others' data.

**Acceptance criteria** (upholds P11, P19)

1. WHEN a Staff user opens My roster, THEN the system SHALL show only their own shifts, changes and rest days, and SHALL NOT show another cashier's name, shift or cost.
2. THE system SHALL let a Staff user accept or decline open-shift offers within their travel limit.
3. THE system SHALL let a Staff user raise a time-off request (date range, optional reason) or a swap request (offer one of their shifts, take another shift or an open slot).
4. THE system SHALL route each request to the store manager for the affected store and SHALL NOT change the published roster while a request is pending.
5. WHEN a store manager approves a time-off request, THEN the system SHALL mark the cashier unavailable for those dates and flag any shifts that become open.
6. WHEN a store manager approves a swap, THEN the system SHALL apply it as a ShiftOverride and notify both cashiers; IF the swap breaks a labor rule, THEN the reason and hard-block rules of Requirement 7 SHALL apply.
7. THE system SHALL record every request and decision in the audit log.

## Requirement 16: Business rule sets and Finance approval

**User story:** As a rules steward, I want versioned rule sets with a Finance gate on cost rules, so that wage and holiday changes are controlled and traceable.

**Acceptance criteria** (upholds P6, P7)

1. THE system SHALL keep every rule version with an effective date and SHALL let scenarios record the version they used.
2. THE system SHALL NOT change existing results when a new rule version is published.
3. WHERE a rule set is a cost rule (wages, premium multipliers, holiday multipliers), THE system SHALL require Finance approval before the version can be published.
4. WHERE a rule set is not a cost rule (e.g. lead times), THE system SHALL let the Rules Steward publish it directly.
5. WHEN a rule version is published, THEN the system SHALL flag affected scenarios stale and notify their owners, Finance and HR.
6. THE system SHALL record exactly one audit event for each rule submit, approval, request-changes and publish.

## Requirement 17: Data ingestion by upload

**User story:** As a rules steward, I want to upload POS, master and staff data with validation, so that plans run on reviewed data.

**Acceptance criteria** (upholds P9)

1. THE system SHALL let authorised users upload POS transactions, store/department/lane master data and staff availability by file.
2. WHEN a file is uploaded, THEN the system SHALL validate it and show valid rows, warnings and errors, with a downloadable report identifying rows by number.
3. IF a file has errors, THEN the system SHALL block the load and keep the previous dataset.
4. WHEN a load will change a dataset that scenarios depend on, THEN the system SHALL show which scenarios become stale and notify their owners on load.
5. THE system SHALL keep an ingestion history of each load (time, user, dataset, rows, warnings, errors, result).
6. THE system SHALL let a dataset be flagged synthetic, and SHALL allow only a Rules Steward to clear that flag.

## Requirement 18: Sample-data provenance

**User story:** As any user, I want a clear indication when figures are simulated, so that sample data is never mistaken for SM actuals.

**Acceptance criteria** (upholds P9)

1. WHILE any dataset in use is flagged synthetic, THE system SHALL show a non-dismissible sample-data banner on every page.
2. WHEN a user exports any view, THEN the export SHALL carry a sample-data marker in its header while synthetic data is in use.
3. THE printed leadership summary SHALL show the sample-data badge while synthetic data is in use.

## Requirement 19: Demo data isolation

**User story:** As a demo operator, I want seeded mock data kept separate from real data, so that demos are realistic without corrupting real plans.

**Acceptance criteria** (upholds P18)

1. THE system SHALL seed demo data covering the 27 Metro Manila stores, staff with consented home areas, synthetic POS history, scenarios in each lifecycle state, roster activity, notifications and audit.
2. THE system SHALL mark every seeded record synthetic and SHALL label it "Demo data".
3. THE system SHALL keep any snapshot, scenario run or export entirely synthetic or entirely real, never mixed.
4. WHEN a demo user switches to Staff, THEN the system SHALL let them pick a seeded demo cashier persona.
5. WHERE an Administrator resets demo data, THE system SHALL restore the seed, audit the reset, notify signed-in users, and SHALL NOT change any real record.
6. THE system SHALL generate seed data deterministically so repeated seeds produce the same values.

## Requirement 20: Notifications

**User story:** As a user, I want timely notifications for the things I own, so that I act on approvals, offers and deadlines.

**Acceptance criteria** (upholds P1)

1. THE system SHALL raise in-app notifications for approvals, plan publication, hiring milestones, staleness, background-job completion, unfilled shifts, ingestion outcomes, rule publication, roster changes, offers, borrow requests and new passkeys.
2. THE system SHALL send email immediately per event via the email provider and SHALL NOT batch a daily digest.
3. THE system SHALL let a user turn off email per event, EXCEPT approvals and critical items, which stay on.
4. THE system SHALL apply the user's scope so a user is notified only about their stores.
5. WHERE the user has a language preference, THE system SHALL send emails and push notifications in that language.
6. THE bell SHALL show the unread count and the latest items, each deep-linking to the object.

## Requirement 21: Search, filter and saved views

**User story:** As a planner, I want scoped search, filters and shareable views, so that I can find and return to exactly what I need.

**Acceptance criteria** (upholds P1, P8)

1. THE system SHALL provide global search (opened with `/` or ⌘K) grouped by stores, departments, scenarios, staff and pages, filtered by the user's scope.
2. THE system SHALL provide a context bar of scope filters on planning screens, where each filter narrows the options of the filters after it.
3. THE system SHALL encode every filter, sort and scenario selection in the URL so a view can be shared or bookmarked.
4. WHEN a shared URL is loaded, THEN the system SHALL reproduce the same filters, sort and scenario that produced it, subject to the loader's scope.
5. THE system SHALL let a user save named views and set a default per screen.

## Requirement 22: Audit trail

**User story:** As a compliance owner, I want a complete, immutable audit trail, so that every material action is accountable.

**Acceptance criteria** (upholds P7, P12)

1. THE system SHALL record exactly one immutable audit event for each create, edit, submit, decision, publish, ingestion, export and role change.
2. THE audit event SHALL record time, user, active role, event, object and before/after where applicable.
3. THE system SHALL retain audit events for 5 years and ingestion files for 1 year.
4. THE system SHALL let authorised users filter and export the audit log within their scope.

## Requirement 23: Internationalisation (English and Filipino)

**User story:** As a store or staff user, I want the app in English or Filipino, so that I can work in my preferred language.

**Acceptance criteria**

1. THE system SHALL provide the UI in English and Filipino with a language switcher in the top bar and in Profile, persisted per user.
2. THE system SHALL source all UI text, dates, numbers and ₱ formatting from externalised resource bundles and SHALL NOT hardcode user-facing strings.
3. THE system SHALL prioritise staff-facing screens (My roster, offers, notifications, requests) for translation.

## Requirement 24: Mobile and accessibility

**User story:** As a user on a phone or with assistive technology, I want every screen to work, so that I can act wherever I am.

**Acceptance criteria** (upholds P1)

1. THE system SHALL render every screen on phone, tablet, laptop and desktop breakpoints.
2. WHERE the viewport is a phone, THE system SHALL keep screens read-only EXCEPT approvals, off-system records, emergency off with replacement, My roster, offers, notifications, preferences and the role switcher.
3. WHERE a screen is read-only on a phone, THE system SHALL keep all filters, sorting, search and drill-down available.
4. THE system SHALL target WCAG 2.2 AA: landmarks, skip link, visible focus, table alternatives for charts, table semantics for roster grids, and text paired with colour on status indicators.

## Requirement 25: Cost visibility

**User story:** As a store manager, I want to see cost for my own store only, so that I can manage locally without seeing other stores' figures.

**Acceptance criteria** (upholds P1, P11)

1. WHERE a user is a Store Manager, THE system SHALL show ₱ cost figures for their own store only and SHALL NOT show other stores' or network cost.
2. THE system SHALL show cost figures to EXE, PLN, HR and FIN within their scope.
3. THE system SHALL NOT show any cost figures to Staff.

---

## Non-functional requirements (summary)

Detailed, measurable NFRs live in `docs/04-non-functional/01-non-functional-requirements.md` (NFR-001). Key targets referenced by this spec:

1. **Performance** (NFR-PERF-001…005): interactive screens p95 ≤ 2 s; hiring plan and >4-week rosters as background jobs.
2. **Security** (NFR-SEC-001…005): passkey-only auth, server-side domain allowlist and scope, TLS + encryption at rest, 60-min idle timeout.
3. **Privacy** (NFR-PRIV-001…003): RA 10173, barangay granularity, opt-in consent with immediate withdrawal.
4. **Accessibility** (NFR-A11Y-001…002): WCAG 2.2 AA target; full conformance requires manual assistive-technology testing.
5. **Reliability** (NFR-REL-001…003): resumable idempotent jobs; results cached per scenario version.
6. **Compliance** (NFR-COMP-001…003): PH Labor Code hard-blocks, RA 10173, audit retention 5 y / ingestion 1 y.

---

## Property → requirement traceability

| Property | Requirements |
|---|---|
| P1 Scope isolation | 2, 5, 11, 20, 21, 24, 25 |
| P2 Prototype parity | 4, 10 |
| P3 Single published plan | 8 |
| P4 Read-only published | 8 |
| P5 Stale correctness | 8 |
| P6 Rule versioning | 4, 16 |
| P7 Audit completeness | 9, 16, 22 |
| P8 Filter round-trip | 21 |
| P9 Provenance | 17, 18 |
| P10 Approval sequencing | 9 |
| P11 Staff self-scope | 15, 25 |
| P12 Active-role enforcement | 2, 3, 22 |
| P13 Domain restriction | 1 |
| P14 Override traceability | 7, 14 |
| P15 Location privacy | 11, 12 |
| P16 Offer eligibility | 11, 13, 14 |
| P17 Single acceptance | 13 |
| P18 Demo data isolation | 19 |
| P19 Requests until approved | 15 |

---

## Requirements ↔ authoritative docs

Each requirement's substance is owned by a `docs/` topic; the requirement makes it testable. Style, tech-stack, deployment, operations and planning docs inform the design and tasks rather than producing EARS requirements.

| Requirement | Authoritative docs |
|---|---|
| 1 Authentication | FS-010, SEC-002, NFR-SEC-001/002/005 |
| 2 Roles, permissions, scope | FS-010, SEC-002, NFR-SEC-003 |
| 3 Demo role switcher | FS-010, SEC-002 |
| 4 Forecast, lanes, parity | DOM-001 (parity tolerance), FS-001, FS-002, DOM-003 |
| 5 Network view & department plan | FS-005, FS-002, DOM-001 |
| 6 Visual roster planning | FS-004, FS-003, UX-005, SG-010 |
| 7 Store-manager overrides | FS-004, DOM-003, NFR-COMP-001 |
| 8 Scenarios | FS-007 |
| 9 Approvals | FS-007, GOV-002 (RACI), SEC-003 |
| 10 Hiring plan & summary | FS-006, FS-008, DOM-001 |
| 11 Network map & matching | FS-004, DOM-005, SEC-001 |
| 12 Location privacy & consent | SEC-001 (RA 10173), NFR-PRIV-001…003 |
| 13 Shift offers | FS-004, DOM-003 |
| 14 Store-to-store borrowing | FS-004, DOM-003 |
| 15 Staff self-service | FS-004, FS-010 |
| 16 Rule sets & Finance approval | DOM-003, FS-007, SEC-003 |
| 17 Data ingestion | FS-009, DOM-002, DOM-005 |
| 18 Sample-data provenance | FS-008, DOM-004 |
| 19 Demo data isolation | DOM-002, DOM-004 |
| 20 Notifications | FS-010, DOM-005 |
| 21 Search, filter, saved views | UX-008, UX-009, FS-005 |
| 22 Audit trail | SEC-003, NFR-COMP-003 |
| 23 Internationalisation | UX-011, NFR-L10N-001/002 |
| 24 Mobile & accessibility | UX-001, UX-002, UX-004, NFR-A11Y-001, NFR-USE-001 |
| 25 Cost visibility | DOM-003, SEC-002 |
| NFR summary | NFR-001 (all), TS-001, TS-002 |

**Docs that guide build (design/tasks/ADRs), not EARS requirements:** 05-style-guide (SG-*), 07-tech-stack (TS-*), 08-deployment (DEP-*), 09-operations (OPS-*), 11-planning (PLN-*), and 00-governance / 01-product context (GOV-*, PRD-*).
