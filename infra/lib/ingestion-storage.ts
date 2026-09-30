import { Duration } from 'aws-cdk-lib';
import type * as s3 from 'aws-cdk-lib/aws-s3';

/**
 * Data-ingestion storage layout (task 9.1) for the uploads bucket owned by
 * the DataStack (task 24):
 *
 * - `uploads/`   — raw files the browser PUTs through presigned URLs signed
 *                  by the API. Kept `uploadRetentionDays` (design Q13: 1 year).
 * - `snapshots/` — normalised, immutable snapshot data. Scenarios and runs pin
 *                  snapshots (P6), so these objects are never expired.
 *
 * The API reads the bucket name from `UPLOADS_BUCKET` (bin/infra.ts).
 */
export const INGESTION_UPLOADS_PREFIX = 'uploads/';
export const INGESTION_SNAPSHOTS_PREFIX = 'snapshots/';

/**
 * Lifecycle rules for the uploads bucket: only raw uploads expire; pinned
 * snapshot data is kept. Incomplete multipart uploads are aborted after a day.
 * Noncurrent versions of raw uploads expire after 30 days.
 */
export function ingestionLifecycleRules(uploadRetentionDays: number): s3.LifecycleRule[] {
  return [
    { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
    {
      id: 'expire-uploads',
      prefix: INGESTION_UPLOADS_PREFIX,
      expiration: Duration.days(uploadRetentionDays),
      noncurrentVersionExpiration: Duration.days(30),
    },
  ];
}
