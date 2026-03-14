import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { addTodo, toggleTodo, deleteTodo } from '../store/actions';
import TodoInput from '../../../components/TodoInput';
import TodoList from '../../../components/TodoList';
import type { Todo } from '../../../types';

export default function TodosScreen() {
  const dispatch = useAppDispatch();
  const todos = useAppSelector((state) => state.todos);

  const handleAddTodo = (text: string) => {
    dispatch(addTodo(text));
  };

  const handleToggleTodo = (todo: Todo) => {
    dispatch(toggleTodo(todo.id, todo.completed));
  };

  const handleDeleteTodo = (todo: Todo) => {
    dispatch(deleteTodo(todo.id, todo));
  };

  return (
    <SafeAreaView style={styles.container}>
      <TodoInput onSubmit={handleAddTodo} />
      <TodoList
        todos={todos}
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
