/**
 * Business rules feature (task 10 — requirement 16): SCR-060 Rule sets and
 * SCR-061 Rule version editor, plus the `/rule-sets` + `/rule-versions` API
 * client. The app router mounts the screens through `./pages` (task 8.2
 * route table), which supply the `RulesClient` and the active role.
 */
export { RuleSetsScreen, type RuleSetsScreenProps } from './rule-sets-screen'
export { RuleVersionEditorScreen, type RuleVersionEditorScreenProps } from './rule-version-editor-screen'
export {
  RulesApiError,
  createRulesClient,
  type PublishOutcome,
  type RuleSetRef,
  type RuleVersionEdit,
  type RulesClient,
} from './api'
export { availableActions, type VersionActions } from './logic'
export { RuleSetsPage, RuleVersionEditorPage } from './pages'
