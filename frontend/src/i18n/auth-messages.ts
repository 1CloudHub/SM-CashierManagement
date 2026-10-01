/**
 * Sign-in, first sign-in, passkey and session-timeout copy (task 7 —
 * requirement 1, SCR-001 / SCR-002 / SCR-080). Merged into the en/fil bundles
 * in ./resources; kept in its own module so the auth feature's copy is easy
 * to review as a unit. Same voice rules as ./resources (UX-003).
 */
import type { Bundle } from './types'

export const authEn: Bundle = {
  // ── Brand / shared ──────────────────────────────────────────────────────
  'auth.brand.name': 'LaneWise',
  'auth.brand.byline': 'by SM Retail',
  'auth.email.label': 'Work email',
  'auth.email.placeholder': 'juan@smretail.com',
  'auth.email.invalid': 'Enter your work email, like juan@smretail.com.',
  // Verbatim from requirement 1.1 (= DOMAIN_NOT_ALLOWED_MESSAGE in @lanewise/shared).
  'auth.domainNotAllowed.title': "This work email domain isn't allowed.",
  'auth.domainNotAllowed.description':
    'Use an @smretail.com or @1cloudhub.com address.',
  'auth.working': 'Working…',

  // ── SCR-001 Sign in ─────────────────────────────────────────────────────
  'auth.signIn.pageTitle': 'Sign in — LaneWise',
  'auth.signIn.title': 'Sign in to LaneWise',
  'auth.signIn.submit': 'Sign in with a passkey',
  'auth.signIn.setUp': 'New here, or no passkey on this device? Set one up',
  'auth.signIn.footnote':
    'Only smretail.com and 1cloudhub.com accounts. No passwords — you sign in with Face ID, fingerprint or your device PIN.',
  'auth.signIn.passkeyFailed.title':
    'The passkey prompt was cancelled or didn’t work.',
  'auth.signIn.passkeyFailed.description':
    'Try again, or set up a passkey on this device with an email code.',
  'auth.signIn.useEmailCode': 'Use an email code',
  'auth.signIn.noPasskey.title': 'There’s no passkey for this account yet.',
  'auth.signIn.noPasskey.description':
    'Set one up on this device with a code sent to your work email.',
  'auth.signIn.expired.title':
    'You were signed out after 60 minutes of inactivity.',
  'auth.signIn.expired.description':
    'Sign in again to go back to the page you were on.',
  'auth.signIn.signedOut': 'You’re signed out.',
  'auth.unsupported.title': 'This browser doesn’t support passkeys.',
  'auth.unsupported.description':
    'Use a current version of Chrome, Edge, Safari or Firefox on a computer or phone with Face ID, a fingerprint reader, Windows Hello or a device PIN.',
  'auth.unavailable.title': 'Sign-in isn’t available right now.',
  'auth.unavailable.description':
    'Try again in a moment. If it keeps happening, contact IT support.',

  // ── SCR-002 First sign-in / new device ──────────────────────────────────
  'auth.first.pageTitle': 'Set up your passkey — LaneWise',
  'auth.first.title': 'Set up your passkey',
  'auth.first.stepsLabel': 'Setup steps',
  'auth.first.stepOf': 'Step {step} of {total}',
  'auth.first.step1': 'Verify email',
  'auth.first.step2': 'Create passkey',
  'auth.first.step3': 'Get started',
  'auth.first.stepDone': 'completed',
  'auth.first.sendCode': 'Send code',
  'auth.first.verifyTitle': 'Verify your email',
  'auth.first.emailIntro':
    'We’ll send a 6-digit code to your work email. It’s only used to set up a passkey on this device.',
  'auth.first.codeSent': 'We sent a 6-digit code to {email}.',
  'auth.first.codeLabel': 'Code',
  'auth.first.codeHint': '6 digits, from the email we just sent.',
  'auth.first.codeInvalid': 'Enter the 6-digit code.',
  'auth.first.codeMismatch': 'That code isn’t right. Check the email and try again.',
  'auth.first.codeExpired': 'That code has expired. Send a new one.',
  'auth.first.tooManyAttempts': 'Too many attempts. Wait a few minutes, then send a new code.',
  'auth.first.verify': 'Verify code',
  'auth.first.resend': 'Resend code',
  'auth.first.resent': 'We sent a new code.',
  'auth.first.useDifferentEmail': 'Use a different email',
  'auth.first.createTitle': 'Create a passkey',
  'auth.first.createIntro':
    'Your device will ask for Face ID, fingerprint or PIN. You’ll use this passkey to sign in from now on.',
  'auth.first.create': 'Create passkey',
  'auth.first.createFailed.title': 'The passkey wasn’t created.',
  'auth.first.createFailed.description':
    'The device prompt was cancelled or didn’t work. Try again.',
  'auth.first.created': 'Passkey created.',
  'auth.first.startTitle': 'Get started',
  'auth.first.startAs': 'Start as (demo mode — switch any time)',
  'auth.first.notifications': 'Notifications',
  'auth.first.notifyInApp': 'In-app',
  'auth.first.notifyEmail': 'Email for approvals and shift changes',
  'auth.first.continue': 'Continue',

  // ── Roles (demo start role) ─────────────────────────────────────────────
  'role.ADM': 'System Admin',
  'role.EXE': 'Executive',
  'role.PLN': 'Planner',
  'role.STM': 'Store Manager',
  'role.HR': 'HR',
  'role.FIN': 'Finance',
  'role.RST': 'Rules Steward',
  'role.STF': 'Staff',

  // ── SCR-080 Profile › Passkeys ──────────────────────────────────────────
  'profile.title': 'Profile and preferences',
  'profile.signedInAs': 'Signed in as {email}',
  'profile.summary.title': 'Profile',
  'profile.summary.name': 'Name',
  'profile.summary.email': 'Email',
  'profile.summary.viewingAs': 'Viewing as',
  'profile.summary.demo': '(demo mode)',
  'profile.prefs.title': 'Preferences',
  'profile.prefs.defaultStore': 'Default store',
  'profile.prefs.noDefaultStore': 'No default store',
  'profile.prefs.storesFailed': 'We couldn’t load your stores. Try again later.',
  'profile.prefs.saved': 'Default store saved on this device.',
  'profile.prefs.timeZone': 'Time zone',
  'passkeys.title': 'Passkeys',
  'passkeys.description':
    'Passkeys let you sign in with Face ID, fingerprint or your device PIN. Add one for each device you use.',
  'passkeys.tableLabel': 'Your passkeys',
  'passkeys.col.device': 'Device',
  'passkeys.col.added': 'Added',
  'passkeys.col.actions': 'Actions',
  'passkeys.unnamed': 'Passkey',
  'passkeys.add': 'Add a passkey',
  'passkeys.added': 'Passkey added.',
  'passkeys.remove': 'Remove',
  'passkeys.removeLabel': 'Remove passkey {name}',
  'passkeys.removed': 'Passkey removed.',
  'passkeys.lastPasskey': 'You can’t remove your last passkey.',
  'passkeys.confirm.title': 'Remove this passkey?',
  'passkeys.confirm.description':
    'You won’t be able to sign in with “{name}” any more. Your other passkeys keep working.',
  'passkeys.confirm.remove': 'Remove passkey',
  'passkeys.loading': 'Loading your passkeys',
  'passkeys.loadFailed': 'We couldn’t load your passkeys. Try again in a moment.',
  'passkeys.addFailed': 'The passkey wasn’t added. The device prompt was cancelled or didn’t work.',
  'passkeys.alreadyExists': 'This device already has a passkey for your account.',
  'passkeys.removeFailed': 'The passkey wasn’t removed. Try again in a moment.',
  'passkeys.empty': 'No passkeys yet. Add one to sign in on this device.',

  // ── Session timeout (requirement 1.8) ───────────────────────────────────
  'session.warning.title': 'You’ll be signed out soon',
  'session.warning.description':
    'For your security, you’ll be signed out after 60 minutes without activity. Choose “Stay signed in” to keep working.',
  'session.warning.timeLeft': 'Time left: {time}',
  'session.warning.stay': 'Stay signed in',
  'session.warning.signOut': 'Sign out now',
}

export const authFil: Bundle = {
  'auth.brand.name': 'LaneWise',
  'auth.brand.byline': 'ng SM Retail',
  'auth.email.label': 'Work email',
  'auth.email.placeholder': 'juan@smretail.com',
  'auth.email.invalid': 'Ilagay ang iyong work email, gaya ng juan@smretail.com.',
  'auth.domainNotAllowed.title': 'Hindi pinapayagan ang domain ng work email na ito.',
  'auth.domainNotAllowed.description':
    'Gumamit ng @smretail.com o @1cloudhub.com na address.',
  'auth.working': 'Pinoproseso…',

  'auth.signIn.pageTitle': 'Mag-sign in — LaneWise',
  'auth.signIn.title': 'Mag-sign in sa LaneWise',
  'auth.signIn.submit': 'Mag-sign in gamit ang passkey',
  'auth.signIn.setUp': 'Bago ka rito, o walang passkey sa device na ito? Mag-set up',
  'auth.signIn.footnote':
    'Para lang sa mga account ng smretail.com at 1cloudhub.com. Walang password — mag-sign in gamit ang Face ID, fingerprint o PIN ng iyong device.',
  'auth.signIn.passkeyFailed.title':
    'Nakansela o hindi gumana ang passkey prompt.',
  'auth.signIn.passkeyFailed.description':
    'Subukang muli, o mag-set up ng passkey sa device na ito gamit ang email code.',
  'auth.signIn.useEmailCode': 'Gumamit ng email code',
  'auth.signIn.noPasskey.title': 'Wala pang passkey ang account na ito.',
  'auth.signIn.noPasskey.description':
    'Mag-set up ng isa sa device na ito gamit ang code na ipapadala sa iyong work email.',
  'auth.signIn.expired.title':
    'Na-sign out ka matapos ang 60 minutong walang aktibidad.',
  'auth.signIn.expired.description':
    'Mag-sign in muli para bumalik sa pahinang binubuksan mo.',
  'auth.signIn.signedOut': 'Naka-sign out ka na.',
  'auth.unsupported.title': 'Hindi sinusuportahan ng browser na ito ang passkey.',
  'auth.unsupported.description':
    'Gumamit ng bagong bersyon ng Chrome, Edge, Safari o Firefox sa computer o phone na may Face ID, fingerprint reader, Windows Hello o device PIN.',
  'auth.unavailable.title': 'Hindi magamit ang pag-sign in ngayon.',
  'auth.unavailable.description':
    'Subukang muli mamaya. Kung patuloy itong mangyari, makipag-ugnayan sa IT support.',

  'auth.first.pageTitle': 'I-set up ang iyong passkey — LaneWise',
  'auth.first.title': 'I-set up ang iyong passkey',
  'auth.first.stepsLabel': 'Mga hakbang sa setup',
  'auth.first.stepOf': 'Hakbang {step} ng {total}',
  'auth.first.step1': 'I-verify ang email',
  'auth.first.step2': 'Gumawa ng passkey',
  'auth.first.step3': 'Magsimula',
  'auth.first.stepDone': 'tapos na',
  'auth.first.sendCode': 'Ipadala ang code',
  'auth.first.verifyTitle': 'I-verify ang iyong email',
  'auth.first.emailIntro':
    'Magpapadala kami ng 6-digit na code sa iyong work email. Gagamitin lang ito para mag-set up ng passkey sa device na ito.',
  'auth.first.codeSent': 'Nagpadala kami ng 6-digit na code sa {email}.',
  'auth.first.codeLabel': 'Code',
  'auth.first.codeHint': '6 na digit, mula sa email na kapapadala lang namin.',
  'auth.first.codeInvalid': 'Ilagay ang 6-digit na code.',
  'auth.first.codeMismatch': 'Hindi tama ang code. Tingnan ang email at subukang muli.',
  'auth.first.codeExpired': 'Nag-expire na ang code. Magpadala ng bago.',
  'auth.first.tooManyAttempts': 'Masyadong maraming pagsubok. Maghintay ng ilang minuto, saka magpadala ng bagong code.',
  'auth.first.verify': 'I-verify ang code',
  'auth.first.resend': 'Ipadalang muli ang code',
  'auth.first.resent': 'Nagpadala kami ng bagong code.',
  'auth.first.useDifferentEmail': 'Gumamit ng ibang email',
  'auth.first.createTitle': 'Gumawa ng passkey',
  'auth.first.createIntro':
    'Hihingi ang iyong device ng Face ID, fingerprint o PIN. Ito na ang gagamitin mong passkey sa pag-sign in.',
  'auth.first.create': 'Gumawa ng passkey',
  'auth.first.createFailed.title': 'Hindi nagawa ang passkey.',
  'auth.first.createFailed.description':
    'Nakansela o hindi gumana ang prompt ng device. Subukang muli.',
  'auth.first.created': 'Nagawa na ang passkey.',
  'auth.first.startTitle': 'Magsimula',
  'auth.first.startAs': 'Magsimula bilang (demo mode — puwedeng palitan anumang oras)',
  'auth.first.notifications': 'Mga notification',
  'auth.first.notifyInApp': 'Sa app',
  'auth.first.notifyEmail': 'Email para sa mga approval at pagbabago ng shift',
  'auth.first.continue': 'Magpatuloy',

  'role.ADM': 'System Admin',
  'role.EXE': 'Executive',
  'role.PLN': 'Planner',
  'role.STM': 'Store Manager',
  'role.HR': 'HR',
  'role.FIN': 'Finance',
  'role.RST': 'Rules Steward',
  'role.STF': 'Staff',

  'profile.title': 'Profile at mga kagustuhan',
  'profile.signedInAs': 'Naka-sign in bilang {email}',
  'profile.summary.title': 'Profile',
  'profile.summary.name': 'Pangalan',
  'profile.summary.email': 'Email',
  'profile.summary.viewingAs': 'Tinitingnan bilang',
  'profile.summary.demo': '(demo mode)',
  'profile.prefs.title': 'Mga kagustuhan',
  'profile.prefs.defaultStore': 'Default na tindahan',
  'profile.prefs.noDefaultStore': 'Walang default na tindahan',
  'profile.prefs.storesFailed': 'Hindi ma-load ang iyong mga tindahan. Subukang muli mamaya.',
  'profile.prefs.saved': 'Na-save ang default na tindahan sa device na ito.',
  'profile.prefs.timeZone': 'Time zone',
  'passkeys.title': 'Mga passkey',
  'passkeys.description':
    'Sa passkey, makakapag-sign in ka gamit ang Face ID, fingerprint o PIN ng iyong device. Magdagdag ng isa para sa bawat device na ginagamit mo.',
  'passkeys.tableLabel': 'Ang iyong mga passkey',
  'passkeys.col.device': 'Device',
  'passkeys.col.added': 'Idinagdag',
  'passkeys.col.actions': 'Mga aksyon',
  'passkeys.unnamed': 'Passkey',
  'passkeys.add': 'Magdagdag ng passkey',
  'passkeys.added': 'Naidagdag ang passkey.',
  'passkeys.remove': 'Alisin',
  'passkeys.removeLabel': 'Alisin ang passkey na {name}',
  'passkeys.removed': 'Naalis ang passkey.',
  'passkeys.lastPasskey': 'Hindi mo maaalis ang huli mong passkey.',
  'passkeys.confirm.title': 'Alisin ang passkey na ito?',
  'passkeys.confirm.description':
    'Hindi ka na makakapag-sign in gamit ang “{name}”. Gagana pa rin ang iba mong passkey.',
  'passkeys.confirm.remove': 'Alisin ang passkey',
  'passkeys.loading': 'Nilo-load ang iyong mga passkey',
  'passkeys.loadFailed': 'Hindi ma-load ang iyong mga passkey. Subukang muli mamaya.',
  'passkeys.addFailed': 'Hindi naidagdag ang passkey. Nakansela o hindi gumana ang prompt ng device.',
  'passkeys.alreadyExists': 'May passkey na ang device na ito para sa iyong account.',
  'passkeys.removeFailed': 'Hindi naalis ang passkey. Subukang muli mamaya.',
  'passkeys.empty': 'Wala pang passkey. Magdagdag ng isa para makapag-sign in sa device na ito.',

  'session.warning.title': 'Masa-sign out ka na maya-maya',
  'session.warning.description':
    'Para sa iyong seguridad, masa-sign out ka matapos ang 60 minutong walang aktibidad. Piliin ang “Manatiling naka-sign in” para magpatuloy.',
  'session.warning.timeLeft': 'Natitirang oras: {time}',
  'session.warning.stay': 'Manatiling naka-sign in',
  'session.warning.signOut': 'Mag-sign out ngayon',
}
