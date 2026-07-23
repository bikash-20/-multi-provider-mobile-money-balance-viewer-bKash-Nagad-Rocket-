/**
 * features/pwa — PWA + Offline support.
 *
 * Barrel export so consumers can import from '@/features/pwa'.
 */
export { OfflineIndicator } from './OfflineIndicator';
export { PWARegister } from './PWARegister';
export { useOnlineStatus } from './useOnlineStatus';
export {
  enqueue,
  getCount,
  onCountChange,
  replayAll,
  clearQueue,
  type PendingMutation,
  type ReplayResult,
} from './syncQueue';
