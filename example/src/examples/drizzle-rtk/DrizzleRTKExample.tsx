import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { FireflyGate } from 'redux-firefly/react';
import { store } from './store';
import ExampleNavigator from './navigation/ExampleNavigator';

export default function DrizzleRTKExample() {
  return (
    <Provider store={store}>
      <FireflyGate
        loading={
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#FF9500" />
            <Text style={styles.loadingText}>Loading Drizzle + RTK example...</Text>
          </View>
        }
      >
        <ExampleNavigator />
      </FireflyGate>
    </Provider>
  );
}

const styles = StyleSheet.create({
  loading: {
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
});
