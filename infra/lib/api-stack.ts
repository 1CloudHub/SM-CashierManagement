import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface ApiStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * API tier: AWS Lambda + Amazon API Gateway (REST), per ADR-0004 / DEP-003.
 *
 * This skeleton ships a single health-check Lambda behind a REST API so the
 * walking-skeleton deploy (task 3.5) has an endpoint to call. Feature routes,
 * the shared domain layer and the data services (Aurora, S3, SQS, Cognito, SES,
 * Location Service) are added in later phases (task 24) by extending this stack.
 */
export class ApiStack extends Stack {
  /** The invoke URL of the deployed REST API (e.g. https://xxxx.execute-api.../prod/). */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Health-check handler. Kept inline so the app synthesizes without a build
    // step; replaced by the bundled Node/TypeScript API service in later phases.
    const healthFn = new lambda.Function(this, 'HealthCheckFunction', {
      functionName: `lanewise-${config.envName}-health`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'health.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'health')),
      timeout: Duration.seconds(10),
      memorySize: 128,
      description: 'LaneWise health-check endpoint (skeleton).',
      environment: {
        LANEWISE_ENV: config.envName,
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
    health.addMethod('GET', new apigateway.LambdaIntegration(healthFn));

    this.apiUrl = api.url;

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Invoke URL of the LaneWise REST API.',
    });

    void removalPolicy; // reserved for stateful resources added in later phases
  }
}
