import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { FireflyGateProps } from '../types';

/**
 * FireflyGate component delays rendering children until hydration completes
 * Similar to redux-persist's PersistGate
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
}: FireflyGateProps) {
  // Read hydration status from Redux state
  const hydrated = useSelector(
    (state: any) => state._firefly?.hydrated ?? false
  );

  // Call onBeforeHydrate callback when not yet hydrated
  useEffect(() => {
    if (!hydrated && onBeforeHydrate) {
      onBeforeHydrate();
    }
  }, [hydrated, onBeforeHydrate]);

  // Show loading component while hydrating
  if (!hydrated) {
    return loading ? <>{loading}</> : null;
  }

  // Render children once hydration is complete
  return <>{children}</>;
}
