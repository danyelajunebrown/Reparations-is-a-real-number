/**
 * useKioskMode — persistent kiosk detection for the Raspberry Pi touchscreen.
 *
 * Problem this solves:
 *   The kiosk browser opens at /?mode=kiosk.  As soon as the user taps any nav
 *   link or section card, React Router's pushState strips the query param from
 *   the URL.  On the next render of HomePage (e.g. tapping "Home" in the nav)
 *   `useSearchParams().get('mode')` returns null, isKiosk = false, and the
 *   IntakeButton vanishes — making the kiosk appear non-functional.
 *
 * Solution:
 *   1. Read the URL param on every render (catches the initial load).
 *   2. If the param is present, write '1' to sessionStorage so it survives
 *      internal navigation for the life of the browser tab.
 *   3. Fall back to sessionStorage on renders where the param is absent.
 *
 * sessionStorage is tab-scoped (not cross-tab), which is exactly right for a
 * single-window kiosk that Chromium restarts fresh on each launch.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const SESSION_KEY = 'reparations_kiosk_mode';

export function useKioskMode() {
  const [searchParams] = useSearchParams();

  return useMemo(() => {
    // URL param takes priority — present on the very first load.
    if (searchParams.get('mode') === 'kiosk') {
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        // sessionStorage unavailable (private browsing edge case) — ignore.
      }
      return true;
    }

    // Subsequent renders after navigation clears the param — check storage.
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }, [searchParams]);
}
