#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { resolveEnvironment } from '../config/environments';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { DeployPipelineStack } from '../lib/deploy-pipeline-stack';
import { PipelineIamStack } from '../lib/pipeline-iam-stack';
import { PipelinePrChecksStack } from '../lib/pipeline-pr-checks-stack';
import { SpaHostingStack } from '../lib/spa-hosting-stack';

const app = new App();

// Environment is selected via `-c env=<name>` context or LANEWISE_ENV; defaults
// to prod (the only active environment today). Adding `staging` is a config +
// wiring change only — see config/environments.ts (ADR-0004 / DEP-005).
const envName = app.node.tryGetContext('env') ?? process.env.LANEWISE_ENV;
const config = resolveEnvironment(envName);

const env = { account: config.account, region: config.region };
const prefix = `LaneWise-${config.envName}`;

const spa = new SpaHostingStack(app, `${prefix}-SpaHosting`, {
  env,
  config,
  description: `LaneWise SPA hosting (S3 + CloudFront) — ${config.envName}.`,
});

// Cognito user pool (passkeys + domain allowlist, task 7). Passkeys are bound
// to the SPA's domain (the relying party), so this follows SPA hosting.
const auth = new AuthStack(app, `${prefix}-Auth`, {
  env,
  config,
  relyingPartyId: config.auth.relyingPartyId ?? spa.distribution.distributionDomainName,
  description: `LaneWise authentication (Cognito passkeys + domain allowlist) — ${config.envName}.`,
});

const api = new ApiStack(app, `${prefix}-Api`, {
  env,
  config,
  userPool: auth.userPool,
  description: `LaneWise API (Lambda + API Gateway) — ${config.envName}.`,
});

// Source connection + scoped IAM service roles for the CI/CD pipeline (task 3.2).
// The pipeline and build projects themselves are added in tasks 3.3/3.4.
const pipelineIam = new PipelineIamStack(app, `${prefix}-PipelineIam`, {
  env,
  config,
  description: `LaneWise CI/CD source connection + pipeline IAM roles — ${config.envName}.`,
});

// PR checks build project (task 3.3): install/build/lint/test/cdk synth+diff on
// pull requests, reporting status back to the PR. Reuses the CodeBuild role
// from PipelineIamStack (no duplicate identity).
const pipelinePrChecks = new PipelinePrChecksStack(app, `${prefix}-PipelinePrChecks`, {
  env,
  config,
  codeBuildRoleArn: pipelineIam.codeBuildRole.roleArn,
  connectionArn: pipelineIam.connectionArn,
  description: `LaneWise CI/CD pull-request checks (CodeBuild) — ${config.envName}.`,
});

// Deploy pipeline (task 3.4): on merge to `main`, Source (CodeStar Connection)
// -> Build (CodeBuild: SPA + API) -> Deploy (cdk deploy prod, sync SPA to S3,
// invalidate CloudFront). Reuses the connection + pipeline/CodeBuild roles from
// PipelineIamStack. Structured so a staging deploy + manual promotion gate can
// be inserted before the prod deploy later (DEP-005).
const deployPipeline = new DeployPipelineStack(app, `${prefix}-DeployPipeline`, {
  env,
  config,
  connectionArn: pipelineIam.connectionArn,
  pipelineRoleArn: pipelineIam.pipelineRole.roleArn,
  codeBuildRoleArn: pipelineIam.codeBuildRole.roleArn,
  description: `LaneWise CI/CD deploy pipeline (merge to main -> prod) — ${config.envName}.`,
});

// Apply per-environment tags to every resource in the app.
for (const [key, value] of Object.entries(config.tags)) {
  Tags.of(app).add(key, value);
}

void spa;
void auth;
void api;
void pipelineIam;
void pipelinePrChecks;
void deployPipeline;

app.synth();
