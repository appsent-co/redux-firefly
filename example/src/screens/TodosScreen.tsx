import React, { useState, useMemo } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import {
  addTodo,
  toggleTodo,
  deleteTodo,
} from '../store/slices/todosSlice';
import TodoInput from '../components/TodoInput';
import TodoList from '../components/TodoList';
import FilterBar from '../components/FilterBar';
import type { Todo, Priority } from '../types';

/**
 * TodosScreen - Main todos screen
 *
 * Demonstrates:
 * - Reading from Redux state
 * - Dispatching Firefly actions
 * - Filtering todos
 * - Optimistic updates with UI feedback
 */
export default function TodosScreen() {
  const dispatch = useAppDispatch();
  const todos = useAppSelector((state) => state.todos);
  const categories = useAppSelector((state) => state.categories);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>();
  const [showCompleted, setShowCompleted] = useState(true);

  // Filter todos based on selected filters
  const filteredTodos = useMemo(() => {
    return todos.filter((todo) => {
      // Filter by category
      if (selectedCategoryId !== undefined && todo.categoryId !== selectedCategoryId) {
        return false;
      }

      // Filter by completed status
      if (!showCompleted && todo.completed) {
        return false;
      }

      return true;
    });
  }, [todos, selectedCategoryId, showCompleted]);

  const handleAddTodo = (text: string, description?: string, priority?: Priority) => {
    // PATTERN: Optimistic INSERT with commit/rollback
    dispatch(addTodo(text, description, selectedCategoryId, priority));
  };

  const handleToggleTodo = (todo: Todo) => {
    // PATTERN: Optimistic UPDATE
    dispatch(toggleTodo(todo.id, todo.completed));
  };

  const handleDeleteTodo = (todo: Todo) => {
    // PATTERN: Optimistic DELETE
    dispatch(deleteTodo(todo.id, todo));
  };

  const handleClearFilters = () => {
    setSelectedCategoryId(undefined);
    setShowCompleted(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <TodoInput onSubmit={handleAddTodo} />

      <FilterBar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        showCompleted={showCompleted}
        onCategorySelect={setSelectedCategoryId}
        onToggleCompleted={() => setShowCompleted(!showCompleted)}
        onClearFilters={handleClearFilters}
      />

      <TodoList
        todos={filteredTodos}
        onToggle={handleToggleTodo}
        onDelete={handleDeleteTodo}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
});
