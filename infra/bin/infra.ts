#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { resolveEnvironment } from '../config/environments';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { DeployPipelineStack } from '../lib/deploy-pipeline-stack';
import { JobsStack } from '../lib/jobs-stack';
import { LocationStack } from '../lib/location-stack';
import { grantSesSend, sesEnvironment } from '../lib/notifications';
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
  relyingPartyId: config.auth.relyingPartyId ?? config.domainName ?? spa.distribution.distributionDomainName,
  description: `LaneWise authentication (Cognito passkeys + domain allowlist) — ${config.envName}.`,
});

// Feature data services (task 24): VPC + Aurora PostgreSQL + migrations +
// uploads bucket, the background-job queue/worker, and Amazon Location.
const data = new DataStack(app, `${prefix}-Data`, {
  env,
  config,
  uploadCorsOrigins: [
    `https://${spa.distribution.distributionDomainName}`,
    ...(config.domainName ? [`https://${config.domainName}`] : []),
  ],
  description: `LaneWise data tier (VPC, Aurora PostgreSQL, migrations, uploads bucket) — ${config.envName}.`,
});

const jobs = new JobsStack(app, `${prefix}-Jobs`, {
  env,
  config,
  vpc: data.vpc,
  appSubnets: data.appSubnets,
  appSecurityGroup: data.appSecurityGroup,
  dbSecret: data.dbSecret,
  dbEnvironment: data.dbEnvironment,
  description: `LaneWise background jobs (SQS + worker Lambda) — ${config.envName}.`,
});

const location = new LocationStack(app, `${prefix}-Location`, {
  env,
  config,
  description: `LaneWise Amazon Location Service (map + route calculator) — ${config.envName}.`,
});

const api = new ApiStack(app, `${prefix}-Api`, {
  env,
  config,
  userPool: auth.userPool,
  // CORS: only the SPA's origins (custom domain + CloudFront domain).
  allowedOrigins: spa.spaOrigins,
  network: { vpc: data.vpc, subnets: data.appSubnets, securityGroups: [data.appSecurityGroup] },
  serviceEnvironment: {
    ...data.dbEnvironment,
    UPLOADS_BUCKET: data.uploadsBucket.bucketName,
    JOBS_QUEUE_URL: jobs.queue.queueUrl,
    LOCATION_MAP_NAME: location.mapName,
    LOCATION_ROUTE_CALCULATOR: location.routeCalculatorName,
    ...sesEnvironment(data, config.notifications),
  },
  description: `LaneWise API (Lambda + API Gateway) — ${config.envName}.`,
});

// Least-privilege grants for the feature services, each scoped to the one
// resource it uses (policies land on the function roles in Api/Jobs stacks).
data.dbSecret.grantRead(api.apiFunction);
data.uploadsBucket.grantPut(api.apiFunction);
data.uploadsBucket.grantRead(api.apiFunction);
jobs.queue.grantSendMessages(api.apiFunction);
location.grantMap(api.apiFunction);
location.grantRoutes(api.apiFunction);
grantSesSend(api, api.apiFunction, config.notifications);

jobs.worker.addEnvironment('UPLOADS_BUCKET', data.uploadsBucket.bucketName);
jobs.worker.addEnvironment('LOCATION_ROUTE_CALCULATOR', location.routeCalculatorName);
for (const [key, value] of Object.entries(sesEnvironment(jobs, config.notifications))) {
  jobs.worker.addEnvironment(key, value);
}
data.uploadsBucket.grantRead(jobs.worker);
location.grantRoutes(jobs.worker);
grantSesSend(jobs, jobs.worker, config.notifications);

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
void data;
void jobs;
void location;
void api;
void pipelineIam;
void pipelinePrChecks;
void deployPipeline;

app.synth();
