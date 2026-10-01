/** In-memory IngestionStorage for route tests (no S3). */
import { sha256Hex, type IngestionStorage } from '../../src/ingestion/storage.js';

export class MemoryStorage implements IngestionStorage {
  readonly objects = new Map<string, string>();
  readonly presigned: { key: string; contentType: string; expiresInSeconds: number }[] = [];

  presignPut(key: string, contentType: string, expiresInSeconds: number) {
    this.presigned.push({ key, contentType, expiresInSeconds });
    return Promise.resolve({
      url: `https://bucket.example/${key}?X-Amz-Signature=test`,
      headers: { 'Content-Type': contentType },
    });
  }

  getText(key: string) {
    const text = this.objects.get(key);
    if (text === undefined) return Promise.resolve(null);
    return Promise.resolve({ text, sizeBytes: Buffer.byteLength(text), sha256: sha256Hex(text) });
  }

  putText(key: string, body: string) {
    if (this.objects.has(key)) return Promise.reject(new Error(`object exists: ${key}`));
    this.objects.set(key, body);
    return Promise.resolve({ sha256: sha256Hex(body) });
  }
}
