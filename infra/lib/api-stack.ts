import * as fs from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
 * Ships the bundled API service (task 4) behind a REST API; today it exposes
 * only the unauthenticated `GET /health` route used by the walking-skeleton
 * deploy (task 3.5). Feature routes (with the Cognito authorizer, task 7) and
 * the data services (Aurora, S3, SQS, SES, Location Service) are added in later
 * phases (task 24) by extending this stack.
 */
export class ApiStack extends Stack {
  /** The invoke URL of the deployed REST API (e.g. https://xxxx.execute-api.../prod/). */
  public readonly apiUrl: string;

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

    const health = api.root.addResource('health');
    health.addMethod('GET', new apigateway.LambdaIntegration(apiFn));

    this.apiUrl = api.url;

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Invoke URL of the LaneWise REST API.',
    });

  }
}
