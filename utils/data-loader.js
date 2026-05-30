/**
 * Test Data Loader Utility
 * 
 * Safely parses the static mock users payload.
 * Provides helper utilities for parameterizing iterations across active scenarios.
 */

import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// Statically open both CSV and JSON data sources to satisfy K6 compile requirements
const usersJsonData = JSON.parse(open('../data/users.json'));
const usersCsvRaw = open('../data/users.csv');

export function loadTestData() {
  const format = __ENV.K6_DATA_FORMAT || 'json';

  if (format === 'csv') {
    const parsed = papaparse.parse(usersCsvRaw, { header: true });
    // Filter out potential blank trailing lines and map columns to their expected types
    return parsed.data
      .filter(row => row.id && row.username)
      .map(row => ({
        id: parseInt(row.id, 10),
        username: row.username,
        role: row.role
      }));
  }

  return usersJsonData;
}

/**
 * Returns a random user from the dataset.
 */
export function getRandomUser(data) {
  const index = Math.floor(Math.random() * data.length);
  return data[index];
}

/**
 * Returns a user sequentially based on the unique VU ID.
 * Ensuring different VUs receive unique inputs.
 */
export function getVuSequentialUser(data, vuId) {
  const index = (vuId - 1) % data.length;
  return data[index];
}
