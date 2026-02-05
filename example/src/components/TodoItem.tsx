import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import type { Todo } from '../types';

interface TodoItemProps {
  todo: Todo;
  onToggle: () => void;
  onDelete: () => void;
  onPress?: () => void;
}

/**
 * TodoItem component - Displays individual todo with sync status
 *
 * Demonstrates:
 * - Optimistic update UI (syncing indicator)
 * - Error state display
 * - Priority visualization
 * - Category and tag display
 */
export default function TodoItem({ todo, onToggle, onDelete, onPress }: TodoItemProps) {
  const priorityColor = {
    1: '#34C759', // Low - green
    2: '#FF9500', // Medium - orange
    3: '#FF3B30', // High - red
  }[todo.priority];

  const isOverdue =
    todo.dueDate && todo.dueDate < Math.floor(Date.now() / 1000) && !todo.completed;

  return (
    <View style={[styles.container, todo.completed && styles.completedContainer]}>
      {/* Checkbox */}
      <TouchableOpacity
        onPress={onToggle}
        style={[styles.checkbox, todo.completed && styles.checkboxCompleted]}
        disabled={todo.syncing}
      >
        {todo.syncing ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          todo.completed && <Text style={styles.checkmark}>✓</Text>
        )}
      </TouchableOpacity>

      {/* Content */}
      <TouchableOpacity
        style={styles.content}
        onPress={onPress}
        disabled={todo.syncing}
        activeOpacity={0.7}
      >
        <View style={styles.mainContent}>
          <Text style={[styles.text, todo.completed && styles.completedText]}>{todo.text}</Text>
          {todo.description && (
            <Text style={styles.description} numberOfLines={1}>
              {todo.description}
            </Text>
          )}
        </View>

        {/* Metadata row */}
        <View style={styles.metadata}>
          {/* Priority indicator */}
          <View style={[styles.priorityBadge, { backgroundColor: priorityColor }]}>
            <Text style={styles.priorityText}>P{todo.priority}</Text>
          </View>

          {/* Category badge */}
          {todo.category && (
            <View style={[styles.categoryBadge, { backgroundColor: todo.category.color + '20' }]}>
              <Text style={styles.categoryText}>
                {todo.category.icon} {todo.category.name}
              </Text>
            </View>
          )}

          {/* Tags */}
          {todo.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {todo.tags.slice(0, 2).map((tag) => (
                <View
                  key={tag.id}
                  style={[styles.tagBadge, { backgroundColor: tag.color + '20' }]}
                >
                  <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
              {todo.tags.length > 2 && (
                <Text style={styles.moreTagsText}>+{todo.tags.length - 2}</Text>
              )}
            </View>
          )}

          {/* Due date warning */}
          {isOverdue && (
            <View style={styles.overdueBadge}>
              <Text style={styles.overdueText}>⚠️ Overdue</Text>
            </View>
          )}
        </View>

        {/* Error message */}
        {todo.error && (
          <Text style={styles.errorText}>❌ {todo.error}</Text>
        )}
      </TouchableOpacity>

      {/* Delete button */}
      <TouchableOpacity
        onPress={onDelete}
        style={styles.deleteButton}
        disabled={todo.syncing}
      >
        <Text style={styles.deleteText}>🗑️</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  completedContainer: {
    backgroundColor: '#F2F2F7',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxCompleted: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  mainContent: {
    marginBottom: 6,
  },
  text: {
    fontSize: 16,
    color: '#000000',
    marginBottom: 2,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#8E8E93',
  },
  description: {
    fontSize: 14,
    color: '#8E8E93',
  },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 12,
    color: '#000000',
    fontWeight: '500',
  },
  tagsContainer: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500',
  },
  moreTagsText: {
    fontSize: 11,
    color: '#8E8E93',
  },
  overdueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  overdueText: {
    fontSize: 11,
    color: '#FF3B30',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 4,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  deleteText: {
    fontSize: 20,
  },
});
