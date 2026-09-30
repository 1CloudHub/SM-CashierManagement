/**
 * Cognito pre-sign-up trigger — the server-side email-domain allowlist
 * (requirement 1.1, 1.2, 1.7; property P13).
 *
 * Cognito invokes this Lambda before it creates ANY user in the pool: self
 * sign-up (`PreSignUp_SignUp`), administrator creation
 * (`PreSignUp_AdminCreateUser`) and federated first sign-in
 * (`PreSignUp_ExternalProvider`). Throwing aborts the creation and Cognito
 * returns the error message to the caller, so no account can ever exist with
 * an email outside smretail.com / 1cloudhub.com. The pool additionally makes
 * `email` immutable (infra/lib/auth-stack.ts), so an allowed address cannot be
 * swapped for another one after sign-up.
 *
 * Self sign-up is a demo-mode switch (requirement 1.7): when
 * `SELF_SIGN_UP_ENABLED` is not `"true"`, the trigger also refuses
 * `PreSignUp_SignUp` even if the pool setting were ever flipped by mistake.
 *
 * The trigger never auto-confirms users or auto-verifies email: the address is
 * proven by the one-time code (requirement 1.4).
 */
import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { DOMAIN_NOT_ALLOWED_MESSAGE, emailDomain, isAllowedEmail } from '@lanewise/shared';
import { createLogger, type Logger } from '../logger.js';

/** Message returned when self sign-up is switched off (non-demo mode). */
export const SELF_SIGN_UP_DISABLED_MESSAGE = 'Self sign-up is not enabled. Ask an administrator for an invitation.';

export interface PreSignUpOptions {
  readonly selfSignUpEnabled?: boolean;
  readonly logger?: Logger;
}

export type PreSignUpHandler = (event: PreSignUpTriggerEvent) => Promise<PreSignUpTriggerEvent>;

export function createPreSignUpHandler(options: PreSignUpOptions = {}): PreSignUpHandler {
  const selfSignUpEnabled = options.selfSignUpEnabled ?? process.env.SELF_SIGN_UP_ENABLED === 'true';
  const logger =
    options.logger ??
    createLogger({ base: { service: 'lanewise-pre-sign-up', env: process.env.LANEWISE_ENV ?? 'unknown' } });

  return async (event) => {
    const email = event.request?.userAttributes?.email;
    const trigger = event.triggerSource;

    if (!isAllowedEmail(email)) {
      // Log the domain only — never the full address (PII).
      logger.warn('sign-up rejected: domain not allowed', { trigger, domain: emailDomain(email) ?? 'malformed' });
      throw new Error(DOMAIN_NOT_ALLOWED_MESSAGE);
    }

    if (trigger === 'PreSignUp_SignUp' && !selfSignUpEnabled) {
      logger.warn('sign-up rejected: self sign-up disabled', { trigger });
      throw new Error(SELF_SIGN_UP_DISABLED_MESSAGE);
    }

    event.response = { ...event.response, autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false };
    logger.info('sign-up allowed', { trigger, domain: emailDomain(email) });
    return event;
  };
}

/** Lambda handler (`index.handler` in dist/pre-sign-up). */
export const handler: PreSignUpHandler = createPreSignUpHandler();
