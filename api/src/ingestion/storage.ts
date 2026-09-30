/**
 * Object storage for ingestion (task 9.1): raw uploads under `uploads/`
 * (written by the browser through a presigned PUT URL, kept 1 year — Q13) and
 * normalised, immutable snapshot data under `snapshots/` (pinned by
 * scenarios). The bucket is `INGESTION_BUCKET` (infra/lib/ingestion-storage.ts).
 */
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { errors } from '../http/errors.js';

export interface PresignedPut {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface StoredText {
  readonly text: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface IngestionStorage {
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<PresignedPut>;
  /** Reads a UTF-8 object; `null` when it does not exist. Throws 413 above `maxBytes`. */
  getText(key: string, maxBytes: number): Promise<StoredText | null>;
  /** Writes an object that must not already exist (snapshot data is immutable). */
  putText(key: string, body: string, contentType: string): Promise<{ readonly sha256: string }>;
}

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** Upload keys: `uploads/<type>/<uuid>/<safe file name>`. */
export function uploadKey(datasetType: string, id: string, fileName: string): string {
  const safe = fileName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-100);
  return `uploads/${datasetType}/${id}/${safe.length > 0 ? safe : 'upload.csv'}`;
}

const UPLOAD_KEY = /^uploads\/(pos|master|staff)\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/;

/** Whether `key` is an upload key for `datasetType` (never a snapshot or other object). */
export function isUploadKeyFor(key: string, datasetType: string): boolean {
  return UPLOAD_KEY.test(key) && key.startsWith(`uploads/${datasetType}/`);
}

export function snapshotDataKey(datasetType: string, runId: string): string {
  return `snapshots/${datasetType}/run-${runId}.json`;
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export function createS3Storage(bucket: string, config: S3ClientConfig = {}): IngestionStorage {
  // WHEN_REQUIRED: don't add CRC checksums to presigned PUT URLs, which a
  // browser upload could not satisfy.
  const client = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED', ...config });
  return {
    async presignPut(key, contentType, expiresInSeconds) {
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
      const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
      return { url, headers: { 'Content-Type': contentType } };
    },
    async getText(key, maxBytes) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if ((out.ContentLength ?? 0) > maxBytes) throw errors.payloadTooLarge('The uploaded file is too large.');
        const bytes = (await out.Body?.transformToByteArray()) ?? new Uint8Array();
        if (bytes.byteLength > maxBytes) throw errors.payloadTooLarge('The uploaded file is too large.');
        return { text: new TextDecoder('utf-8').decode(bytes), sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async putText(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' }),
      );
      return { sha256: sha256Hex(body) };
    },
  };
}
