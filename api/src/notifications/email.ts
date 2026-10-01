/**
 * Notification email: the sender port, its Amazon SES (SESv2) adapter and
 * the per-language templates (task 19; requirement 20.2, 20.5).
 *
 * The dispatcher depends only on `EmailSender`, so tests inject a fake and
 * production uses `createSesSender` (From `SES_FROM_ADDRESS` in `SES_REGION`,
 * set by infra/lib/notifications.ts; the API role may only send from the
 * verified `1cloudhub.com` identity).
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { notificationLink, type Language, type NotificationSeverity } from '@lanewise/shared';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface SesSenderConfig {
  readonly region: string;
  readonly from: string;
}

export function createSesSender(config: SesSenderConfig, client = new SESv2Client({ region: config.region })): EmailSender {
  return {
    async send(message) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: config.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: message.text, Charset: 'UTF-8' },
                Html: { Data: message.html, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface EmailNotification {
  readonly event: string;
  readonly severity: NotificationSeverity;
  readonly objectType: string;
  readonly objectId: string;
  readonly objectName: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly synthetic: boolean;
}

export interface EmailRecipient {
  readonly email: string;
  readonly name: string;
  readonly language: Language;
}

type Params = Readonly<Record<string, unknown>>;
type Line = (name: string, p: Params) => string;

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

const DATE_LOCALE: Record<Language, string> = { en: 'en-PH', fil: 'fil-PH' };

function when(value: unknown, lang: Language): string {
  if (typeof value !== 'string') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(DATE_LOCALE[lang], {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface Copy {
  readonly subjects: Readonly<Record<string, Line>>;
  readonly fallback: Line;
  readonly step: Readonly<Record<string, string>>;
  readonly decision: Readonly<Record<string, string>>;
  readonly outcome: Readonly<Record<string, string>>;
  readonly greeting: (name: string) => string;
  readonly open: string;
  readonly footer: string;
  readonly demo: string;
}

const EN: Copy = {
  subjects: {
    'approval.headcount_requested': (n) => `Headcount approval requested — ${n}`,
    'approval.budget_requested': (n) => `Budget approval requested — ${n}`,
    'approval.secured': (n, p) => `${EN.step[text(p.step)] ?? 'Step'} secured — ${n}`,
    'approval.plan_ready': (n) => `Plan ready for your approval — ${n}`,
    'approval.decided': (n, p) => `${EN.step[text(p.step)] ?? 'Step'} ${EN.decision[text(p.decision)] ?? 'decided'} — ${n}`,
    'scenario.paused': (n) => `Approval paused: scenario is stale — ${n}`,
    'scenario.published': (n) => `Plan published — ${n}`,
    'plan.lane_capacity_exceeded': (n) => `Lane capacity exceeded in the published plan — ${n}`,
    'hiring.milestone_due': (n) => `Hiring milestone due within 7 days — ${n}`,
    'hiring.milestone_overdue': (n) => `Hiring milestone overdue — ${n}`,
    'scenario.stale': (n) => `Scenario is stale: recalculate — ${n}`,
    'scenario_run.completed': (n) => `Run complete — ${n}`,
    'scenario_run.failed': (n) => `Run failed — ${n}`,
    'roster.published': () => 'Your roster is published',
    'shift.changed': () => 'Your shift changed',
    'roster.unfilled_shifts': (n) => `Unfilled shifts in the published roster — ${n}`,
    'roster.override_rule_breach': () => 'Roster change overrides a labor rule',
    'offer.sent': (_n, p) => `Open shift offered at ${text(p.storeName)}`,
    'offer.resolved': (_n, p) => `Offer ${EN.outcome[text(p.outcome)] ?? 'updated'} — ${text(p.storeName)}`,
    'borrow.requested': (_n, p) => `Request to borrow cashiers from ${text(p.fromStore)}`,
    'borrow.decided': (_n, p) => `Borrow request ${EN.outcome[text(p.outcome)] ?? 'decided'} — ${text(p.fromStore)}`,
    'ingestion.succeeded': (n) => `Data load succeeded — ${n}`,
    'ingestion.failed': (n) => `Data load failed — ${n}`,
    'rule_version.published': (n) => `Rule version published — ${n}`,
    'passkey.added': () => 'A new passkey was added to your account',
  },
  fallback: (n) => `LaneWise notification — ${n}`,
  step: { headcount: 'Headcount', budget: 'Budget', plan: 'Plan' },
  decision: { approved: 'approved', changes_requested: 'sent back for changes', rejected: 'rejected' },
  outcome: { accepted: 'accepted', declined: 'declined', expired: 'expired', approved: 'approved', overridden: 'overridden' },
  greeting: (name) => `Hi ${name},`,
  open: 'Open in LaneWise',
  footer: 'You get this email because of your LaneWise notification preferences. Change them under Notifications › Preferences.',
  demo: 'Demo data — figures are simulated, not SM actuals.',
};

const FIL: Copy = {
  subjects: {
    'approval.headcount_requested': (n) => `Hinihingi ang pag-apruba ng headcount — ${n}`,
    'approval.budget_requested': (n) => `Hinihingi ang pag-apruba ng budget — ${n}`,
    'approval.secured': (n, p) => `Na-secure na ang ${FIL.step[text(p.step)] ?? 'hakbang'} — ${n}`,
    'approval.plan_ready': (n) => `Handa na ang plano para sa iyong pag-apruba — ${n}`,
    'approval.decided': (n, p) => `${FIL.step[text(p.step)] ?? 'Hakbang'}: ${FIL.decision[text(p.decision)] ?? 'napagpasyahan'} — ${n}`,
    'scenario.paused': (n) => `Naka-pause ang pag-apruba: luma na ang scenario — ${n}`,
    'scenario.published': (n) => `Nai-publish ang plano — ${n}`,
    'plan.lane_capacity_exceeded': (n) => `Lumampas sa kapasidad ng lane ang nai-publish na plano — ${n}`,
    'hiring.milestone_due': (n) => `Hiring milestone sa loob ng 7 araw — ${n}`,
    'hiring.milestone_overdue': (n) => `Lampas na sa takdang petsa ang hiring milestone — ${n}`,
    'scenario.stale': (n) => `Luma na ang scenario: i-recalculate — ${n}`,
    'scenario_run.completed': (n) => `Tapos na ang run — ${n}`,
    'scenario_run.failed': (n) => `Pumalya ang run — ${n}`,
    'roster.published': () => 'Nai-publish na ang iyong roster',
    'shift.changed': () => 'Nagbago ang iyong shift',
    'roster.unfilled_shifts': (n) => `May mga shift na walang naka-assign sa nai-publish na roster — ${n}`,
    'roster.override_rule_breach': () => 'Lumalabag sa labor rule ang pagbabago sa roster',
    'offer.sent': (_n, p) => `May alok na bukas na shift sa ${text(p.storeName)}`,
    'offer.resolved': (_n, p) => `Ang alok ay ${FIL.outcome[text(p.outcome)] ?? 'na-update'} — ${text(p.storeName)}`,
    'borrow.requested': (_n, p) => `Hiling na humiram ng cashier mula sa ${text(p.fromStore)}`,
    'borrow.decided': (_n, p) => `Ang hiling na manghiram ay ${FIL.outcome[text(p.outcome)] ?? 'napagpasyahan'} — ${text(p.fromStore)}`,
    'ingestion.succeeded': (n) => `Matagumpay ang pag-load ng data — ${n}`,
    'ingestion.failed': (n) => `Pumalya ang pag-load ng data — ${n}`,
    'rule_version.published': (n) => `Nai-publish ang bersyon ng rule — ${n}`,
    'passkey.added': () => 'May bagong passkey na idinagdag sa iyong account',
  },
  fallback: (n) => `Abiso mula sa LaneWise — ${n}`,
  step: { headcount: 'Headcount', budget: 'Budget', plan: 'Plano' },
  decision: { approved: 'inaprubahan', changes_requested: 'ibinalik para baguhin', rejected: 'tinanggihan' },
  outcome: { accepted: 'tinanggap', declined: 'tinanggihan', expired: 'nag-expire', approved: 'inaprubahan', overridden: 'na-override' },
  greeting: (name) => `Kumusta ${name},`,
  open: 'Buksan sa LaneWise',
  footer: 'Natanggap mo ang email na ito dahil sa iyong mga setting ng abiso sa LaneWise. Baguhin ang mga ito sa Mga Abiso › Mga Kagustuhan.',
  demo: 'Demo data — kunwaring mga numero, hindi aktuwal na datos ng SM.',
};

export const EMAIL_COPY: Readonly<Record<Language, Copy>> = { en: EN, fil: FIL };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function subjectFor(n: EmailNotification, lang: Language): string {
  const copy = EMAIL_COPY[lang];
  const name = n.objectName ?? text(n.params.name);
  const line = copy.subjects[n.event] ?? copy.fallback;
  const subject = line(name, n.params).replace(/\s+—\s*$/, '').trim();
  return n.event === 'shift.changed' && typeof n.params.startsAt === 'string'
    ? `${subject} — ${when(n.params.startsAt, lang)}`
    : subject;
}

/**
 * Renders a notification email in the recipient's language (requirement
 * 20.5) with a deep link to the object (20.6). The body carries no figures
 * beyond the notification's own parameters (no ₱ amounts), so it never shows
 * a recipient more than the in-app notification does.
 */
export function renderEmail(n: EmailNotification, to: EmailRecipient, appBaseUrl: string): EmailMessage {
  const copy = EMAIL_COPY[to.language];
  const subject = subjectFor(n, to.language);
  const link = `${appBaseUrl.replace(/\/+$/, '')}${notificationLink(n)}`;
  const lines = [copy.greeting(to.name), '', subject, '', `${copy.open}: ${link}`];
  if (n.synthetic) lines.push('', copy.demo);
  lines.push('', '—', copy.footer);
  const html = [
    `<p>${escapeHtml(copy.greeting(to.name))}</p>`,
    `<p><strong>${escapeHtml(subject)}</strong></p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(copy.open)}</a></p>`,
    n.synthetic ? `<p>${escapeHtml(copy.demo)}</p>` : '',
    `<p style="color:#555">${escapeHtml(copy.footer)}</p>`,
  ].join('');
  return { to: to.email, subject: `LaneWise: ${subject}`, text: lines.join('\n'), html };
}
