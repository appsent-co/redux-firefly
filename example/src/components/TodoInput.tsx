import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { Priority } from '../types';

interface TodoInputProps {
  onSubmit: (text: string, description?: string, priority?: Priority) => void;
  placeholder?: string;
}

/**
 * TodoInput component - Add new todo form
 *
 * Demonstrates:
 * - Simple form input
 * - Priority selection
 * - Clear after submit
 */
export default function TodoInput({
  onSubmit,
  placeholder = 'Add a new todo...',
}: TodoInputProps) {
  const [text, setText] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>(1);
  const [showDetails, setShowDetails] = useState(false);

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(
        text.trim(),
        description.trim() || undefined,
        priority
      );
      setText('');
      setDescription('');
      setPriority(1);
      setShowDetails(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
        />
        <TouchableOpacity
          onPress={() => setShowDetails(!showDetails)}
          style={styles.detailsButton}
        >
          <Text style={styles.detailsButtonText}>
            {showDetails ? '▼' : '▶'}
          </Text>
        </TouchableOpacity>
      </View>

      {showDetails && (
        <View style={styles.detailsContainer}>
          <TextInput
            style={styles.descriptionInput}
            placeholder="Description (optional)"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
          />

          <View style={styles.priorityContainer}>
            <Text style={styles.priorityLabel}>Priority:</Text>
            {([1, 2, 3] as Priority[]).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setPriority(p)}
                style={[
                  styles.priorityButton,
                  priority === p && styles.priorityButtonActive,
                  { backgroundColor: priority === p ? priorityColors[p] : '#F2F2F7' },
                ]}
              >
                <Text
                  style={[
                    styles.priorityButtonText,
                    priority === p && styles.priorityButtonTextActive,
                  ]}
                >
                  P{p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        onPress={handleSubmit}
        style={[styles.submitButton, !text.trim() && styles.submitButtonDisabled]}
        disabled={!text.trim()}
      >
        <Text style={styles.submitButtonText}>Add Todo</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const priorityColors = {
  1: '#34C759',
  2: '#FF9500',
  3: '#FF3B30',
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    padding: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 12,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
  },
  detailsButton: {
    padding: 12,
    marginLeft: 8,
  },
  detailsButtonText: {
    fontSize: 12,
    color: '#007AFF',
  },
  detailsContainer: {
    marginTop: 12,
  },
  descriptionInput: {
    fontSize: 14,
    padding: 12,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    marginBottom: 12,
    minHeight: 60,
  },
  priorityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  priorityLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 12,
  },
  priorityButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  priorityButtonActive: {
    // Background color set dynamically
  },
  priorityButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  priorityButtonTextActive: {
    color: '#FFFFFF',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
