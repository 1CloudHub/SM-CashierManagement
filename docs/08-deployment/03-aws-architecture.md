---
id: DEP-003
title: AWS deployment architecture
version: 0.3.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: [ADR-0002, ADR-0004, DEP-002, DEP-004, DEP-005]
---

# AWS deployment architecture

> **Purpose:** Describes the AWS resources LaneWise runs on in each environment
> and how they connect, per ADR-0002 (stack) and ADR-0004 (deployment).

## Architecture diagram

```
Browser ──> CloudFront ──> S3 (SPA)
   │
   ├──> API Gateway (REST, Cognito authorizer) ──> API Lambda ─┐
   │                                                           │  VPC (isolated subnets)
   └──> S3 uploads bucket (pre-signed URLs)                    ├──> Aurora PostgreSQL Serverless v2
                                                               ├──> VPC endpoints: Secrets Manager, SQS,
                         SQS jobs queue ──> Jobs worker Lambda ┘      Location routes, S3 (gateway)
                              └── DLQ
Deploy: CloudFormation ──> Trigger ──> Migrate Lambda (api/dist/migrate) ──> Aurora
```

## Accounts and regions

One AWS account per environment (resolved from the deploy credentials,
`CDK_DEFAULT_ACCOUNT`) and two regions, set per environment in
`infra/config/environments.ts`. Only `prod` is active (DEP-005).

| Region (config key) | Prod | Stacks |
|---|---|---|
| Home (`region`) | us-east-1 | `SpaHosting`, `PipelineIam`, `PipelinePrChecks`, `DeployPipeline` |
| Application (`appRegion`) | us-east-2 | `Auth`, `Data`, `Jobs`, `Location`, `Api` |
| SES (`auth.email.sesRegion`, `notifications.sesRegion`) | us-east-1 | — (verified `1cloudhub.com` identity, outside CDK) |

**Why the application runs in us-east-2.** The first deploy of the `Data`
stack (VPC + Aurora) failed in us-east-1 because the account had reached its
VPC limit there. The VPC-bound application stacks moved to us-east-2 (spare VPC
capacity, already CDK-bootstrapped). SPA hosting stays in us-east-1 so the
CloudFront distribution and the site URL do not change (a custom-domain
certificate must be in us-east-1 anyway), and so does the pipeline.

**Cross-region wiring.** The application stacks need the SPA's CloudFront
domain (API and uploads CORS, passkey relying party). They get it through CDK
cross-region references: the `SpaHosting` stack writes the value to SSM
parameters in us-east-2 and the `Auth`, `Data` and `Api` stacks read it there
at deploy time. Cognito (us-east-2) sends its one-time codes through SES in
us-east-1, and the notifications settings and SES send grants of the API and
jobs worker name the us-east-1 identity. The deploy stage reads each stack's
outputs in its own region and writes `region: us-east-2` into the SPA's
`runtime-config.json`.

## Networking

- A dedicated VPC (`10.40.0.0/16`) across two availability zones with
  **isolated** subnets only: no internet gateway and no NAT gateway.
- Functions that talk to the database (API, jobs worker, migrations) run in the
  VPC in an **app security group**; the database security group accepts
  PostgreSQL (5432) only from that group.
- AWS APIs are reached through VPC endpoints: S3 (gateway, free) plus interface
  endpoints for Secrets Manager, SQS and Amazon Location routes.
- Amazon SES has no PrivateLink endpoint for its API (only SMTP). Sending email
  from a function in the VPC needs a NAT gateway (`data.natGateways: 1` in the
  environment config, which adds private-with-egress subnets for the functions)
  or a sender outside the VPC. This is decided with task 19.

## Services

| Service | Stack | Notes |
|---|---|---|
| S3 + CloudFront | `SpaHosting` | SPA hosting (OAC) |
| Cognito | `Auth` | Passkey sign-in, domain allowlist |
| API Gateway + Lambda | `Api` | Runs in the VPC; env carries the data-service settings |
| Aurora PostgreSQL Serverless v2 | `Data` | PostgreSQL 16, encrypted, TLS required, credentials in Secrets Manager, deletion protection and snapshot-on-delete in prod |
| Lambda + CDK Trigger | `Data` | Runs the bundled migrate CLI on every deploy that changes migrations; failure fails the deploy before the API updates |
| S3 uploads bucket | `Data` | Ingestion files (task 9): private, SSE-S3, TLS-only, versioned, lifecycle expiry |
| SQS + Lambda worker | `Jobs` | Background jobs (task 14.2) with a dead-letter queue and capped concurrency |
| Amazon Location Service | `Location` | Map + route calculator (tasks 16.1/16.2) |
| Amazon SES (us-east-1) | — | Send-only grant from the verified `1cloudhub.com` identity (task 19); Cognito one-time codes |

RDS Proxy is not used: at demo scale a small per-container pool is enough, and
a proxy on Aurora Serverless v2 bills a minimum of 8 ACUs. Revisit if API
concurrency grows.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Claude | Data services, networking and migrations (task 24) |
| 0.3.0 | 2026-10-01 | Claude | Application stacks in us-east-2 (us-east-1 VPC limit); SPA/CI-CD and SES stay in us-east-1 |
