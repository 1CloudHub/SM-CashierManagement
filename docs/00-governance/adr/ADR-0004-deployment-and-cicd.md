---
id: ADR-0004
title: Deployment topology and CI/CD
version: 2.0.0
status: Accepted
owner: TBD
last_updated: 2026-10-01
related: [DEP-001, DEP-002, DEP-003, DEP-004, DEP-005, ADR-0002]
---

# Deployment topology and CI/CD

> **Purpose:** Records the AWS deployment target, branching model and pipeline.

## Context

We need automated deployment where a merge to `main` deploys to AWS. Stack per ADR-0002.

The repository is in a GitHub **Free**-plan org. On Free, branch protection and
rulesets are not available for private repos, so the repo was made **public**
(2026-10-01) to enable protection on `main`. We also prefer to keep the CI/CD and
deploy stack inside AWS (single cloud account, IAM-native auth, no third-party CI
minutes); GitHub Actions remains an option but was set aside in favour of an
all-AWS pipeline (see v2.0.0 below). Publishing the repo carries a brand/legal
consideration tracked in GOV-003 R-007 (SM trademark, Q28).

## Decision

- **Topology:** SPA on Amazon S3 + CloudFront; API on AWS Lambda + Amazon API Gateway (serverless). Data per ADR-0002 (PostgreSQL/Aurora, S3, SQS workers, Cognito, SES, Amazon Location Service).
- **IaC:** AWS CDK (TypeScript), one app with per-environment configuration.
- **Branching:** GitHub Flow — short-lived branches, PRs into `main`; `main` is always deployable.
- **Environments:** a single `prod` environment for now. The pipeline is written so a `staging` env and a manual promotion gate can be added later without rework.
- **CI/CD:** AWS CodePipeline + CodeBuild, sourced from GitHub via a CodeStar (GitHub) Connection.
  - **PR checks:** a CodeBuild project triggered on pull requests runs install, build, lint, test and `cdk synth`/`cdk diff`, and reports status back to the PR through the connection.
  - **Deploy:** on merge to `main`, CodePipeline runs Source → Build → Deploy, where Deploy runs `cdk deploy` to AWS prod (SPA to S3 + CloudFront invalidation; Lambda/API Gateway).
- **AWS auth:** no long-lived keys. CodeBuild/CodePipeline use AWS IAM **service roles**; GitHub access is via a CodeStar Connection (GitHub App), not stored credentials.

## Alternatives considered

- **GitHub Actions + OIDC** (the previous v1.0.0 decision): works on private repos and needs no AWS pipeline resources, but keeps CI outside AWS and still cannot enforce branch protection on a Free-plan private repo. Superseded to consolidate CI/CD in AWS.
- Trunk-based with staging + manual prod gate: safer; deferred to keep the demo simple but explicitly kept easy to adopt.
- ECS Fargate API: more control for heavy jobs; higher idle cost; revisit if Lambda limits bite for background jobs.
- Stored AWS access keys: rejected (secrets management).

## Consequences

- Every merge to `main` goes live; the PR CodeBuild check is the main safety net.
- The repo was made **public** (2026-10-01) so GitHub branch protection is available on the Free plan; `main` is now protected (require PR + 1 review, no direct/force pushes, linear history, enforced for admins). The required status-check name for the CodeBuild PR check is added once task 3.3 exists.
- The pipeline itself is CDK-managed infrastructure (a pipeline stack), so it is versioned and reproducible, but the initial CodeStar Connection must be authorised once in the AWS console (GitHub App handshake) before the pipeline can pull the repo.
- Background jobs on Lambda must respect timeout/size limits; long hiring-plan runs may need Step Functions or a Fargate worker later.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 2.0.0 | 2026-10-01 | Kiro | Switched CI/CD from GitHub Actions + OIDC to AWS CodePipeline + CodeBuild via a CodeStar Connection (private Free-plan repo can't use branch protection; keep CI/CD in AWS). Made the repo public so branch protection could be applied to `main`. |
| 1.0.0 | 2026-09-30 | Kiro | S3/CloudFront + Lambda/API GW, GitHub Flow to single prod, GitHub Actions + OIDC |
