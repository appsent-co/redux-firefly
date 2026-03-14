import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

export default [
  // Main bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        exclude: ['**/*.test.ts', '**/__tests__/**'],
      }),
    ],
    external: ['redux', 'expo-sqlite'],
  },
  // React bundle
  {
    input: 'src/react/index.ts',
    output: [
      {
        file: 'dist/react.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      {
        file: 'dist/react.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        exclude: ['**/*.test.ts', '**/__tests__/**'],
      }),
    ],
    external: ['redux', 'react', 'react-redux'],
  },
  // Toolkit bundle
  {
    input: 'src/toolkit/index.ts',
    output: [
      {
        file: 'dist/toolkit.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      {
        file: 'dist/toolkit.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        exclude: ['**/*.test.ts', '**/__tests__/**'],
      }),
    ],
    external: ['@reduxjs/toolkit', 'redux'],
  },
  // Main type definitions
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // React type definitions
  {
    input: 'src/react/index.ts',
    output: {
      file: 'dist/react.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Toolkit type definitions
  {
    input: 'src/toolkit/index.ts',
    output: {
      file: 'dist/toolkit.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Drizzle bundle
  {
    input: 'src/drizzle/index.ts',
    output: [
      {
        file: 'dist/drizzle.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      {
        file: 'dist/drizzle.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        exclude: ['**/*.test.ts', '**/__tests__/**'],
      }),
    ],
    external: ['drizzle-orm'],
  },
  // Drizzle type definitions
  {
    input: 'src/drizzle/index.ts',
    output: {
      file: 'dist/drizzle.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];
