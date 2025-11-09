import pino from 'pino';

/**
 * Get the log level from environment variables
 * Priority: LOG_LEVEL > NODE_ENV=test (silent) > default (info)
 */
function getLogLevel(): pino.Level | 'silent' {
  // If LOG_LEVEL is explicitly set, use it
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL as pino.Level;
  }

  // In test and CI environments, default to silent to reduce noise
  if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
    return 'silent';
  }

  // Default to info for development/production
  return 'info';
}

/**
 * Create a named logger with environment-aware log level
 * @param name - Logger name (used for filtering and debugging)
 * @returns Pino logger instance
 */
export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: getLogLevel(),
  });
}
