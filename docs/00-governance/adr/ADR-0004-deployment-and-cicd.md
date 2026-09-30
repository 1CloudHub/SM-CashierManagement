---
id: ADR-0004
title: Deployment topology and CI/CD
version: 1.0.0
status: Accepted
owner: TBD
last_updated: 2026-09-30
related: [DEP-001, DEP-002, DEP-003, DEP-004, DEP-005, ADR-0002]
---

# Deployment topology and CI/CD

> **Purpose:** Records the AWS deployment target, branching model and pipeline.

## Context

We need automated deployment where a merge to `main` deploys to AWS. Stack per ADR-0002.

## Decision

- **Topology:** SPA on Amazon S3 + CloudFront; API on AWS Lambda + Amazon API Gateway (serverless). Data per ADR-0002 (PostgreSQL/Aurora, S3, SQS workers, Cognito, SES, Amazon Location Service).
- **IaC:** AWS CDK (TypeScript), one app with per-environment configuration.
- **Branching:** GitHub Flow — short-lived branches, PRs into `main`; `main` is always deployable.
- **Environments:** a single `prod` environment for now. The pipeline is written so a `staging` env and a manual promotion gate can be added later without rework.
- **CI/CD:** GitHub Actions. On PR: build, lint, test, `cdk synth`/diff. On merge to `main`: build and `cdk deploy` to AWS prod.
- **AWS auth:** GitHub Actions assumes an AWS IAM role via OIDC; no long-lived AWS keys stored in the repo.

## Alternatives considered

- Trunk-based with staging + manual prod gate: safer; deferred to keep the demo simple but explicitly kept easy to adopt.
- ECS Fargate API: more control for heavy jobs; higher idle cost; revisit if Lambda limits bite for background jobs.
- Stored AWS access keys / CodePipeline: rejected (secrets management / extra setup).

## Consequences

- Every merge to `main` goes live; branch protection and required PR checks are the main safety net.
- Background jobs on Lambda must respect timeout/size limits; long hiring-plan runs may need Step Functions or a Fargate worker later.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-30 | Kiro | S3/CloudFront + Lambda/API GW, GitHub Flow to single prod, GitHub Actions + OIDC |
