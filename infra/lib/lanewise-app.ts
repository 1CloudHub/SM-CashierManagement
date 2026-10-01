import type { App } from 'aws-cdk-lib';
import { appRegionOf, type EnvironmentConfig, isSplitRegion } from '../config/environments';
import { ApiStack } from './api-stack';
import { AuthStack } from './auth-stack';
import { DataStack } from './data-stack';
import { DeployPipelineStack } from './deploy-pipeline-stack';
import { JobsStack } from './jobs-stack';
import { LocationStack } from './location-stack';
import { grantSesSend, sesEnvironment } from './notifications';
import { PipelineIamStack } from './pipeline-iam-stack';
import { PipelinePrChecksStack } from './pipeline-pr-checks-stack';
import { SpaHostingStack } from './spa-hosting-stack';

export interface LaneWiseStacks {
  readonly spa: SpaHostingStack;
  readonly auth: AuthStack;
  readonly data: DataStack;
  readonly jobs: JobsStack;
  readonly location: LocationStack;
  readonly api: ApiStack;
  readonly pipelineIam: PipelineIamStack;
  readonly pipelinePrChecks: PipelinePrChecksStack;
  readonly deployPipeline: DeployPipelineStack;
}

/**
 * Instantiates every LaneWise stack for one environment (used by bin/infra.ts
 * and the tests, so both exercise the same wiring).
 *
 * Two regions: SPA hosting + CI/CD deploy to `config.region` (us-east-1:
 * CloudFront, the pipeline), the VPC-bound application stacks (Auth, Data,
 * Jobs, Location, Api) to `config.appRegion` (prod: us-east-2). The app stacks
 * consume the SPA's CloudFront domain (API/uploads CORS, passkey relying
 * party) through CDK cross-region references: SpaHosting writes the value to
 * SSM parameters in the app region, the consumers read it there at deploy.
 */
export function createLaneWiseStacks(app: App, config: EnvironmentConfig): LaneWiseStacks {
  const homeEnv = { account: config.account, region: config.region };
  const appEnv = { account: config.account, region: appRegionOf(config) };
  const crossRegionReferences = isSplitRegion(config);
  const appProps = { env: appEnv, config, crossRegionReferences };
  const prefix = `LaneWise-${config.envName}`;

  const spa = new SpaHostingStack(app, `${prefix}-SpaHosting`, {
    env: homeEnv,
    config,
    description: `LaneWise SPA hosting (S3 + CloudFront) — ${config.envName}.`,
  });
  if (crossRegionReferences && config.legacyAppStacksInHomeRegion) {
    // The pre-move Auth/Api copies in the home region import this export;
    // CloudFormation refuses to drop an export that is still imported.
    spa.exportValue(spa.distribution.distributionDomainName);
  }

  // Cognito user pool (passkeys + domain allowlist, task 7). Passkeys are bound
  // to the SPA's domain (the relying party), so this follows SPA hosting.
  const auth = new AuthStack(app, `${prefix}-Auth`, {
    ...appProps,
    relyingPartyId: config.auth.relyingPartyId ?? config.domainName ?? spa.distribution.distributionDomainName,
    description: `LaneWise authentication (Cognito passkeys + domain allowlist) — ${config.envName}.`,
  });

  // Feature data services (task 24): VPC + Aurora PostgreSQL + migrations +
  // uploads bucket, the background-job queue/worker, and Amazon Location.
  const data = new DataStack(app, `${prefix}-Data`, {
    ...appProps,
    uploadCorsOrigins: [
      `https://${spa.distribution.distributionDomainName}`,
      ...(config.domainName ? [`https://${config.domainName}`] : []),
    ],
    description: `LaneWise data tier (VPC, Aurora PostgreSQL, migrations, uploads bucket) — ${config.envName}.`,
  });

  const jobs = new JobsStack(app, `${prefix}-Jobs`, {
    ...appProps,
    vpc: data.vpc,
    appSubnets: data.appSubnets,
    appSecurityGroup: data.appSecurityGroup,
    dbSecret: data.dbSecret,
    dbEnvironment: data.dbEnvironment,
    description: `LaneWise background jobs (SQS + worker Lambda) — ${config.envName}.`,
  });

  const location = new LocationStack(app, `${prefix}-Location`, {
    ...appProps,
    description: `LaneWise Amazon Location Service (map + route calculator) — ${config.envName}.`,
  });

  const api = new ApiStack(app, `${prefix}-Api`, {
    ...appProps,
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
  const pipelineIam = new PipelineIamStack(app, `${prefix}-PipelineIam`, {
    env: homeEnv,
    config,
    description: `LaneWise CI/CD source connection + pipeline IAM roles — ${config.envName}.`,
  });

  // PR checks build project (task 3.3): install/build/lint/test/cdk synth+diff on
  // pull requests, reporting status back to the PR. Reuses the CodeBuild role
  // from PipelineIamStack (no duplicate identity).
  const pipelinePrChecks = new PipelinePrChecksStack(app, `${prefix}-PipelinePrChecks`, {
    env: homeEnv,
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
    env: homeEnv,
    config,
    connectionArn: pipelineIam.connectionArn,
    pipelineRoleArn: pipelineIam.pipelineRole.roleArn,
    codeBuildRoleArn: pipelineIam.codeBuildRole.roleArn,
    description: `LaneWise CI/CD deploy pipeline (merge to main -> prod) — ${config.envName}.`,
  });

  return { spa, auth, data, jobs, location, api, pipelineIam, pipelinePrChecks, deployPipeline };
}
