import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';

// Lazy-load examples so their stores (and DB initialization) only run
// when you actually navigate to them.
const DrizzleRTKExample = React.lazy(() => import('../examples/drizzle-rtk/DrizzleRTKExample'));
const RTKDriverExample = React.lazy(() => import('../examples/rtk-driver/RTKDriverExample'));
const PlainReduxExample = React.lazy(() => import('../examples/plain-redux/PlainReduxExample'));

const Stack = createNativeStackNavigator();

function LazyDrizzleRTK() {
  return (
    <React.Suspense fallback={null}>
      <DrizzleRTKExample />
    </React.Suspense>
  );
}

function LazyRTKDriver() {
  return (
    <React.Suspense fallback={null}>
      <RTKDriverExample />
    </React.Suspense>
  );
}

function LazyPlainRedux() {
  return (
    <React.Suspense fallback={null}>
      <PlainReduxExample />
    </React.Suspense>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '600', fontSize: 18 },
          headerBackTitle: 'Examples',
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="DrizzleRTK"
          component={LazyDrizzleRTK}
          options={{ title: 'Drizzle + RTK' }}
        />
        <Stack.Screen
          name="RTKDriver"
          component={LazyRTKDriver}
          options={{ title: 'RTK + Driver' }}
        />
        <Stack.Screen
          name="PlainRedux"
          component={LazyPlainRedux}
          options={{ title: 'Plain Redux' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
