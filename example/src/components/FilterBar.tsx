import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import type { Category } from '../types';

interface FilterBarProps {
  categories: Category[];
  selectedCategoryId?: number;
  showCompleted: boolean;
  onCategorySelect: (categoryId?: number) => void;
  onToggleCompleted: () => void;
  onClearFilters: () => void;
}

/**
 * FilterBar component - Filter controls for todos
 *
 * Demonstrates:
 * - Category filtering (uses SELECT query)
 * - Completed/active toggle
 * - Clear filters action
 */
export default function FilterBar({
  categories,
  selectedCategoryId,
  showCompleted,
  onCategorySelect,
  onToggleCompleted,
  onClearFilters,
}: FilterBarProps) {
  const hasActiveFilters = selectedCategoryId !== undefined || !showCompleted;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* All categories button */}
        <TouchableOpacity
          onPress={() => onCategorySelect(undefined)}
          style={[
            styles.filterButton,
            selectedCategoryId === undefined && styles.filterButtonActive,
          ]}
        >
          <Text
            style={[
              styles.filterButtonText,
              selectedCategoryId === undefined && styles.filterButtonTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>

        {/* Category filters */}
        {categories.map((category) => {
          const isSelected = selectedCategoryId === category.id;
          return (
            <TouchableOpacity
              key={category.id}
              onPress={() => onCategorySelect(category.id)}
              style={[
                styles.filterButton,
                isSelected && styles.filterButtonActive,
                isSelected && { backgroundColor: category.color },
              ]}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  isSelected && styles.filterButtonTextActive,
                ]}
              >
                {category.icon} {category.name}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Completed toggle */}
        <TouchableOpacity
          onPress={onToggleCompleted}
          style={[
            styles.filterButton,
            !showCompleted && styles.filterButtonMuted,
          ]}
        >
          <Text style={styles.filterButtonText}>
            {showCompleted ? '✓ Show Completed' : '✕ Hide Completed'}
          </Text>
        </TouchableOpacity>

        {/* Clear filters */}
        {hasActiveFilters && (
          <TouchableOpacity
            onPress={onClearFilters}
            style={[styles.filterButton, styles.clearButton]}
          >
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  scrollContent: {
    padding: 12,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    marginRight: 8,
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
  },
  filterButtonMuted: {
    backgroundColor: '#E5E5EA',
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  clearButton: {
    backgroundColor: '#FF3B30',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
