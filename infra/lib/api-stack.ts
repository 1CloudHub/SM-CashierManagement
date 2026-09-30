import * as fs from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
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
}

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
 * data services (Aurora, S3, SQS, SES, Location Service) are added in later
 * phases (task 24) by extending this stack.
 */
export class ApiStack extends Stack {
  /** The invoke URL of the deployed REST API (e.g. https://xxxx.execute-api.../prod/). */
  public readonly apiUrl: string;
  /** Cognito authorizer for feature routes (ID token in `Authorization`). */
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  /** Method options that protect a route with the Cognito authorizer. */
  public readonly protectedMethodOptions: apigateway.MethodOptions;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

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
      },
    });

    const api = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `lanewise-${config.envName}-api`,
      description: `LaneWise API (${config.envName}).`,
      deployOptions: {
        stageName: config.envName,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      // Permissive CORS for the skeleton; tightened to the CloudFront origin in
      // later phases once the SPA domain is fixed.
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const integration = new apigateway.LambdaIntegration(apiFn);

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

    this.apiUrl = api.url;

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Invoke URL of the LaneWise REST API.',
    });

  }
}
