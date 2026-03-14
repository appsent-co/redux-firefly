import React from 'react';
import { FlatList, View, Text, StyleSheet, RefreshControl } from 'react-native';
import TodoItem from './TodoItem';
import type { Todo, Category } from '../types';

interface TodoListProps {
  todos: Todo[];
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onPress?: (todo: Todo) => void;
  onMoveToCategory?: (todo: Todo, categoryId: number) => void;
  categories?: Category[];
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * TodoList component - Displays list of todos with empty state
 *
 * Demonstrates:
 * - FlatList rendering
 * - Pull-to-refresh functionality
 * - Empty state UI
 */
export default function TodoList({
  todos,
  onToggle,
  onDelete,
  onPress,
  onMoveToCategory,
  categories,
  onRefresh,
  refreshing,
}: TodoListProps) {
  if (todos.length === 0 && !refreshing) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>✨</Text>
        <Text style={styles.emptyTitle}>No todos yet</Text>
        <Text style={styles.emptySubtitle}>Add a todo to get started!</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={todos}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <TodoItem
          todo={item}
          onToggle={() => onToggle(item)}
          onDelete={() => onDelete(item)}
          onPress={() => onPress?.(item)}
          categories={categories}
          onMoveToCategory={(categoryId) => onMoveToCategory?.(item, categoryId)}
        />
      )}
      contentContainerStyle={todos.length === 0 ? styles.emptyList : undefined}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing || false}
            onRefresh={onRefresh}
            tintColor="#007AFF"
          />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyList: {
    flex: 1,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
});
