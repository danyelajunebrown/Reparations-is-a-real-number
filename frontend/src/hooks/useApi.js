import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useApi — generic fetch hook with loading/error/data state.
 * Pass a function that returns a promise. Runs on mount and whenever deps change.
 */
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState(s => ({ ...s, loading: true, error: null }));
    Promise.resolve(fn(controller.signal))
      .then(data => {
        if (cancelled || !mountedRef.current) return;
        setState({ data, loading: false, error: null });
      })
      .catch(err => {
        if (cancelled || err.name === 'AbortError' || !mountedRef.current) return;
        setState({ data: null, loading: false, error: err });
      });
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/**
 * useAsyncAction — for user-triggered async calls (button clicks, form submit).
 * Returns [run, state] where run(...args) invokes the function.
 */
export function useAsyncAction(fn) {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const run = useCallback(async (...args) => {
    setState({ loading: true, error: null, data: null });
    try {
      const data = await fn(...args);
      setState({ loading: false, error: null, data });
      return data;
    } catch (err) {
      setState({ loading: false, error: err, data: null });
      throw err;
    }
  }, [fn]);
  return [run, state];
}
