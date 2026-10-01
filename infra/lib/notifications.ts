import { Arn, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { NotificationsConfig } from '../config/environments';

/**
 * Function environment for the notifications service (task 19). `SES_REGION`
 * is the identity's region, which can differ from the function's own region
 * (prod: functions in us-east-2, SES in us-east-1).
 */
export function sesEnvironment(_scope: Stack, config: NotificationsConfig): Record<string, string> {
  return {
    SES_FROM_ADDRESS: config.fromAddress,
    SES_REGION: config.sesRegion,
  };
}

/**
 * Lets `grantee` send email through Amazon SES (task 24 for task 19) — only
 * from the verified `config.sesIdentity` domain identity, and only with a From
 * address inside that domain. The identity itself is verified outside CDK
 * (manual step, see infra/README.md), so it is referenced, not created — by
 * its ARN in `config.sesRegion`, not the stack's region.
 */
export function grantSesSend(scope: Stack, grantee: iam.IGrantable, config: NotificationsConfig): iam.Grant {
  const identityArn = Arn.format(
    {
      service: 'ses',
      region: config.sesRegion,
      resource: 'identity',
      resourceName: config.sesIdentity,
    },
    scope,
  );
  return iam.Grant.addToPrincipal({
    grantee,
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resourceArns: [identityArn],
    conditions: { StringLike: { 'ses:FromAddress': `*@${config.sesIdentity}` } },
  });
}
