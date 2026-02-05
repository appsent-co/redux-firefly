import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Linking,
} from 'react-native';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { deleteCompletedTodos } from '../store/slices/todosSlice';
import { db } from '../database/schema';
import StatCard from '../components/StatCard';

/**
 * SettingsScreen - Stats & admin operations
 *
 * Demonstrates:
 * - RAW SQL queries for statistics (aggregates, JOINs)
 * - Bulk DELETE operations
 * - Database info display
 */
export default function SettingsScreen() {
  const dispatch = useAppDispatch();
  const todos = useAppSelector((state) => state.todos);
  const categories = useAppSelector((state) => state.categories);
  const tags = useAppSelector((state) => state.tags);

  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    overdue: 0,
    byPriority: { 1: 0, 2: 0, 3: 0 },
  });

  // Load statistics using RAW SQL query
  useEffect(() => {
    loadStats();
  }, [todos]);

  const loadStats = () => {
    try {
      // PATTERN: RAW SQL query with aggregates
      const result = db.getAllSync(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN due_date < strftime('%s', 'now') AND completed = 0 THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN priority = 1 THEN 1 ELSE 0 END) as priority_low,
          SUM(CASE WHEN priority = 2 THEN 1 ELSE 0 END) as priority_medium,
          SUM(CASE WHEN priority = 3 THEN 1 ELSE 0 END) as priority_high
        FROM todos
      `);

      if (result && result[0]) {
        const row: any = result[0];
        setStats({
          total: row.total,
          completed: row.completed,
          overdue: row.overdue,
          byPriority: {
            1: row.priority_low,
            2: row.priority_medium,
            3: row.priority_high,
          },
        });
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleDeleteCompleted = () => {
    const completedCount = stats.completed;

    if (completedCount === 0) {
      Alert.alert('No Completed Todos', 'There are no completed todos to delete.');
      return;
    }

    Alert.alert(
      'Delete Completed Todos',
      `Delete ${completedCount} completed todo(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // PATTERN: Bulk DELETE
            dispatch(deleteCompletedTodos());
          },
        },
      ]
    );
  };

  const completionRate =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Statistics Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Statistics</Text>

          <StatCard
            title="Total Todos"
            value={stats.total}
            icon="📝"
            color="#007AFF"
          />

          <StatCard
            title="Completed"
            value={stats.completed}
            icon="✅"
            color="#34C759"
            subtitle={`${completionRate}% completion rate`}
          />

          <StatCard
            title="Overdue"
            value={stats.overdue}
            icon="⚠️"
            color="#FF3B30"
          />

          <View style={styles.priorityStats}>
            <Text style={styles.priorityStatsTitle}>By Priority:</Text>
            <View style={styles.priorityRow}>
              <View style={styles.priorityItem}>
                <View style={[styles.priorityBadge, { backgroundColor: '#34C759' }]}>
                  <Text style={styles.priorityBadgeText}>P1</Text>
                </View>
                <Text style={styles.priorityCount}>{stats.byPriority[1]}</Text>
              </View>
              <View style={styles.priorityItem}>
                <View style={[styles.priorityBadge, { backgroundColor: '#FF9500' }]}>
                  <Text style={styles.priorityBadgeText}>P2</Text>
                </View>
                <Text style={styles.priorityCount}>{stats.byPriority[2]}</Text>
              </View>
              <View style={styles.priorityItem}>
                <View style={[styles.priorityBadge, { backgroundColor: '#FF3B30' }]}>
                  <Text style={styles.priorityBadgeText}>P3</Text>
                </View>
                <Text style={styles.priorityCount}>{stats.byPriority[3]}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Database Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💾 Database Info</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Todos:</Text>
              <Text style={styles.infoValue}>{todos.length}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Categories:</Text>
              <Text style={styles.infoValue}>{categories.length}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Tags:</Text>
              <Text style={styles.infoValue}>{tags.length}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Database:</Text>
              <Text style={styles.infoValue}>redux-firefly-example.db</Text>
            </View>
          </View>
        </View>

        {/* Bulk Actions Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔧 Bulk Actions</Text>

          <TouchableOpacity
            onPress={handleDeleteCompleted}
            style={[styles.actionButton, styles.dangerButton]}
            disabled={stats.completed === 0}
          >
            <Text style={styles.actionButtonText}>
              🗑️ Delete Completed Todos ({stats.completed})
            </Text>
          </TouchableOpacity>

          <Text style={styles.actionHint}>
            This demonstrates bulk DELETE operations using redux-firefly
          </Text>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ℹ️ About</Text>

          <View style={styles.aboutCard}>
            <Text style={styles.aboutTitle}>Redux Firefly Example</Text>
            <Text style={styles.aboutText}>
              This app demonstrates all redux-firefly features:
            </Text>
            <Text style={styles.featureText}>✓ INSERT operations (optimistic & simple)</Text>
            <Text style={styles.featureText}>✓ UPDATE with commit/rollback</Text>
            <Text style={styles.featureText}>✓ DELETE (single & bulk)</Text>
            <Text style={styles.featureText}>✓ SELECT queries</Text>
            <Text style={styles.featureText}>✓ RAW SQL (joins & aggregates)</Text>
            <Text style={styles.featureText}>✓ Transactions</Text>
            <Text style={styles.featureText}>✓ Hydration from SQLite</Text>
            <Text style={styles.featureText}>✓ FireflyGate integration</Text>

            <TouchableOpacity
              onPress={() => Linking.openURL('https://github.com/yourusername/redux-firefly')}
              style={styles.linkButton}
            >
              <Text style={styles.linkButtonText}>
                📚 View Documentation
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  priorityStats: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  priorityStatsTitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 12,
  },
  priorityRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  priorityItem: {
    alignItems: 'center',
  },
  priorityBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  priorityBadgeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  priorityCount: {
    fontSize: 18,
    fontWeight: '600',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  infoLabel: {
    fontSize: 16,
    color: '#8E8E93',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  dangerButton: {
    backgroundColor: '#FF3B30',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  actionHint: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
  },
  aboutCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  aboutTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  aboutText: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#000000',
    marginBottom: 6,
  },
  linkButton: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
