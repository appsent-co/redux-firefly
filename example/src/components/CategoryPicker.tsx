import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  SafeAreaView,
} from 'react-native';
import type { Category } from '../types';

interface CategoryPickerProps {
  visible: boolean;
  categories: Category[];
  selectedCategoryId?: number;
  onSelect: (categoryId?: number) => void;
  onClose: () => void;
}

/**
 * CategoryPicker component - Modal to select a category
 *
 * Demonstrates:
 * - Modal UI pattern
 * - Category selection
 * - "None" option to clear category
 */
export default function CategoryPicker({
  visible,
  categories,
  selectedCategoryId,
  onSelect,
  onClose,
}: CategoryPickerProps) {
  const handleSelect = (categoryId?: number) => {
    onSelect(categoryId);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Category</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={[{ id: undefined, name: 'None', color: '#8E8E93', icon: '⭕' }, ...categories]}
            keyExtractor={(item) => String(item.id ?? 'none')}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedCategoryId;
              return (
                <TouchableOpacity
                  onPress={() => handleSelect(item.id)}
                  style={[
                    styles.categoryItem,
                    isSelected && styles.categoryItemSelected,
                  ]}
                >
                  <View style={styles.categoryContent}>
                    <Text style={styles.categoryIcon}>{item.icon}</Text>
                    <Text style={styles.categoryName}>{item.name}</Text>
                  </View>
                  <View
                    style={[
                      styles.colorIndicator,
                      { backgroundColor: item.color },
                    ]}
                  />
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#8E8E93',
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  categoryItemSelected: {
    backgroundColor: '#F2F2F7',
  },
  categoryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  categoryName: {
    fontSize: 16,
    flex: 1,
  },
  colorIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 12,
  },
  checkmark: {
    fontSize: 20,
    color: '#007AFF',
  },
});
