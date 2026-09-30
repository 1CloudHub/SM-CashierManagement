---
id: DEP-002
title: CI/CD
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: [DEP-001, DEP-003, DEP-004, DEP-005, ADR-0004, ADR-0002]
---

# CI/CD

> **Purpose:** Defines how LaneWise is built, checked and deployed — an all-AWS
> pipeline (CodePipeline + CodeBuild) sourced from GitHub, per ADR-0004.

## Overview

CI/CD runs on **AWS CodePipeline + CodeBuild**, sourced from the GitHub repo
through a **CodeStar (GitHub) Connection**. There are no stored AWS keys and no
third-party CI runners: CodeBuild and CodePipeline use IAM **service roles**, and
GitHub access is via the connection's GitHub App. See ADR-0004 for the decision
and the alternatives considered (GitHub Actions + OIDC was superseded).

The repository follows GitHub Flow (DEP-001): short-lived branches, PRs into
`main`, and `main` always deployable. `main` is protected (require PR + review,
no direct/force pushes); once the PR build exists its check is added to the
branch's required status checks.

## Pipeline stages

**Pull-request checks (CodeBuild).** On a pull request against `main`, a CodeBuild
project runs and reports status back to the PR through the CodeStar Connection:

1. `install` — restore dependencies (frontend + API + infra).
2. `build` — build the SPA and the API.
3. `lint` — ESLint / formatting and the docs-conventions check.
4. `test` — unit + property-based tests (TS-002), including the spec-format
   validation where applicable.
5. `cdk synth` + `cdk diff` — synthesize the CDK app and surface the infra delta.

A failing check blocks merge.

**Deploy (CodePipeline), on merge to `main`:**

1. **Source** — the CodeStar Connection emits the `main` change.
2. **Build** — CodeBuild builds the SPA and API artifacts.
3. **Deploy** — `cdk deploy` to AWS **prod**: upload the SPA to S3 and invalidate
   CloudFront; deploy the API (Lambda + API Gateway) and supporting stacks.

The pipeline itself is CDK-managed (a pipeline stack), so it is versioned and
reproducible. The initial CodeStar Connection must be authorised once in the AWS
console (GitHub App handshake) before the pipeline can pull the repo.

## Quality gates

- PR build must pass (build, lint, test, `cdk synth`/`diff`) before merge.
- `main` branch protection: PR required, ≥1 approving review, stale reviews
  dismissed, linear history, no direct or force pushes (enforced for admins).
- Deploys run only from `main`.

## Promotion

A single `prod` environment for now. The pipeline is structured so a `staging`
stage and a manual approval (promotion gate) action can be inserted between Build
and the prod Deploy without reworking the source/build stages (ADR-0004,
DEP-005).

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.2.0 | 2026-10-01 | Kiro | Defined the AWS CodePipeline + CodeBuild pipeline (CodeStar Connection source, PR CodeBuild checks, merge-to-main deploy), quality gates and promotion path, per ADR-0004 v2.0.0. |
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
