// Jest global setup file
// This file is executed before all tests run

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to keep test output clean (optional)
global.console = {
  ...console,
  // Uncomment to suppress logs in tests:
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
