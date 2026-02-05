import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { FireflyGate } from 'redux-firefly/react';
import { StatusBar } from 'expo-status-bar';
import { createStore } from './src/store';
import RootNavigator from './src/navigation/RootNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';
import type { AppStore } from './src/store';

/**
 * App - Application entry point
 *
 * Demonstrates:
 * - Async store creation with hydration
 * - FireflyGate for delayed rendering until hydration completes
 * - Error boundary for graceful error handling
 * - Loading states
 */
export default function App() {
  const [store, setStore] = useState<AppStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      console.log('[App] Initializing application...');

      // Create store with hydration
      // This demonstrates hydrateFromDatabase with complex JOIN queries
      const appStore = await createStore();

      setStore(appStore);
      console.log('[App] Application initialized successfully');
    } catch (err: any) {
      console.error('[App] Failed to initialize application:', err);
      setError(err.message || 'Unknown error');
    }
  };

  // Error state
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Failed to initialize app</Text>
        <Text style={styles.errorMessage}>{error}</Text>
      </View>
    );
  }

  // Loading state
  if (!store) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Initializing database...</Text>
      </View>
    );
  }

  // App ready
  return (
    <ErrorBoundary>
      <Provider store={store}>
        {/* FireflyGate delays rendering until hydration completes */}
        <FireflyGate
          loading={
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Loading your todos...</Text>
            </View>
          }
          onBeforeHydrate={() => {
            console.log('[FireflyGate] Starting hydration...');
          }}
        >
          <StatusBar style="auto" />
          <RootNavigator />
        </FireflyGate>
      </Provider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#8E8E93',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 32,
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
});
