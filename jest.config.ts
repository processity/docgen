import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      // Target thresholds achieved via test coverage improvement (Phase 1-3)
      // Behavior-focused testing ensures robustness across all critical paths
      // Functions at 68% due to server.ts startup/shutdown code (lines 39-69)
      // which cannot be tested without launching the actual server process
      lines: 70,
      functions: 68,
      branches: 60,
      statements: 70,
    },
  },
  coverageDirectory: 'coverage',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  verbose: false,
  testTimeout: 10000,
  maxWorkers: 1, // Run tests sequentially to avoid LibreOffice converter resource conflicts
};

export default config;
