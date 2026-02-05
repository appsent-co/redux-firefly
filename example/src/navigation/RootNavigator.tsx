import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import TodosScreen from '../screens/TodosScreen';
import CategoriesScreen from '../screens/CategoriesScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

/**
 * RootNavigator - Bottom tab navigation
 *
 * Three main tabs:
 * - Todos: Main todo list with filtering
 * - Categories: Manage categories
 * - Settings: Statistics and bulk operations
 */
export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: '#007AFF',
          tabBarInactiveTintColor: '#8E8E93',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: '#E5E5EA',
          },
          headerStyle: {
            backgroundColor: '#FFFFFF',
            borderBottomWidth: 1,
            borderBottomColor: '#E5E5EA',
          },
          headerTitleStyle: {
            fontWeight: '600',
            fontSize: 18,
          },
        }}
      >
        <Tab.Screen
          name="Todos"
          component={TodosScreen}
          options={{
            tabBarIcon: ({ color }) => <TabIcon icon="📝" color={color} />,
            title: 'My Todos',
          }}
        />
        <Tab.Screen
          name="Categories"
          component={CategoriesScreen}
          options={{
            tabBarIcon: ({ color }) => <TabIcon icon="📁" color={color} />,
            title: 'Categories',
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} />,
            title: 'Settings',
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// Simple icon component using emoji
function TabIcon({ icon, color }: { icon: string; color: string }) {
  return (
    <Text style={{ fontSize: 24, opacity: color === '#007AFF' ? 1 : 0.6 }}>
      {icon}
    </Text>
  );
}
