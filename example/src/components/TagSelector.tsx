import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  SafeAreaView,
} from 'react-native';
import type { Tag } from '../types';

interface TagSelectorProps {
  visible: boolean;
  tags: Tag[];
  selectedTagIds: number[];
  onConfirm: (tagIds: number[]) => void;
  onClose: () => void;
}

/**
 * TagSelector component - Modal to select multiple tags
 *
 * Demonstrates:
 * - Multi-select UI pattern
 * - Checkbox-style selection
 * - Confirm/cancel actions
 */
export default function TagSelector({
  visible,
  tags,
  selectedTagIds,
  onConfirm,
  onClose,
}: TagSelectorProps) {
  const [localSelection, setLocalSelection] = useState<number[]>(selectedTagIds);

  const toggleTag = (tagId: number) => {
    setLocalSelection((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const handleConfirm = () => {
    onConfirm(localSelection);
    onClose();
  };

  const handleClose = () => {
    setLocalSelection(selectedTagIds); // Reset to original
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Tags</Text>
            <Text style={styles.subtitle}>
              {localSelection.length} selected
            </Text>
          </View>

          <FlatList
            data={tags}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => {
              const isSelected = localSelection.includes(item.id);
              return (
                <TouchableOpacity
                  onPress={() => toggleTag(item.id)}
                  style={styles.tagItem}
                >
                  <View
                    style={[
                      styles.checkbox,
                      isSelected && styles.checkboxSelected,
                      { borderColor: item.color },
                      isSelected && { backgroundColor: item.color },
                    ]}
                  >
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View style={styles.tagContent}>
                    <Text style={styles.tagName}>{item.name}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          <View style={styles.footer}>
            <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleConfirm} style={styles.confirmButton}>
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </TouchableOpacity>
          </View>
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
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxSelected: {
    // Background set dynamically
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  tagContent: {
    flex: 1,
  },
  tagName: {
    fontSize: 16,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  confirmButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
