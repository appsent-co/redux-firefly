import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { FireflyGate } from 'redux-firefly/react';
import { StatusBar } from 'expo-status-bar';
import { store } from './src/store';
import RootNavigator from './src/navigation/RootNavigator';
import ErrorBoundary from './src/components/ErrorBoundary';

/**
 * App - Application entry point
 *
 * Demonstrates:
 * - Store creation with createFirefly enhancers
 * - FireflyGate for delayed rendering until hydration completes
 * - Error boundary for graceful error handling
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Provider store={store}>
        <FireflyGate
          loading={
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Loading your todos...</Text>
            </View>
          }
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
