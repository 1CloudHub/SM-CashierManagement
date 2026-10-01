import { Outlet, Route, Routes } from 'react-router'
import { App } from '@/App'
import { useRouteFocus } from '@/components/a11y'
import { HelpProvider } from '@/components/help'
import { ApprovalsPage } from '@/features/approvals/pages'
import { ProfileScreen } from '@/features/auth/profile-screen'
import { DataSourcesPage, UploadPage } from '@/features/data/pages'
import { DepartmentPage, HiringPage, NetworkPage, SummaryPage } from '@/features/planning/pages'
import { HomeScreen } from '@/features/home/home-screen'
import { RosterPage } from '@/features/roster/pages'
import { NotificationsPage } from '@/features/notifications/pages'
import { NetworkMapPage } from '@/features/network-map/pages'
import { SearchResultsScreen } from '@/features/search/search-results-screen'
import { RuleSetsPage, RuleVersionEditorPage } from '@/features/rules/pages'
import { ScenarioComparePage, ScenarioListPage, ScenarioSettingsPage } from '@/features/scenarios/pages'
import { SCREEN_BY_ID, SCREENS, type ScreenDef, type ScreenId } from './screens'
import { GLOBAL_SEARCH_ID, useShellSlots } from './app-layout'
import { useRouter } from './router'
import { Guarded, HelpScreen, NotFoundScreen, PlaceholderScreen, StatusScreen } from './screen-pages'

/**
 * The signed-in route table (task 8.2): one route per screen in the screen
 * map. Every screen route goes through the role guard, so an out-of-scope
 * deep link renders "No access" before any screen code runs (requirement
 * 2.4). Screens not built yet render a placeholder naming their spec task.
 * The component gallery stays reachable at /gallery.
 */
const BUILT: Partial<Record<ScreenId, () => React.ReactNode>> = {
  'SCR-010': () => <HomeScreen />,
  'SCR-022': () => <RosterPage />,
  'SCR-020': () => <NetworkPage />,
  'SCR-021': () => <DepartmentPage />,
  'SCR-023': () => <HiringPage />,
  'SCR-024': () => <SummaryPage />,
  'SCR-026': () => <NetworkMapPage />,
  'SCR-030': () => <ScenarioListPage />,
  'SCR-031': () => <ScenarioSettingsPage />,
  'SCR-032': () => <ScenarioComparePage />,
  'SCR-033': () => <ApprovalsPage />,
  'SCR-040': () => <NotificationsPage />,
  'SCR-041': () => <SearchResultsScreen />,
  'SCR-060': () => <RuleSetsPage />,
  'SCR-061': () => <RuleVersionEditorPage />,
  // SCR-080 keeps its own shell from task 7 until it moves into AppLayout.
  'SCR-050': () => <DataSourcesPage />,
  'SCR-051': () => <UploadPage />,
  'SCR-080': () => <ProfileScreen />,
  'SCR-090': () => <StatusScreen />,
  'SCR-091': () => <HelpScreen />,
}

function screenElement(screen: ScreenDef) {
  const render = BUILT[screen.id]
  return <Guarded screen={screen}>{render ? render() : <PlaceholderScreen screen={screen} />}</Guarded>
}

const NAV_TARGETS = { home: '/', roster: '/plan/roster', map: '/plan/map' } as const

/**
 * Persistent layout for app screens: global shortcuts (`?`, `/`, `n`, g h /
 * g r / g m), the help dialog, and focus to <main> on route change (screens remount
 * their AppLayout per route, so this must live above them).
 */
function WithHelp() {
  const { location, navigate } = useRouter()
  useRouteFocus(location.pathname)
  return (
    <HelpProvider
      onNavigate={(target) => navigate(NAV_TARGETS[target])}
      onFocusSearch={() => document.getElementById(GLOBAL_SEARCH_ID)?.focus()}
      onOpenNotifications={() => navigate('/notifications')}
    >
      <Outlet />
    </HelpProvider>
  )
}

export function AppRoutes() {
  const slots = useShellSlots()
  return (
    <Routes>
      {/* The gallery owns its own providers (help, toast, i18n). */}
      <Route path="/gallery" element={<App accountSlot={slots.account} />} />
      <Route element={<WithHelp />}>
        {SCREENS.map((screen) => (
          <Route key={screen.id} path={screen.path} element={screenElement(screen)} />
        ))}
        {/* SCR-071 also edits an existing user. */}
        <Route path="/admin/users/:userId" element={screenElement(SCREEN_BY_ID['SCR-071'])} />
        <Route path="/index.html" element={screenElement(SCREEN_BY_ID['SCR-010'])} />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  )
}
