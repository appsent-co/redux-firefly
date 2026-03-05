import React, { useEffect, useMemo, useState } from 'react';
import { useStore, createStoreHook } from 'react-redux';
import type { FireflyGateProps, FireflyStore } from '../types';

/**
 * FireflyGate component delays rendering children until hydration completes.
 *
 * @example
 * import { Provider } from 'react-redux';
 * import { FireflyGate } from 'redux-firefly/react';
 *
 * function App() {
 *   return (
 *     <Provider store={store}>
 *       <FireflyGate loading={<LoadingScreen />}>
 *         <MainApp />
 *       </FireflyGate>
 *     </Provider>
 *   );
 * }
 */
export function FireflyGate({
  loading,
  children,
  onBeforeHydrate,
  context,
}: FireflyGateProps) {
  const useContextStore = useMemo(
    () => (context ? createStoreHook(context) : useStore),
    [context]
  );
  const store = useContextStore() as ReturnType<typeof useStore> & FireflyStore;

  const [hydrated, setHydrated] = useState(() => store.isHydrated());

  useEffect(() => {
    if (hydrated) return;

    if (onBeforeHydrate) {
      onBeforeHydrate();
    }

    return store.onHydrationChange((isHydrated) => {
      if (isHydrated) setHydrated(true);
    });
  }, [store, hydrated, onBeforeHydrate]);

  if (!hydrated) {
    return loading ? <>{loading}</> : null;
  }

  return <>{children}</>;
}
