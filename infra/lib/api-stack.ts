import * as fs from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface ApiStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /**
   * Directory holding the bundled API Lambda (`index.mjs`). Defaults to the
   * output of `npm run build` in `/api` (`api/dist/lambda`).
   */
  readonly apiBundleDir?: string;
  /**
   * The Cognito user pool whose ID tokens authorize feature routes (task 7).
   * Every route except `GET /health` requires a valid token.
   */
  readonly userPool: cognito.IUserPool;
  /**
   * Browser origins allowed to call the API (CORS), e.g. the SPA's custom
   * domain and CloudFront domain as `https://…` URLs. Applied to the API
   * Gateway preflight and to the function's responses (`CORS_ALLOWED_ORIGINS`).
   * Undefined or empty => any origin (`*`).
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Runs the API function inside the data VPC (task 24) so it can reach
   * Aurora through the app security group. Omitted => no VPC.
   */
  readonly network?: ApiNetwork;
  /** Extra function environment (data/jobs/location/SES settings, task 24). */
  readonly serviceEnvironment?: Record<string, string>;
}

export interface ApiNetwork {
  readonly vpc: ec2.IVpc;
  readonly subnets: ec2.SubnetSelection;
  readonly securityGroups: ec2.ISecurityGroup[];
}

/**
 * Feature routes served by the API (api/src/app.ts), declared explicitly so
 * each carries the Cognito authorizer (task 8.1). API Gateway path syntax.
 * The `{proxy+}` catch-all is protected the same way, so a route missing here
 * is still never public; the API authorises every request against the active
 * role and scope on top (P12).
 */
export const PROTECTED_ROUTES: readonly { readonly method: string; readonly path: string }[] = [
  { method: 'GET', path: '/me' },
  { method: 'PUT', path: '/me/active-role' },
  { method: 'GET', path: '/stores' },
  { method: 'GET', path: '/stores/{storeId}' },
  { method: 'GET', path: '/search' },
  { method: 'GET', path: '/saved-views' },
  { method: 'POST', path: '/saved-views' },
  { method: 'PATCH', path: '/saved-views/{viewId}' },
  { method: 'DELETE', path: '/saved-views/{viewId}' },
  // Data ingestion, snapshots and provenance (task 9; SCR-050/051).
  { method: 'GET', path: '/datasets' },
  { method: 'GET', path: '/datasets/provenance' },
  { method: 'POST', path: '/ingestions/uploads' },
  { method: 'POST', path: '/ingestions' },
  { method: 'GET', path: '/ingestions' },
  { method: 'GET', path: '/ingestions/export' },
  { method: 'GET', path: '/ingestions/{ingestionId}' },
  { method: 'GET', path: '/ingestions/{ingestionId}/report' },
  { method: 'POST', path: '/ingestions/{ingestionId}/load' },
  { method: 'POST', path: '/ingestions/{ingestionId}/cancel' },
  { method: 'GET', path: '/snapshots' },
  { method: 'GET', path: '/snapshots/{snapshotId}' },
  { method: 'PATCH', path: '/snapshots/{snapshotId}' },
  // Task 10: business rule sets and versions (SCR-060, SCR-061).
  { method: 'GET', path: '/rule-sets' },
  { method: 'GET', path: '/rule-sets/{ruleSetId}/versions' },
  { method: 'POST', path: '/rule-sets/{ruleSetId}/versions' },
  { method: 'GET', path: '/rule-versions/{versionId}' },
  { method: 'PATCH', path: '/rule-versions/{versionId}' },
  { method: 'POST', path: '/rule-versions/{versionId}/submit' },
  { method: 'POST', path: '/rule-versions/{versionId}/approve' },
  { method: 'POST', path: '/rule-versions/{versionId}/request-changes' },
  { method: 'POST', path: '/rule-versions/{versionId}/publish' },
  { method: 'GET', path: '/rule-versions/{versionId}/diff' },
  // Task 11: scenarios — list, settings, runs, staleness refresh, compare (SCR-030/031/032).
  { method: 'GET', path: '/scenarios' },
  { method: 'POST', path: '/scenarios' },
  { method: 'GET', path: '/scenarios/compare' },
  { method: 'GET', path: '/scenarios/{scenarioId}' },
  { method: 'PATCH', path: '/scenarios/{scenarioId}' },
  { method: 'POST', path: '/scenarios/{scenarioId}/duplicate' },
  { method: 'POST', path: '/scenarios/{scenarioId}/refresh' },
  { method: 'POST', path: '/scenarios/{scenarioId}/run' },
  { method: 'POST', path: '/scenarios/{scenarioId}/submit' },
  { method: 'POST', path: '/scenarios/{scenarioId}/archive' },
  // Task 15: home-area consent and location privacy.
  { method: 'GET', path: '/me/consents' },
  { method: 'POST', path: '/me/consents' },
  { method: 'DELETE', path: '/me/consents/{purpose}' },
  { method: 'GET', path: '/me/home-area' },
  { method: 'PUT', path: '/me/home-area' },
  { method: 'DELETE', path: '/me/home-area' },
  { method: 'GET', path: '/me/home-area/barangays' },
  { method: 'GET', path: '/staff/{staffId}/home-area' },
  // Task 13.4: published rosters and store-manager overrides (SCR-022).
  { method: 'GET', path: '/stores/{storeId}/rosters' },
  { method: 'GET', path: '/stores/{storeId}/rosters/{rosterId}' },
  { method: 'GET', path: '/stores/{storeId}/rosters/{rosterId}/shifts/{shiftId}/replacements' },
  { method: 'POST', path: '/stores/{storeId}/rosters/{rosterId}/overrides/check' },
  { method: 'POST', path: '/stores/{storeId}/rosters/{rosterId}/overrides' },
];

/** Request headers the SPA sends: the defaults plus the demo role switcher's `X-Active-Role`. */
export const CORS_ALLOW_HEADERS: readonly string[] = [...apigateway.Cors.DEFAULT_HEADERS, 'X-Active-Role'];

/** Default location of the API bundle produced by `api/scripts/bundle.mjs`. */
export const DEFAULT_API_BUNDLE_DIR = path.join(__dirname, '..', '..', 'api', 'dist', 'lambda');

function assertApiBundle(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'index.mjs'))) {
    throw new Error(
      `API bundle not found at ${dir}/index.mjs. Build it first: ` +
        '(cd packages/shared && npm ci && npm run build) && (cd api && npm ci && npm run build)',
    );
  }
}

/**
 * API tier: AWS Lambda + Amazon API Gateway (REST), per ADR-0004 / DEP-003.
 *
 * Ships the bundled API service (task 4) behind a REST API. `GET /health` is
 * the only public route (walking-skeleton deploy, task 3.5). Every other path
 * is proxied to the API function behind the Cognito user-pool authorizer
 * (task 7.1) — secure by default: feature routes added to the in-process
 * router are protected without further infra changes, and the API re-checks
 * the verified claims (identity + domain allowlist, api/src/context.ts). The
 * data services (Aurora, S3, SQS, SES, Location Service) live in their own
 * stacks (task 24); `network` + `serviceEnvironment` place the function in the
 * data VPC and pass their settings, and bin/infra.ts adds the scoped grants.
 */
export class ApiStack extends Stack {
  /** The invoke URL of the deployed REST API (e.g. https://xxxx.execute-api.../prod/). */
  public readonly apiUrl: string;
  /** Cognito authorizer for feature routes (ID token in `Authorization`). */
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  /** Method options that protect a route with the Cognito authorizer. */
  public readonly protectedMethodOptions: apigateway.MethodOptions;
  /** The API function (grants for data services are added in bin/infra.ts). */
  public readonly apiFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const allowedOrigins = props.allowedOrigins && props.allowedOrigins.length > 0 ? [...props.allowedOrigins] : undefined;

    // The LaneWise API service (/api, @lanewise/api): a single Node 20 Lambda
    // behind API Gateway, routing requests in-process. The bundle is built by
    // the API package (esbuild, self-contained ESM) in the build stage, so synth
    // and deploy need no bundling toolchain.
    const bundleDir = props.apiBundleDir ?? DEFAULT_API_BUNDLE_DIR;
    assertApiBundle(bundleDir);

    const apiLogGroup = new logs.LogGroup(this, 'ApiFunctionLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy,
    });

    const apiFn = new lambda.Function(this, 'ApiFunction', {
      functionName: `lanewise-${config.envName}-api`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(bundleDir),
      timeout: Duration.seconds(10),
      memorySize: 256,
      description: 'LaneWise API service (@lanewise/api).',
      logGroup: apiLogGroup,
      environment: {
        LANEWISE_ENV: config.envName,
        LOG_LEVEL: 'info',
        NODE_OPTIONS: '--enable-source-maps',
        // Demo role switcher (requirement 3); the API authorises every request
        // against the active role either way (P12).
        DEMO_ROLE_SWITCHER: config.demoRoleSwitcher ? 'true' : 'false',
        CORS_ALLOWED_ORIGINS: allowedOrigins ? Fn.join(',', allowedOrigins) : '*',
        ...props.serviceEnvironment,
      },
      ...(props.network && {
        vpc: props.network.vpc,
        vpcSubnets: props.network.subnets,
        securityGroups: props.network.securityGroups,
      }),
    });
    this.apiFunction = apiFn;

    const api = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `lanewise-${config.envName}-api`,
      description: `LaneWise API (${config.envName}).`,
      deployOptions: {
        stageName: config.envName,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      // CORS limited to the SPA's origins (custom domain + CloudFront domain);
      // the function echoes the same allowlist on its responses.
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins ?? apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [...CORS_ALLOW_HEADERS],
      },
    });

    // One API-wide invoke permission instead of one (plus a test-invoke one)
    // per method: with ~100 routes the per-method statements exceed Lambda's
    // 20 KB resource-policy limit and the stack update fails.
    // A plain AWS_PROXY integration plus ONE API-wide invoke permission:
    // LambdaIntegration adds two permissions per method, and with ~100 routes
    // those statements exceed Lambda's 20 KB resource-policy limit.
    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.AWS_PROXY,
      integrationHttpMethod: 'POST',
      uri: `arn:${Stack.of(this).partition}:apigateway:${Stack.of(this).region}:lambda:path/2015-03-31/functions/${apiFn.functionArn}/invocations`,
    });

    // Public: the health check only.
    const health = api.root.addResource('health');
    health.addMethod('GET', integration, { authorizationType: apigateway.AuthorizationType.NONE });

    // Everything else: Cognito user-pool authorizer (ID token, `Authorization`
    // header). CORS preflight (OPTIONS) stays unauthenticated.
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      authorizerName: `lanewise-${config.envName}-cognito`,
      cognitoUserPools: [props.userPool],
      identitySource: apigateway.IdentitySource.header('Authorization'),
      resultsCacheTtl: Duration.minutes(5),
    });
    this.protectedMethodOptions = {
      authorizer: this.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    // The root `/` too: declared explicitly so the proxy below doesn't add an
    // unauthenticated root ANY method (ProxyResource does that by default).
    api.root.addMethod('ANY', integration, this.protectedMethodOptions);
    api.root.addProxy({
      defaultIntegration: integration,
      anyMethod: true,
      defaultMethodOptions: this.protectedMethodOptions,
    });
    for (const route of PROTECTED_ROUTES) {
      api.root.resourceForPath(route.path).addMethod(route.method, integration, this.protectedMethodOptions);
    }

    apiFn.addPermission('ApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('*', '/*', '*'),
    });

    this.apiUrl = api.url;

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Invoke URL of the LaneWise REST API.',
    });

  }
}
