# LaneWise infrastructure (AWS CDK)

AWS CDK app (TypeScript) for the Cashier Staffing Planner (LaneWise). Implements
the deployment topology from **ADR-0004** and docs **DEP-003 / DEP-004 / DEP-005**:

- **SPA hosting** — private Amazon S3 bucket served through Amazon CloudFront via
  Origin Access Control (OAC), with SPA (client-side routing) fallback to
  `index.html`. (`lib/spa-hosting-stack.ts`)
- **API** — AWS Lambda behind Amazon API Gateway (REST). Ships a `/health`
  skeleton endpoint for the walking-skeleton deploy (task 3.5); feature routes
  and data services are added in later phases. (`lib/api-stack.ts`)
- **Pipeline IAM** — the CodeStar (GitHub) Connection plus scoped IAM service
  roles for CodePipeline and CodeBuild. No stored AWS keys / GitHub credentials.
  The pipeline and build projects themselves are added in tasks 3.3/3.4.
  (`lib/pipeline-iam-stack.ts`)

One CDK app with **per-environment configuration**. Only `prod` is active today;
`staging` and a promotion gate can be added without reworking the stacks.

## Layout

```
infra/
  bin/infra.ts                 # app entry — resolves env config, instantiates stacks
  config/environments.ts       # per-environment config map (prod now; staging template)
  lib/spa-hosting-stack.ts     # S3 + CloudFront (OAC) SPA hosting
  lib/api-stack.ts             # Lambda + API Gateway
  lib/pipeline-iam-stack.ts    # CodeStar (GitHub) connection + pipeline/CodeBuild IAM roles
  lambda/health/health.mjs     # health-check handler (skeleton)
  test/stacks.test.ts          # CDK assertion smoke tests
```

## Commands

```bash
npm install         # install dependencies
npm run synth       # cdk synth (default env: prod)
npm run diff        # cdk diff against the deployed stacks
npm test            # vitest smoke tests over the synthesized templates
npm run build       # tsc type-check / emit
```

Select an environment with CDK context or an env var (defaults to `prod`):

```bash
npx cdk synth -c env=prod
LANEWISE_ENV=prod npx cdk synth
```

The stacks are `LaneWise-prod-SpaHosting`, `LaneWise-prod-Api` and
`LaneWise-prod-PipelineIam`.

## ⚠️ Manual step: authorise the GitHub App (one-time)

`LaneWise-prod-PipelineIam` creates the CodeStar (GitHub) Connection in a
**PENDING** state. CDK/CloudFormation cannot complete the OAuth/GitHub App
handshake — a human with admin on the GitHub org must do it **once** in the AWS
console before any pipeline can pull the repo:

1. Deploy `LaneWise-prod-PipelineIam` (done later via the pipeline; do **not**
   `cdk deploy` from a laptop for this task — it is synth-only for now).
2. AWS console → **Developer Tools / CodePipeline → Settings → Connections**.
3. Select the `lanewise-prod-github` connection (status **Pending**) →
   **Update pending connection**.
4. When prompted, **Install a new app** (or pick an existing install) and
   authorise the **AWS Connector for GitHub** on the `1CloudHub` org, granting it
   access to the `SM-CashierManagement` repository.
5. Confirm the connection status becomes **Available**.

No GitHub token or AWS access key is stored anywhere — the connection is the
credential broker (NFR-SEC-004). Update `config/environments.ts` (`github` block)
if the org/repo/connection name differs.

## Adding `staging` later

Per ADR-0004 / DEP-005 this is a configuration + wiring change only:

1. Add `'staging'` to the `EnvName` union in `config/environments.ts`.
2. Populate the commented `staging` entry in the `environments` map.
3. Instantiate the stacks for `staging` in `bin/infra.ts` and insert a manual
   approval (promotion gate) stage before the prod deploy in the pipeline stack
   (tasks 3.2–3.4).

## Notes

- This task is scaffolding + `cdk synth` only. Do **not** run `cdk deploy` or any
  IAM/resource-affecting command from here — deployment is wired through the
  CodePipeline/CodeBuild pipeline (tasks 3.2–3.5).
- The SPA bucket is created empty; the pipeline uploads `frontend/dist` and
  invalidates CloudFront on deploy.
