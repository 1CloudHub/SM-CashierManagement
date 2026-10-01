/**
 * Notifications feature (task 19 — requirement 20): the top-bar bell, SCR-040
 * Notifications and the notification-preferences dialog, plus the
 * `/notifications` + `/notification-preferences` API client. The shell mounts
 * the bell (app/app-layout) and the route table mounts `./pages`.
 */
export { createNotificationsClient, type ListNotificationsOptions, type NotificationsClient } from './api'
export { NotificationBell } from './notification-bell'
export { NotificationsScreen, type NotificationsScreenProps } from './notifications-screen'
export { NotificationsPage } from './pages'
export { PreferencesDialog } from './preferences-dialog'
export { SEVERITY_TONE, notificationTitle } from './text'
export { NOTIFICATIONS_CHANGED, announceNotificationsChanged, useNotificationsClient } from './use-notifications'
