/**
 * Approval workflow feature (task 12 — requirement 9): SCR-033 Approval
 * review (queue + review) and the `/approvals` API client. The app router
 * mounts the screen through `./pages`.
 */
export { ApprovalsScreen, type ApprovalsScreenProps } from './approvals-screen'
export {
  createApprovalsClient,
  type ApprovalQueueState,
  type ApprovalsClient,
  type DecisionInput,
  type OutsideRecordInput,
} from './api'
export { ApprovalsPage } from './pages'
