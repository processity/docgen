// Jest global setup file
// This file is executed before all tests run

// Load environment variables from .env file FIRST
import { config } from 'dotenv';
config();

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests

// Set default AAD config for tests if not already set
// These values are mocked by the tests, but the config needs them to initialize the verifier
if (!process.env.AZURE_TENANT_ID) {
  process.env.AZURE_TENANT_ID = 'test-tenant-id';
}
if (!process.env.ISSUER) {
  process.env.ISSUER = 'https://login.microsoftonline.com/test-tenant-id/v2.0';
}
if (!process.env.AUDIENCE) {
  process.env.AUDIENCE = 'api://test-client-id';
}
if (!process.env.JWKS_URI) {
  process.env.JWKS_URI = 'https://login.microsoftonline.com/test-tenant-id/discovery/v2.0/keys';
}

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
