import { Aws, CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'node:path';
import type { EnvironmentConfig } from '../config/environments';

/** Content the Atrium portal serves to signed-in users, keyed by the id the SPA asks for. */
export const ATRIUM_CONTENT: Readonly<Record<string, string>> = {
  proposal: 'content/sm-atrium-proposal.html',
  exec: 'content/sm-atrium-exec-summary.html',
};

export const ATRIUM_CONTENT_HANDLER_DIR = path.join(__dirname, '..', 'lambda', 'atrium-content');

export interface AtriumStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /** LaneWise's user pool: Atrium signs users in against the same pool. */
  readonly userPool: cognito.IUserPool;
  /**
   * LaneWise's SPA app client. Atrium uses the same client so its tokens can
   * be handed to LaneWise (one sign-in for both apps).
   */
  readonly userPoolClient: cognito.IUserPoolClient;
}

/**
 * SM Atrium demo portal: the "front door" concept from the SM Retail proposal.
 *
 *  - SPA hosting: private S3 bucket behind CloudFront (OAC), SPA fallback, and
 *    the optional `atrium.*` custom domain (ACM in us-east-1 + Route 53 alias),
 *    mirroring SpaHostingStack.
 *  - Content: a private S3 bucket holding the proposal decks. They are never
 *    public and never in git; `scripts/atrium-publish-content.sh` uploads them.
 *  - Content API: HTTP API with a Cognito JWT authorizer (LaneWise's pool and
 *    app client) in front of a small Lambda that returns a deck's HTML to a
 *    signed-in user. The SPA renders it in a sandboxed frame.
 */
export class AtriumStack extends Stack {
  public readonly spaBucket: s3.Bucket;
  public readonly contentBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly httpApi: apigwv2.HttpApi;
  /** Every HTTPS origin the Atrium SPA is served from (custom domain first). */
  public readonly origins: string[];

  constructor(scope: Construct, id: string, props: AtriumStackProps) {
    super(scope, id, props);

    const { config } = props;
    const atrium = config.atrium;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.spaBucket = new s3.Bucket(this, 'AtriumSpaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.contentBucket = new s3.Bucket(this, 'AtriumContentBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !config.retainData,
    });

    // Custom domain only once its hosted zone exists (see infra/README.md › Atrium).
    const domainName = atrium?.hostedZone ? atrium.domainName : undefined;
    let zone: route53.IHostedZone | undefined;
    let certificate: acm.Certificate | undefined;
    if (domainName && atrium?.hostedZone) {
      zone = route53.HostedZone.fromHostedZoneAttributes(this, 'AtriumZone', {
        hostedZoneId: atrium.hostedZone.id,
        zoneName: atrium.hostedZone.name,
      });
      // CloudFront only accepts us-east-1 certificates; the LaneWise app is
      // deployed there already (SpaHostingStack enforces the same).
      certificate = new acm.Certificate(this, 'AtriumCertificate', {
        domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'AtriumSecurityHeaders', {
      comment: `SM Atrium security headers (${config.envName}).`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'AtriumDistribution', {
      comment: `SM Atrium portal (${config.envName}).`,
      ...(certificate && domainName ? { domainNames: [domainName], certificate } : {}),
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.spaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(5) },
      ],
    });

    if (zone && domainName) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
      new route53.ARecord(this, 'AtriumAliasA', { zone, recordName: domainName, target });
      new route53.AaaaRecord(this, 'AtriumAliasAaaa', { zone, recordName: domainName, target });
    }

    this.origins = [
      ...(domainName ? [`https://${domainName}`] : []),
      `https://${this.distribution.distributionDomainName}`,
    ];

    const handlerLogs = new logs.LogGroup(this, 'AtriumContentLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy,
    });

    const handler = new lambda.Function(this, 'AtriumContentFunction', {
      functionName: `lanewise-${config.envName}-atrium-content`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(ATRIUM_CONTENT_HANDLER_DIR),
      timeout: Duration.seconds(10),
      memorySize: 256,
      description: 'SM Atrium: returns a proposal deck to a signed-in user.',
      logGroup: handlerLogs,
      environment: {
        CONTENT_BUCKET: this.contentBucket.bucketName,
        CONTENT_KEYS: JSON.stringify(ATRIUM_CONTENT),
      },
    });
    this.contentBucket.grantRead(handler, 'content/*');

    const authorizer = new HttpJwtAuthorizer(
      'AtriumJwtAuthorizer',
      `https://cognito-idp.${Aws.REGION}.amazonaws.com/${props.userPool.userPoolId}`,
      { jwtAudience: [props.userPoolClient.userPoolClientId] },
    );

    this.httpApi = new apigwv2.HttpApi(this, 'AtriumApi', {
      apiName: `lanewise-${config.envName}-atrium`,
      description: 'SM Atrium content API (Cognito JWT).',
      corsPreflight: {
        allowOrigins: this.origins,
        allowMethods: [apigwv2.CorsHttpMethod.GET],
        allowHeaders: ['authorization'],
        maxAge: Duration.hours(1),
      },
    });
    this.httpApi.addRoutes({
      path: '/content/{id}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('AtriumContentIntegration', handler),
      authorizer,
    });

    new CfnOutput(this, 'AtriumSpaBucketName', { value: this.spaBucket.bucketName, description: 'S3 bucket holding the built Atrium SPA.' });
    new CfnOutput(this, 'AtriumDistributionId', { value: this.distribution.distributionId, description: 'Atrium CloudFront distribution id.' });
    new CfnOutput(this, 'AtriumUrl', { value: this.origins[0] as string, description: 'Primary URL of the Atrium portal.' });
    new CfnOutput(this, 'AtriumOrigins', {
      value: Fn.join(',', this.origins),
      description: 'Every Atrium origin; LaneWise accepts a session handoff only from these.',
    });
    new CfnOutput(this, 'AtriumContentBucketName', {
      value: this.contentBucket.bucketName,
      description: 'Private S3 bucket for the proposal decks (scripts/atrium-publish-content.sh).',
    });
    new CfnOutput(this, 'AtriumApiUrl', { value: this.httpApi.apiEndpoint, description: 'Atrium content API base URL.' });
  }
}
