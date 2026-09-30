<!--
  PR title MUST follow Conventional Commits (DEP-001):
    <type>(<scope>): <summary>
  types: feat | fix | docs | refactor | test | chore | build | ci
  e.g. feat(roster): add week grid zoom
       docs(deployment): define CI/CD
       ci(pipeline): add CodeBuild PR project
-->

## Summary

<!-- What does this PR change and why? Keep it tight. -->

## Related

<!-- Link the doc/requirement IDs this implements or touches (e.g. DEP-001, GOV-000, FR-ROSTER-012)
     and any spec task (e.g. cashier-staffing-planner 2.2). Reference IDs, do not duplicate content. -->

- Doc / requirement IDs:
- Spec task:
- Issue:

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` — no behaviour change
- [ ] `test` — tests only
- [ ] `chore` / `build` / `ci` — tooling, deps, pipeline

## Checklist

- [ ] PR title follows Conventional Commits (`<type>(<scope>): <summary>`) — see DEP-001.
- [ ] Branch is `<type>/<topic>` off `main` and short-lived (GitHub Flow, DEP-001).
- [ ] Build, lint and tests pass locally.
- [ ] The PR build (CodeBuild) is green (build, lint, test, `cdk synth`/`diff`) — DEP-002.

### If this touches `docs/`

- [ ] Every changed document keeps valid front matter (`id`, `title`, `version`, `status`, `owner`, `last_updated`, `related`) — GOV-000.
- [ ] Requirement IDs follow `<FR|NFR|BR|UXR>-<AREA>-<NNN>` and no ID was reused — GOV-000.
- [ ] Any versioned document I changed has a bumped SemVer + a new revision-history row.
- [ ] `CHANGELOG.md` has an entry for this change.
- [ ] `docs/references/` was not edited (read-only source material).
- [ ] `docs:check` passes (`node scripts/check-docs-conventions.mjs`).

### If this touches `.kiro/specs/`

- [ ] Spec files reference `docs/` IDs instead of duplicating content — GOV-000.
- [ ] `spec:check` passes (`node scripts/check-spec-format.mjs`).

## Notes for reviewers

<!-- Anything reviewers should focus on, risks, follow-ups, or blocked items. -->
