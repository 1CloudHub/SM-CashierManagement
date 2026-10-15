// SM Atrium content handler: returns one proposal deck (HTML) to a signed-in user.
// API Gateway's Cognito JWT authorizer has already verified the caller; this
// only maps the requested id to its S3 key and streams the object back.
import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.CONTENT_BUCKET;
const KEYS = JSON.parse(process.env.CONTENT_KEYS ?? '{}');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export async function handler(event) {
  const id = event?.pathParameters?.id;
  const key = typeof id === 'string' && Object.hasOwn(KEYS, id) ? KEYS[id] : undefined;
  if (!key) return json(404, { error: 'unknown_content' });
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await obj.Body.transformToString('utf-8');
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body,
    };
  } catch (err) {
    if (err instanceof NoSuchKey || err?.name === 'NoSuchKey') return json(404, { error: 'not_published' });
    console.error('atrium-content: read failed', { id, name: err?.name });
    return json(500, { error: 'read_failed' });
  }
}
