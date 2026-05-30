/**
 * Structured Logging Utility
 * 
 * Under heavy performance testing, logs should be structured as structured JSON to 
 * make searching, ingestion, and dashboard filtering (Datadog, Loki, Elasticsearch) trivial.
 */

export const logger = {
  info: (message, context = {}) => {
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  },

  warn: (message, context = {}) => {
    console.warn(JSON.stringify({
      level: 'WARN',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  },

  error: (message, context = {}) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  },

  debug: (message, context = {}) => {
    console.log(JSON.stringify({
      level: 'DEBUG',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  }
};
