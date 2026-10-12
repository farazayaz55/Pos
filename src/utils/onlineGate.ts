/**
 * App-wide online flag (browser + Firebase), updated by useOnlineStatus.
 * Used by non-React code (e.g. authStore) that cannot call hooks.
 */
let appOnline =
  typeof navigator !== 'undefined' ? navigator.onLine : true

export const setAppOnline = (online: boolean) => {
  appOnline = online
}

export const isAppOnline = () => appOnline
