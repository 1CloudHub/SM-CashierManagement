# LaneWise infrastructure (AWS CDK)

AWS CDK app (TypeScript) for the Cashier Staffing Planner (LaneWise). Implements
the deployment topology from **ADR-0004** and docs **DEP-003 / DEP-004 / DEP-005**:

- **SPA hosting** — private Amazon S3 bucket served through Amazon CloudFront via
  Origin Access Control (OAC), with SPA (client-side routing) fallback to
  `index.html`. Optionally on a custom domain (ACM certificate + Route 53 alias
  records); prod uses `https://lanewise.prototypes.1cloudhub.com`.
  (`lib/spa-hosting-stack.ts`)
- **API** — AWS Lambda behind Amazon API Gateway (REST), CORS limited to the
  SPA's origins. Runs the bundled
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

The stacks are `LaneWise-prod-SpaHosting`, `LaneWise-prod-Auth`,
`LaneWise-prod-Api`, `LaneWise-prod-PipelineIam`, `LaneWise-prod-PipelinePrChecks`
and `LaneWise-prod-DeployPipeline`.

## Custom domain (SPA)

Config-driven (`config/environments.ts`): set `domainName` and `hostedZone:
{ id, name }` (an existing Route 53 public hosted zone that contains the name).
`LaneWise-<env>-SpaHosting` then:

- issues an ACM certificate for `domainName`, DNS-validated in the imported
  zone (`HostedZone.fromHostedZoneAttributes`; the zone itself and its other
  records are not managed here);
- adds the name + certificate to the CloudFront distribution (SNI, TLS 1.2+);
  the default `*.cloudfront.net` domain keeps working;
- creates Route 53 `A` and `AAAA` alias records pointing at the distribution;
- outputs `SpaUrl` (the custom domain when set).

CloudFront only accepts certificates from **us-east-1**, so an environment with a
custom domain must deploy the SPA stack there (a CloudFormation rule fails the
deploy otherwise). Leave `domainName` unset to serve only the CloudFront domain.

Prod: `lanewise.prototypes.1cloudhub.com` in zone `prototypes.1cloudhub.com`
(`Z10306162UR77DOLJD1L3`, account 675379425271, us-east-1).

**CORS.** The API allows only the SPA's origins — `https://<domainName>` and
`https://<cloudfront domain>` — on the API Gateway preflight and on the
function's responses (`CORS_ALLOWED_ORIGINS`). Without an allowlist it falls
back to `*`.

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
- **Relying party.** Passkeys are bound to `auth.relyingPartyId`, else
  `domainName`, else the SPA's CloudFront domain. Prod:
  `lanewise.prototypes.1cloudhub.com` — so passkey sign-in works only on the
  custom domain, not on the `*.cloudfront.net` URL. Changing it later
  invalidates every registered passkey.
- **Email one-time codes (SES).** `auth.email` names the Amazon SES sender;
  with it set the pool sends through SES (`EmailSendingAccount: DEVELOPER`) and
  `EMAIL_OTP` is an allowed first factor. Prod sends as
  `LaneWise <noreply@1cloudhub.com>` from the verified `1cloudhub.com` domain
  identity in us-east-1 (DKIM verified; account out of the SES sandbox). Cognito
  sends through its `AWSServiceRoleForAmazonCognitoIdpEmailService`
  service-linked role (created automatically on deploy; same-account identity,
  so no SES sending-authorization policy is needed). With `auth.email` unset,
  email OTP stays **off** and `cdk synth` warns
  (`lanewise:auth:email-otp-disabled`). To change the sender: verify the new
  identity in SES (out of the sandbox) in `sesRegion`, then update
  `auth.email = { fromEmail, fromName?, sesVerifiedDomain?, sesRegion }`.
- **No hosted UI.** The app client has OAuth disabled, so there are no
  callback/logout URLs to maintain for the domain.
- **SPA config.** The deploy stage writes `runtime-config.json` (pool id,
  client id, region, self sign-up flag, API URL) into the SPA bucket from the
  stack outputs. None of it depends on the SPA origin, so it is the same for
  the custom and CloudFront domains.

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
