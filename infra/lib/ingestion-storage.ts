import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { EnvName } from '../config/environments';

/** Key prefix for raw uploaded ingestion files (browser → presigned PUT). */
export const INGESTION_UPLOADS_PREFIX = 'uploads/';
/** Key prefix for normalised, immutable snapshot data pinned by scenarios. */
export const INGESTION_SNAPSHOTS_PREFIX = 'snapshots/';
/** Raw uploads are kept for one year (design Q13). */
export const INGESTION_UPLOAD_RETENTION_DAYS = 365;

export interface IngestionStorageProps {
  /** Logical environment name (used for descriptions/tags only). */
  readonly envName: EnvName;
  /** Retain the bucket (and its data) on stack deletion — `config.retainData`. */
  readonly retainData: boolean;
  /**
   * The API function. It is granted least-privilege access to the bucket and
   * receives the bucket name in the `INGESTION_BUCKET` environment variable.
   * A concrete `lambda.Function` is required so the env var can be added.
   */
  readonly apiFunction: lambda.Function;
  /**
   * Browser origins allowed to PUT/GET via presigned URLs. Defaults to `['*']`,
   * matching the API's current permissive CORS; tighten to the CloudFront/SPA
   * origin once the domain is fixed. (Presigned URLs remain the access control.)
   */
  readonly allowedOrigins?: string[];
}

/**
 * Data-ingestion storage (task 9.1): a private S3 bucket for uploaded source
 * files and the normalised snapshots derived from them.
 *
 * - `uploads/`   — raw files uploaded by the browser via presigned PUT URLs
 *                  signed by the API. Expire after 365 days (design Q13).
 * - `snapshots/` — normalised, immutable snapshot data pinned by scenarios.
 *                  Never expired.
 *
 * The API function may only Put/Get objects under those two prefixes, and
 * list only under `uploads/` (so a missing upload is a 404). No delete.
 * PutObject on `uploads/*` is what lets it sign presigned
 * PUT URLs for the browser.
 */
export class IngestionStorage extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: IngestionStorageProps) {
    super(scope, id);

    const allowedOrigins = props.allowedOrigins ?? ['*'];

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: undefined, // let CloudFormation generate a unique name
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: props.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !props.retainData,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins,
          // What a browser sends on a presigned PUT: content-type (signed),
          // content-length/content-md5, and SDK checksum headers (x-amz-*).
          allowedHeaders: ['content-type', 'content-length', 'content-md5', 'x-amz-*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'ExpireRawUploads',
          prefix: INGESTION_UPLOADS_PREFIX,
          expiration: Duration.days(INGESTION_UPLOAD_RETENTION_DAYS),
        },
        {
          // Bucket-wide housekeeping; does not expire current snapshot objects.
          id: 'AbortIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
        {
          id: 'ExpireNoncurrentVersions',
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    const fn = props.apiFunction;
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IngestionObjectReadWrite',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [
          this.bucket.arnForObjects(`${INGESTION_UPLOADS_PREFIX}*`),
          this.bucket.arnForObjects(`${INGESTION_SNAPSHOTS_PREFIX}*`),
        ],
      }),
    );
    // Without ListBucket, S3 answers 403 instead of 404 for a missing key; the
    // API needs the 404 to tell "file not uploaded yet" from a real failure.
    // Limited to the uploads/ prefix.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IngestionListUploads',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': [`${INGESTION_UPLOADS_PREFIX}*`] } },
      }),
    );
    fn.addEnvironment('INGESTION_BUCKET', this.bucket.bucketName);
  }
}
