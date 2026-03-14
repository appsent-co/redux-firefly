import React, { useState, useMemo } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import {
  addTodo,
  toggleTodo,
  deleteTodo,
  moveTodoToCategory,
} from '../store/slices/todosSlice';
import TodoInput from '../../../components/TodoInput';
import TodoList from '../../../components/TodoList';
import FilterBar from '../../../components/FilterBar';
import type { Todo, Priority } from '../../../types';

export default function TodosScreen() {
  const dispatch = useAppDispatch();
  const todos = useAppSelector((state) => state.todos);
  const categories = useAppSelector((state) => state.categories);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>();
  const [showCompleted, setShowCompleted] = useState(true);

  const filteredTodos = useMemo(() => {
    return todos.filter((todo) => {
      if (selectedCategoryId !== undefined && todo.categoryId !== selectedCategoryId) {
        return false;
      }
      if (!showCompleted && todo.completed) {
        return false;
      }
      return true;
    });
  }, [todos, selectedCategoryId, showCompleted]);

  const handleAddTodo = (text: string, description?: string, priority?: Priority) => {
    dispatch(addTodo(text, description, selectedCategoryId, priority));
  };

  const handleToggleTodo = (todo: Todo) => {
    dispatch(toggleTodo(todo.id, todo.completed));
  };

  const handleDeleteTodo = (todo: Todo) => {
    dispatch(deleteTodo(todo.id, todo));
  };

  const handleMoveToCategory = (todo: Todo, categoryId: number) => {
    if (typeof todo.id === 'number') {
      dispatch(moveTodoToCategory(todo.id, categoryId));
    }
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
        onMoveToCategory={handleMoveToCategory}
        categories={categories}
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
