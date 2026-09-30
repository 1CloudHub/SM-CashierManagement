# Repository check scripts

Repo-wide checks used by contributors and by the CodeBuild PR pipeline
(spec task 3.3, DEP-002). They are plain Node ESM scripts with **no external
dependencies** (Node >= 18 built-ins only), so CI can run them without an
install step.

| Script | What it checks | Convention source |
|---|---|---|
| `check-docs-conventions.mjs` | `docs/` file naming, front matter, SemVer, status, ID prefixes, and `docs/references/` read-only | GOV-000 |
| `check-spec-format.mjs` | `.kiro/specs/<feature>/` has the required spec files and references `docs/` IDs | GOV-000 |

## Run locally

```bash
# Documentation conventions (all docs)
node scripts/check-docs-conventions.mjs

# Only docs changed vs origin/main (fast; used in PR CI)
node scripts/check-docs-conventions.mjs --changed

# Spec format (all feature specs, or one by name)
node scripts/check-spec-format.mjs
node scripts/check-spec-format.mjs cashier-staffing-planner
```

Each script exits `0` on success, `1` on violations, `2` on a setup error.

## CI integration (CodeBuild PR checks — task 3.3)

Per DEP-002, the pull-request CodeBuild project runs `install → build → lint →
test → cdk synth/diff`. These two checks belong in the **lint** step
(docs-conventions) and alongside **test** (spec-format). In the CodeBuild
buildspec (added with the pipeline in task 3.3), add to the relevant phases:

```yaml
# buildspec-pr.yml (illustrative — created with the pipeline in task 3.3)
phases:
  build:
    commands:
      # ... existing lint (ESLint) ...
      - node scripts/check-docs-conventions.mjs --changed   # docs-conventions check (lint step)
      - node scripts/check-spec-format.mjs                   # spec-format validation (test step)
```

A non-zero exit fails the CodeBuild phase, which reports a failing check back to
the PR through the CodeStar Connection and blocks merge (DEP-001 branch
protection, once the check is added to the required list).

The `--changed` flag scopes the docs check to files changed against
`origin/main`, so PR builds stay fast; drop it for a full-repo audit.
