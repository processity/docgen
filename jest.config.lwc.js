const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
  ...jestConfig,
  modulePathsToSearch: ['<rootDir>/force-app/main/default/lwc'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'force-app/main/default/lwc/**/*.js',
    '!force-app/main/default/lwc/**/__tests__/**',
    '!force-app/main/default/lwc/**/*.test.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
