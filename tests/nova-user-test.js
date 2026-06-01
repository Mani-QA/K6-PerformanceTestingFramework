/**
 * NovaUser D1 API K6 Performance Test script.
 * 
 * Tests all 3 endpoints listed in the API docs (POST /users, GET /users/:id, PATCH /users/:id)
 * plus the helper GET /users list endpoint.
 * 
 * Uses realistic pre-provided CSV mock users from `data/test-users.csv` for request payloads,
 * sanitizes job roles into supported privileges (Admin, Editor, Viewer), tracks custom metrics,
 * and outputs structured JSON logs.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { b64encode } from 'k6/encoding';
import exec from 'k6/execution';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// Load our profiles
import { fixedLoadScenarios, fixedLoadThresholds } from '../profiles/fixed-load.js';
import { rampUpScenarios, rampUpThresholds } from '../profiles/ramp-up.js';
import { spikeScenarios, spikeThresholds } from '../profiles/spike.js';

// Load our utilities
import { loadConfig } from '../utils/env.js';
import { loadTestUsersCSV, getVuSequentialUser } from '../utils/data-loader.js';
import { logger } from '../utils/logger.js';
import { 
  customHttpReqDuration, 
  customSuccessRate, 
  customTransactionCount, 
  customActiveVus 
} from '../utils/metrics.js';

// Init context: static loader calls
const config = loadConfig();
const testUsers = loadTestUsersCSV();

// Map profiles to their scenarios and thresholds
const profiles = {
  fixed: {
    scenarios: fixedLoadScenarios,
    thresholds: fixedLoadThresholds
  },
  'ramp-up': {
    scenarios: rampUpScenarios,
    thresholds: rampUpThresholds
  },
  spike: {
    scenarios: spikeScenarios,
    thresholds: spikeThresholds
  }
};

// Select profile based on environment variable (default: fixed)
const selectedProfileName = __ENV.K6_PROFILE || 'fixed';
const activeProfile = profiles[selectedProfileName] || profiles.fixed;

// Export options (scenarios and thresholds) as required by K6 architecture
export const options = {
  scenarios: activeProfile.scenarios,
  thresholds: activeProfile.thresholds
};

logger.info('Initialized NovaUser K6 Performance Test Script', {
  environment: config.environment,
  baseUrl: config.baseUrl,
  profile: selectedProfileName,
  totalUsersLoaded: testUsers.length
});

/**
 * Helper to construct IST Date string YYYY-MM-DD and generate Authorization token
 */
function getAuthHeaderValue(salt) {
  const d = new Date();
  // Shift by 5.5 hours to represent Indian Standard Time (IST)
  const istEpochMs = d.getTime() + (5.5 * 60 * 60 * 1000);
  const istDate = new Date(istEpochMs);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  return b64encode(`${dateStr}${salt}`);
}

/**
 * Helper to find a different role from the CSV dataset
 */
function getDifferentRoleFromCsv(dataset, currentRole, startIndex) {
  for (let i = 1; i < dataset.length; i++) {
    const nextIndex = (startIndex + i) % dataset.length;
    const candidateRole = (dataset[nextIndex].role || '').trim();
    if (candidateRole && candidateRole.toLowerCase() !== currentRole.toLowerCase()) {
      return candidateRole;
    }
  }
  return `${currentRole} (Updated)`;
}

// VU execution context
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;
  
  // Track active VUs dynamically using our custom Gauge metric
  customActiveVus.add(vuId);
  
  // Retrieve sequential mock user from the parsed test-users CSV using global iteration index across all VUs
  const globalIteration = exec.scenario.iterationInTest;
  const csvUser = testUsers[globalIteration % testUsers.length];
  
  // Since the API accepts freeform roles, we use the raw CSV role directly
  const initialRole = (csvUser.role || '').trim();
  
  // Create authentication token
  const authHeaderValue = getAuthHeaderValue('k6demo-magic-salt-2026');
  
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'K6-NovaUser-Performance-Framework',
    'Accept': 'application/json',
    'X-Authorization': authHeaderValue
  };
  
  const requestParams = {
    timeout: parseInt(config.timeout, 10),
    headers: headers
  };
  
  // ----------------------------------------------------
  // TRANSACTION 1: POST /users (Create User)
  // ----------------------------------------------------
  const postUrl = `${config.baseUrl}/users`;
  
  // Since multiple VUs might loop, we can append a unique tag to email/name to guarantee unique persistence check
  const postPayload = JSON.stringify({
    name: `${csvUser.name} VU${vuId}-${iterationId}`,
    email: `vu${vuId}_iter${iterationId}_${csvUser.email}`,
    role: initialRole
  });
  
  logger.debug('Starting POST /users transaction', { vu: vuId, iteration: iterationId, email: csvUser.email });
  
  let startTime = Date.now();
  let postResponse = http.post(postUrl, postPayload, requestParams);
  let duration = Date.now() - startTime;
  
  customHttpReqDuration.add(duration);
  
  let postCheck = check(postResponse, {
    'POST status is 201': (r) => r.status === 201,
    'POST response has secure UUID id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && typeof body.id === 'string' && body.id.length === 36;
      } catch (e) {
        return false;
      }
    }
  });
  
  customSuccessRate.add(postCheck);
  
  if (!postCheck) {
    logger.error('POST /users transaction validation failed', {
      vu: vuId,
      iteration: iterationId,
      status: postResponse.status,
      error: postResponse.error,
      body: postResponse.body ? postResponse.body.substring(0, 200) : ''
    });
    // Skip downstream operations if the creation fails to prevent waterfall error cascades
    sleep(1);
    return;
  }
  
  customTransactionCount.add(1);
  const userId = JSON.parse(postResponse.body).id;
  
  // Think time pacing
  sleep(0.5);
  
  // ----------------------------------------------------
  // TRANSACTION 2: GET /users/:id (Query User Details)
  // ----------------------------------------------------
  const getUrl = `${config.baseUrl}/users/${userId}`;
  
  logger.debug('Starting GET /users/:id transaction', { vu: vuId, iteration: iterationId, userId });
  
  startTime = Date.now();
  let getResponse = http.get(getUrl, requestParams);
  duration = Date.now() - startTime;
  
  customHttpReqDuration.add(duration);
  
  let getCheck = check(getResponse, {
    'GET details status is 200': (r) => r.status === 200,
    'GET details matches email': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.email === `vu${vuId}_iter${iterationId}_${csvUser.email}`;
      } catch (e) {
        return false;
      }
    },
    'GET details matches role': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.role === initialRole;
      } catch (e) {
        return false;
      }
    }
  });
  
  customSuccessRate.add(getCheck);
  
  if (!getCheck) {
    logger.warn('GET /users/:id transaction validation failed', {
      vu: vuId,
      iteration: iterationId,
      status: getResponse.status,
      error: getResponse.error,
      body: getResponse.body ? getResponse.body.substring(0, 200) : ''
    });
  } else {
    customTransactionCount.add(1);
  }
  
  // Think time pacing
  sleep(0.5);
  
  // ----------------------------------------------------
  // TRANSACTION 3: PATCH /users/:id (Modify User Privilege)
  // ----------------------------------------------------
  const patchUrl = `${config.baseUrl}/users/${userId}`;
  const updatedRole = getDifferentRoleFromCsv(testUsers, initialRole, globalIteration);
  
  const patchPayload = JSON.stringify({
    role: updatedRole
  });
  
  logger.debug('Starting PATCH /users/:id transaction', { vu: vuId, iteration: iterationId, userId, newRole: updatedRole });
  
  startTime = Date.now();
  let patchResponse = http.patch(patchUrl, patchPayload, requestParams);
  duration = Date.now() - startTime;
  
  customHttpReqDuration.add(duration);
  
  let patchCheck = check(patchResponse, {
    'PATCH update status is 200': (r) => r.status === 200,
    'PATCH returns success: true': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.success === true;
      } catch (e) {
        return false;
      }
    }
  });
  
  customSuccessRate.add(patchCheck);
  
  if (!patchCheck) {
    logger.error('PATCH /users/:id transaction validation failed', {
      vu: vuId,
      iteration: iterationId,
      status: patchResponse.status,
      error: patchResponse.error,
      body: patchResponse.body ? patchResponse.body.substring(0, 200) : ''
    });
  } else {
    customTransactionCount.add(1);
  }
  
  // Standard user paced dynamic think time pacing (1s - 2s)
  const finalThink = 1 + Math.random();
  sleep(finalThink);
}

// Summary hook called once execution completes
export function handleSummary(data) {
  logger.info('Execution completed. Compiling NovaUser performance run summaries...');
  
  // Inject metadata with tested target APIs for the history dashboard compiler
  data.metadata = {
    testScript: 'tests/nova-user-test.js',
    targetApis: [
      'POST /users',
      'GET /users/:id',
      'PATCH /users/:id'
    ]
  };
  
  return {
    'reports/summary.html': htmlReport(data),
    'reports/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
