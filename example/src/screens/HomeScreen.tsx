import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView } from 'react-native';

const examples = [
  {
    title: 'Drizzle + RTK',
    subtitle: 'Full-featured example',
    description: 'Uses createFireflySlice with Drizzle ORM queries, categories, tags, and relations.',
    icon: '🔥',
    route: 'DrizzleRTK',
    color: '#FF9500',
  },
  {
    title: 'RTK + Driver',
    subtitle: 'RTK with plain effects',
    description: 'Uses createFireflySlice with plain FireflyEffect objects and expoSQLiteDriver.',
    icon: '⚡',
    route: 'RTKDriver',
    color: '#007AFF',
  },
  {
    title: 'Plain Redux',
    subtitle: 'No toolkit',
    description: 'Uses vanilla Redux with createFirefly, withHydration, and expoSQLiteDriver.',
    icon: '🧱',
    route: 'PlainRedux',
    color: '#AF52DE',
  },
];

export default function HomeScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Redux Firefly</Text>
        <Text style={styles.subtitle}>Choose an example to explore</Text>

        {examples.map((example) => (
          <TouchableOpacity
            key={example.route}
            style={[styles.card, { borderLeftColor: example.color }]}
            onPress={() => navigation.navigate(example.route)}
            activeOpacity={0.7}
          >
            <Text style={styles.cardIcon}>{example.icon}</Text>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{example.title}</Text>
              <Text style={styles.cardSubtitle}>{example.subtitle}</Text>
              <Text style={styles.cardDescription}>{example.description}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 17,
    color: '#8E8E93',
    marginBottom: 32,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardIcon: {
    fontSize: 32,
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8E8E93',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#AEAEB2',
    lineHeight: 18,
  },
  chevron: {
    fontSize: 28,
    color: '#C7C7CC',
    marginLeft: 8,
  },
});
