import { Aws, CfnOutput, CfnRule, Duration, Fn, RemovalPolicy, Stack, StackProps, Token } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
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
 *
 * With `config.domainName` + `config.hostedZone` set, the SPA is also served on
 * that custom domain: a DNS-validated ACM certificate (us-east-1, validated in
 * the imported hosted zone), the CloudFront alias, and Route 53 A/AAAA alias
 * records. The default CloudFront domain keeps working.
 */
export class SpaHostingStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  /** Custom-domain certificate (undefined without `config.domainName`). */
  public readonly certificate?: acm.Certificate;
  /** Every HTTPS origin the SPA is served from (custom domain first, then CloudFront). */
  public readonly spaOrigins: string[];

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

    const { domainName, hostedZone } = config;
    let zone: route53.IHostedZone | undefined;
    if (domainName !== undefined && hostedZone === undefined) {
      throw new Error(`domainName ${domainName} needs config.hostedZone.`);
    }
    if (domainName !== undefined && hostedZone !== undefined) {
      // CloudFront only accepts certificates from us-east-1.
      if (!Token.isUnresolved(this.region) && this.region !== 'us-east-1') {
        throw new Error(`The SPA custom domain needs its certificate in us-east-1; this stack targets ${this.region}.`);
      }
      // Environment-agnostic synth: fail the deploy before any change elsewhere.
      new CfnRule(this, 'CertificateRegionRule', {
        assertions: [
          {
            assert: Fn.conditionEquals(Aws.REGION, 'us-east-1'),
            assertDescription: 'The SPA custom-domain certificate (CloudFront) must be deployed in us-east-1.',
          },
        ],
      });
      zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: hostedZone.id,
        zoneName: hostedZone.name,
      });
      this.certificate = new acm.Certificate(this, 'SpaCertificate', {
        domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    this.distribution = new cloudfront.Distribution(this, 'SpaDistribution', {
      comment: `LaneWise SPA (${config.envName}).`,
      ...(this.certificate && domainName ? { domainNames: [domainName], certificate: this.certificate } : {}),
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

    if (zone && domainName) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
      new route53.ARecord(this, 'SpaAliasA', { zone, recordName: domainName, target });
      new route53.AaaaRecord(this, 'SpaAliasAaaa', { zone, recordName: domainName, target });
    }

    this.spaOrigins = [
      ...(domainName ? [`https://${domainName}`] : []),
      `https://${this.distribution.distributionDomainName}`,
    ];

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
    new CfnOutput(this, 'SpaUrl', {
      value: this.spaOrigins[0] as string,
      description: 'Primary URL of the SPA (custom domain when configured).',
    });
  }
}
