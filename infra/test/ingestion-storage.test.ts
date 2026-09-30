import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../config/environments';
import { DataStack } from '../lib/data-stack';
import { INGESTION_SNAPSHOTS_PREFIX, INGESTION_UPLOADS_PREFIX, ingestionLifecycleRules } from '../lib/ingestion-storage';

type Rule = { Id?: string; Prefix?: string; Status: string; ExpirationInDays?: number; NoncurrentVersionExpiration?: unknown };

function uploadsBucketRules(): Rule[] {
  const app = new App();
  const data = new DataStack(app, 'Test-Data-Ingestion', {
    config: resolveEnvironment('prod'),
    uploadCorsOrigins: ['https://example.cloudfront.net'],
  });
  const template = Template.fromStack(data);
  const logicalId = data.getLogicalId(data.uploadsBucket.node.defaultChild as never);
  const bucket = template.toJSON().Resources[logicalId] as { Properties: { LifecycleConfiguration: { Rules: Rule[] } } };
  return bucket.Properties.LifecycleConfiguration.Rules;
}

describe('ingestion storage layout on the uploads bucket (task 9.1)', () => {
  it('uses uploads/ for raw files and snapshots/ for pinned snapshot data', () => {
    expect(INGESTION_UPLOADS_PREFIX).toBe('uploads/');
    expect(INGESTION_SNAPSHOTS_PREFIX).toBe('snapshots/');
  });

  it('expires only raw uploads, after the configured retention (Q13: 365 days in prod)', () => {
    const rules = uploadsBucketRules();
    const expiring = rules.filter((r) => r.ExpirationInDays !== undefined || r.NoncurrentVersionExpiration !== undefined);
    expect(expiring).toHaveLength(1);
    expect(expiring[0]).toMatchObject({ Id: 'expire-uploads', Prefix: 'uploads/', ExpirationInDays: 365, Status: 'Enabled' });
  });

  it('never expires snapshots/ data, which scenarios pin (P6)', () => {
    for (const rule of uploadsBucketRules()) {
      const expires = rule.ExpirationInDays !== undefined || rule.NoncurrentVersionExpiration !== undefined;
      if (expires) expect(rule.Prefix).toBe(INGESTION_UPLOADS_PREFIX);
    }
  });

  it('builds the rules from the retention setting', () => {
    const rules = ingestionLifecycleRules(30);
    expect(rules.find((r) => r.id === 'expire-uploads')).toMatchObject({ prefix: 'uploads/' });
    expect(rules.find((r) => r.id === 'expire-uploads')?.expiration?.toDays()).toBe(30);
  });
});
