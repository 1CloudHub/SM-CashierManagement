# LaneWise infrastructure (AWS CDK)

AWS CDK app (TypeScript) for the Cashier Staffing Planner (LaneWise). Implements
the deployment topology from **ADR-0004** and docs **DEP-003 / DEP-004 / DEP-005**:

- **SPA hosting** — private Amazon S3 bucket served through Amazon CloudFront via
  Origin Access Control (OAC), with SPA (client-side routing) fallback to
  `index.html`. (`lib/spa-hosting-stack.ts`)
- **API** — AWS Lambda behind Amazon API Gateway (REST). Runs the bundled
  `@lanewise/api` service (`/api`, built to `api/dist/lambda`) and exposes the
  public `/health` endpoint; every other route goes through the Cognito
  user-pool authorizer (task 7). Data services are added in later phases.
  (`lib/api-stack.ts`)
- **Auth** — Amazon Cognito user pool with passkey (WebAuthn) sign-in, email
  one-time codes for passkey bootstrap/recovery, the pre-sign-up domain
  allowlist trigger (`api/dist/pre-sign-up`) and the SPA app client
  (task 7). (`lib/auth-stack.ts`)
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
  lib/api-stack.ts             # Lambda + API Gateway (+ Cognito authorizer)
  lib/auth-stack.ts            # Cognito user pool (passkeys), pre-sign-up allowlist, SPA client
  lib/pipeline-iam-stack.ts    # CodeStar (GitHub) connection + pipeline/CodeBuild IAM roles
  test/stacks.test.ts          # CDK assertion smoke tests
```

## Commands

`cdk synth` and the tests need the API bundle. Build it first (from the repo root):

```bash
(cd packages/shared && npm ci && npm run build) && (cd api && npm ci && npm run build)
```

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

## Authentication (Cognito passkeys, task 7)

- **Passkey-only sign-in.** The SPA app client allows only `ALLOW_USER_AUTH`
  (choice-based sign-in) and refresh. Cognito insists on `PASSWORD` staying in
  the pool's allowed first factors, so the password policy is at its maximum
  (99 characters), forgot-password recovery is off (`admin_only`) and users
  sign up without a password; the SPA never offers one.
- **Domain allowlist (P13).** `lanewise-<env>-pre-sign-up` rejects every
  creation path (self sign-up, admin create, federated) for emails outside
  smretail.com / 1cloudhub.com; `email` is immutable. The API re-checks the
  domain on every request.
- **Tokens.** ID/access tokens 60 minutes (= the idle timeout), refresh token
  12 hours (absolute cap; the SPA revokes it on idle sign-out), auth session
  10 minutes.
- **Relying party.** Passkeys are bound to the SPA's CloudFront domain unless
  `auth.relyingPartyId` is set. Set the custom domain *before* users register
  passkeys — changing it later invalidates every passkey.
- **SPA config.** The deploy stage writes `runtime-config.json` (pool id,
  client id, region, API URL) into the SPA bucket from the stack outputs.

### ⚠️ Manual step: verify an SES identity for the one-time codes

Cognito sends email one-time codes only through Amazon SES. Until
`auth.email` is set in `config/environments.ts`, email OTP stays **off** and
`cdk synth` warns (`lanewise:auth:email-otp-disabled`) — nobody can finish
first sign-in. To enable it:

1. In SES (in the region you'll name as `sesRegion`), verify the sender domain
   or address (e.g. `no-reply@lanewise.smretail.com`) and request production
   access (out of the sandbox) so codes reach any smretail.com / 1cloudhub.com
   inbox.
2. Set `auth.email = { fromEmail, fromName?, sesVerifiedDomain?, sesRegion }`
   for the environment and merge; the pipeline deploys it.

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
