import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface SpaHostingStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * SPA hosting tier: Amazon S3 (private) + Amazon CloudFront, per ADR-0004 / DEP-003.
 *
 * The React SPA (built to `frontend/dist`) is served from a private S3 bucket
 * reached only through CloudFront via Origin Access Control (OAC). SPA client
 * routing is supported by rewriting 403/404 to `index.html`. The bucket is left
 * empty by this stack; the pipeline (tasks 3.4/3.5) uploads the built SPA and
 * invalidates the distribution on deploy.
 */
export class SpaHostingStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SpaHostingStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.bucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: undefined, // let CloudFormation generate a unique name
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.retainData,
      removalPolicy,
      autoDeleteObjects: !config.retainData,
    });

    this.distribution = new cloudfront.Distribution(this, 'SpaDistribution', {
      comment: `LaneWise SPA (${config.envName}).`,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        // S3BucketOrigin with OAC keeps the bucket private (no public ACLs).
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      // SPA fallback: client-side routing serves index.html for unknown paths.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
    });

    new CfnOutput(this, 'SpaBucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket holding the built SPA assets.',
    });
    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution id (for cache invalidation on deploy).',
    });
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'Public CloudFront domain serving the SPA.',
    });
  }
}
