import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import {
  addCategory,
  deleteCategory,
} from '../store/slices/categoriesSlice';
import type { Category } from '../../../types';

export default function CategoriesScreen() {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.categories);
  const todos = useAppSelector((state) => state.todos);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#007AFF');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📁');

  const colors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#5856D6'];
  const icons = ['📁', '💼', '🏠', '🛒', '❤️', '📚', '⭐', '🎯', '🔥', '✨'];

  const handleAddCategory = () => {
    if (newCategoryName.trim()) {
      dispatch(addCategory(newCategoryName.trim(), newCategoryColor, newCategoryIcon));
      setNewCategoryName('');
      setNewCategoryIcon('📁');
    }
  };

  const handleDeleteCategory = (category: Category) => {
    const todosInCategory = todos.filter((t) => t.categoryId === category.id);

    Alert.alert(
      'Delete Category',
      `Delete "${category.name}"?${
        todosInCategory.length > 0
          ? `\n\n${todosInCategory.length} todo(s) will be uncategorized.`
          : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            dispatch(deleteCategory(category.id, category));
          },
        },
      ]
    );
  };

  const getTodoCount = (categoryId: number) => {
    return todos.filter((t) => t.categoryId === categoryId).length;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.addForm}>
        <Text style={styles.formTitle}>Add New Category</Text>

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.iconPicker}>
            <Text style={styles.selectedIcon}>{newCategoryIcon}</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.nameInput}
            placeholder="Category name"
            value={newCategoryName}
            onChangeText={setNewCategoryName}
            onSubmitEditing={handleAddCategory}
            returnKeyType="done"
          />
        </View>

        <View style={styles.pickerContainer}>
          <Text style={styles.pickerLabel}>Icon:</Text>
          <View style={styles.optionsContainer}>
            {icons.map((icon) => (
              <TouchableOpacity
                key={icon}
                onPress={() => setNewCategoryIcon(icon)}
                style={[
                  styles.iconOption,
                  newCategoryIcon === icon && styles.iconOptionSelected,
                ]}
              >
                <Text style={styles.iconOptionText}>{icon}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.pickerContainer}>
          <Text style={styles.pickerLabel}>Color:</Text>
          <View style={styles.optionsContainer}>
            {colors.map((color) => (
              <TouchableOpacity
                key={color}
                onPress={() => setNewCategoryColor(color)}
                style={[
                  styles.colorOption,
                  { backgroundColor: color },
                  newCategoryColor === color && styles.colorOptionSelected,
                ]}
              />
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={handleAddCategory}
          style={[styles.addButton, !newCategoryName.trim() && styles.addButtonDisabled]}
          disabled={!newCategoryName.trim()}
        >
          <Text style={styles.addButtonText}>Add Category</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listContainer}>
        <Text style={styles.listTitle}>Categories ({categories.length})</Text>
        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const todoCount = getTodoCount(item.id);
            return (
              <View style={styles.categoryItem}>
                <View style={[styles.colorIndicator, { backgroundColor: item.color }]} />
                <Text style={styles.categoryIcon}>{item.icon}</Text>
                <View style={styles.categoryInfo}>
                  <Text style={styles.categoryName}>{item.name}</Text>
                  <Text style={styles.todoCount}>
                    {todoCount} todo{todoCount !== 1 ? 's' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteCategory(item)}
                  style={styles.deleteButton}
                >
                  <Text style={styles.deleteButtonText}>🗑️</Text>
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No categories yet</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  addForm: { backgroundColor: '#FFFFFF', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
  formTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconPicker: { width: 50, height: 50, backgroundColor: '#F2F2F7', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  selectedIcon: { fontSize: 28 },
  nameInput: { flex: 1, fontSize: 16, padding: 12, backgroundColor: '#F2F2F7', borderRadius: 8 },
  pickerContainer: { marginBottom: 12 },
  pickerLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  optionsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconOption: { width: 40, height: 40, backgroundColor: '#F2F2F7', borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  iconOptionSelected: { borderColor: '#007AFF', backgroundColor: '#007AFF20' },
  iconOptionText: { fontSize: 20 },
  colorOption: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  colorOptionSelected: { borderColor: '#000000' },
  addButton: { backgroundColor: '#007AFF', padding: 14, borderRadius: 8, alignItems: 'center' },
  addButtonDisabled: { backgroundColor: '#C7C7CC' },
  addButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  listContainer: { flex: 1, padding: 16 },
  listTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  categoryItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, marginBottom: 8 },
  colorIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 12 },
  categoryIcon: { fontSize: 24, marginRight: 12 },
  categoryInfo: { flex: 1 },
  categoryName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  todoCount: { fontSize: 14, color: '#8E8E93' },
  deleteButton: { padding: 8 },
  deleteButtonText: { fontSize: 20 },
  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#8E8E93' },
});
