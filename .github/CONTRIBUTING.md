# Contributing to LaneWise

This is the short, contributor-facing version of the workflow. The authoritative
rules live in the docs — this file only points to them.

- Git workflow, branching, commit/PR conventions, branch protection: **DEP-001**
  ([docs/08-deployment/01-git-workflow.md](../docs/08-deployment/01-git-workflow.md))
- CI/CD and PR checks: **DEP-002**
  ([docs/08-deployment/02-ci-cd.md](../docs/08-deployment/02-ci-cd.md))
- Documentation & spec conventions: **GOV-000**
  ([docs/00-governance/00-conventions.md](../docs/00-governance/00-conventions.md))

## Branches

GitHub Flow: branch off `main`, keep it short-lived, open a PR back into `main`.

- Name: `<type>/<topic>` — e.g. `feat/roster-timeline`, `fix/erlang-rounding`,
  `docs/deployment-ci-cd`, `chore/deps`.

## Commit messages and PR titles

Both follow **Conventional Commits**: `<type>(<scope>): <summary>`.

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
- Examples: `feat(roster): add week grid zoom`, `docs(deployment): define CI/CD`,
  `ci(pipeline): add CodeBuild PR project`.
- A `docs` change that touches a versioned document also bumps that document's
  SemVer, adds a revision-history row, and adds a `CHANGELOG.md` entry (GOV-000).

## Before you open a PR

Run the checks the PR build runs (CodeBuild, DEP-002):

```bash
# docs conventions (front matter, naming, IDs, read-only references)
node scripts/check-docs-conventions.mjs --changed

# feature-spec format (.kiro/specs/<feature>/)
node scripts/check-spec-format.mjs

# app build, lint and tests
cd frontend && npm ci && npm run build && npm run lint && npm test
```

## Pull requests

- Every change reaches `main` through a PR; no direct pushes.
- Fill in the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) and reference the
  doc/requirement IDs and any spec task the change implements.
- A PR needs ≥1 approving review and a green PR build before merge (DEP-001).
- Reviewers are requested automatically via `.github/CODEOWNERS`.
