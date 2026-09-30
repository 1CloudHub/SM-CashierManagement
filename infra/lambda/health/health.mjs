/**
 * LaneWise health-check handler (skeleton).
 *
 * Returns a small JSON payload so the walking-skeleton SPA (task 3.5) can prove
 * the CloudFront -> API Gateway -> Lambda path end to end. Replaced by the real
 * Node/TypeScript API service in later phases.
 */
export const handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      status: 'ok',
      service: 'lanewise-api',
      env: process.env.LANEWISE_ENV ?? 'unknown',
      time: new Date().toISOString(),
    }),
  };
};
