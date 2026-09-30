---
id: DEP-001
title: Git workflow
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [ADR-0004, DEP-002, GOV-000]
---

# Git workflow

> **Purpose:** Defines the branching model (GitHub Flow) and the `main` branch-protection policy for LaneWise, per ADR-0004. Implements spec task 2.1.

## Branching

We use **GitHub Flow** (ADR-0004):

- `main` is the single long-lived branch and is **always deployable**. A merge to `main` deploys to AWS prod (see DEP-002).
- All work happens on **short-lived branches** cut from the latest `main`.
- Every change reaches `main` through a **pull request** — no direct pushes to `main`.
- Branches are deleted after their PR merges. Keep them short-lived (hours to a few days) to minimise drift.

There is a single `prod` environment today. The workflow and pipeline are structured so a `staging` environment and a manual promotion gate can be added later without reworking the branching model (ADR-0004).

### Branch naming

`<type>/<short-topic-kebab-case>`, matching the change type:

| Prefix | Use for |
|---|---|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `docs/` | Documentation-only change (see GOV-000: `docs/<section>-<topic>`) |
| `chore/` | Tooling, deps, CI, housekeeping |
| `refactor/` | Internal change with no behaviour change |

Examples: `feat/lane-sizing-erlang-c`, `fix/roster-rest-window`, `docs/deployment-git-workflow`.

## Commit conventions

- **Conventional Commits**: `type(scope): summary` — e.g. `feat(roster): add fortnight grid`, `docs(deployment): document GitHub Flow`.
- Types align with the branch prefixes above (`feat`, `fix`, `docs`, `chore`, `refactor`, plus `test`, `build`, `ci`).
- Keep the subject imperative and under ~72 characters; put detail in the body.
- Documentation changes follow GOV-000 change control (bump the doc version, update its revision table and the root `CHANGELOG.md`).

## Pull requests

- Open a PR from a short-lived branch into `main`. Small, focused PRs are preferred.
- A PR must pass all **required status checks** and be **approved** before it can merge (see [Branch protection](#branch-protection-main)).
- Squash-merge is the default so `main` history stays one-commit-per-change; delete the branch on merge.
- Reviewer sign-off follows the status workflow in GOV-000 (`Draft` → `In Review` → `Approved`) for documents.

## Tagging and releases

- Phase baselines are annotated git tags: `spec-baseline-vX.Y` (GOV-000).
- Because every merge to `main` deploys, release tagging is lightweight; use tags to mark notable baselines, not to gate deploys.

## Branch protection (`main`)

`main` must be protected so the "always deployable" guarantee holds. The **intended policy** is:

- **Require a pull request before merging** — no direct pushes to `main`, including for admins.
- **Require status checks to pass before merging**, with branches required to be up to date first.
- **Require at least one approving review**, and dismiss stale approvals when new commits are pushed.
- **Block force pushes and deletions** of `main`.

### Required status checks

The CI status-check names come from the **PR pipeline (spec task 3.3)**, which is not built yet. Once that workflow exists, add its job/check names to the required-checks list. The PR pipeline (DEP-002, task 3.3) runs: install, build, lint, test, `cdk synth`, and `cdk diff`. Expected check names to require once created (final names must match the GitHub Actions job names / `jobs.<id>.name` in the workflow):

- `build`
- `lint`
- `test`
- `cdk synth`
- `cdk diff`

Until the PR pipeline exists, protection should still require a PR + review and block direct/force pushes; the status-check requirement is added when the checks first report on a PR.

### Applying the protection (⚠ blocked by GitHub plan — action required)

**Status: NOT applied on the remote.** As of this writing the `1CloudHub` org is on the **GitHub Free plan** and `1CloudHub/SM-CashierManagement` is a **private** repository. On the Free plan, GitHub does **not** allow branch protection or rulesets on private repos:

- `GET/PUT repos/1CloudHub/SM-CashierManagement/branches/main/protection` → `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."`
- `repos/.../rulesets` and `orgs/1CloudHub/rulesets` → `403 "Upgrade to GitHub Team to enable this feature."`

This is a **plan limitation, not a permissions problem**: the configured account has repo `admin: true` and `gh` is authenticated with `admin:org` + `repo` scopes. To enable enforcement, pick one of:

1. **Upgrade** the repo/org to **GitHub Pro** (per-user private repos) or **GitHub Team** (org), then apply protection; or
2. Make the repository **public** (Free plan allows protection on public repos); or
3. Rely on the **process convention** in this document as an interim control (no server-side enforcement).

Once the plan supports it, a human (or CI) with repo admin can apply protection via either the classic branch-protection API or a ruleset.

**Option A — classic branch protection (`gh api`).** Requires the `test`/`lint`/etc. checks to already exist, so run this after task 3.3 lands; before then, drop the `required_status_checks` block or set `"checks": []`:

```bash
gh api -X PUT repos/1CloudHub/SM-CashierManagement/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "build" },
      { "context": "lint" },
      { "context": "test" },
      { "context": "cdk synth" },
      { "context": "cdk diff" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
JSON
```

**Option B — repository ruleset (`gh api`).** Rulesets are the newer mechanism and also need Pro/Team on a private repo:

```bash
gh api -X POST repos/1CloudHub/SM-CashierManagement/rulesets \
  --input - <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "build" },
          { "context": "lint" },
          { "context": "test" },
          { "context": "cdk synth" },
          { "context": "cdk diff" }
        ]
      }
    }
  ]
}
JSON
```

Verify afterwards with `gh api repos/1CloudHub/SM-CashierManagement/branches/main/protection` (classic) or `gh api repos/1CloudHub/SM-CashierManagement/rulesets` (ruleset).

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Documented GitHub Flow branching, branch naming, commit/PR conventions and the `main` branch-protection policy; recorded that remote protection is blocked by the GitHub Free plan on a private repo and captured the exact `gh api` commands to apply it (spec task 2.1) |
