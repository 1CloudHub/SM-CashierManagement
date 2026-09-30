---
id: DEP-001
title: Git workflow
version: 0.3.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: [DEP-002, ADR-0004, GOV-000]
---

# Git workflow

> **Purpose:** Defines the branching model, commit/PR conventions and the `main`
> branch-protection policy for LaneWise, per ADR-0004 (GitHub Flow).

## Branching

**GitHub Flow** (ADR-0004): `main` is always deployable; all work happens on
short-lived branches taken from `main` and merged back through a pull request.

- Branch names: `<type>/<topic>`, e.g. `feat/roster-timeline`,
  `fix/erlang-rounding`, `docs/deployment-ci-cd`, `chore/deps`.
- Keep branches short-lived; rebase or merge `main` in often to avoid drift.
- Merges use a squash or linear-history merge so `main` keeps a clean history
  (linear history is enforced — see Branch protection).

## Commit conventions

**Conventional Commits**: `<type>(<scope>): <summary>`.

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
- Examples: `feat(roster): add week grid zoom`, `docs(deployment): define CI/CD`,
  `ci(pipeline): add CodeBuild PR project`.
- Docs changes that touch a versioned document also bump that document's version
  and add a `CHANGELOG.md` entry (GOV-000).

## Pull requests

- Every change reaches `main` through a PR; no direct pushes.
- A PR needs at least one approving review and a green PR build (DEP-002) before
  merge. The PR build runs in CodeBuild (build, lint, test, `cdk synth`/`diff`).
- Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) and CODEOWNERS
  (`.github/CODEOWNERS`); the contributor guide is `.github/CONTRIBUTING.md`. PR
  titles follow the same Conventional Commit style as commits.
- Resolve review threads before merge; stale approvals are dismissed on new pushes.

### Repository checks

Two repo-wide checks enforce the conventions above and in GOV-000. They are
dependency-free Node scripts under `scripts/` and are wired into the CodeBuild PR
checks (DEP-002, spec task 3.3):

- `node scripts/check-docs-conventions.mjs [--changed]` — docs file naming, front
  matter, SemVer/status, ID prefixes and the `docs/references/` read-only rule
  (GOV-000). Run in the PR build's lint step; `--changed` scopes it to files
  changed vs `origin/main`.
- `node scripts/check-spec-format.mjs [<feature>]` — every `.kiro/specs/<feature>/`
  has its required documents and references `docs/` IDs rather than duplicating
  content (GOV-000). Run alongside the PR build's test step.

A non-zero exit fails the CodeBuild phase and blocks merge. See `scripts/README.md`
for the buildspec snippet.

## Branch protection

`main` is protected (applied 2026-10-01). To enable this on the GitHub Free plan,
the repository was made **public** (branch protection and rulesets are not
available for private repos on Free — see ADR-0004).

Current policy on `main`:

- Require a pull request before merging, with **≥1 approving review**; dismiss
  stale reviews on new commits.
- **No direct pushes**, no force pushes, no branch deletion.
- **Require linear history.**
- **Enforced for administrators.**
- Required status checks: none yet — the CodeBuild PR check (context name from
  spec task 3.3) is added to the required list once that pipeline exists, so a
  failing build then blocks merge.

Reference command (adjust `checks` once the PR build context name exists):

```
gh api -X PUT repos/1CloudHub/SM-CashierManagement/branches/main/protection --input - <<'JSON'
{ "required_status_checks": {"strict": true, "checks": []},
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 1, "dismiss_stale_reviews": true},
  "restrictions": null, "allow_force_pushes": false, "allow_deletions": false, "required_linear_history": true }
JSON
```

## Tagging and releases

Phase baselines are git tags: `spec-baseline-vX.Y` (GOV-000). Deploys are driven
by merges to `main` (DEP-002), not by tags.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.3.0 | 2026-10-01 | Kiro | Added the PR template, CODEOWNERS and CONTRIBUTING references and the "Repository checks" section (docs-conventions and spec-format scripts wired into the CodeBuild PR checks); spec task 2.2. |
| 0.2.0 | 2026-10-01 | Kiro | Documented GitHub Flow, commit/PR conventions and the applied `main` branch-protection policy; noted the repo was made public to enable protection on the Free plan. |
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
