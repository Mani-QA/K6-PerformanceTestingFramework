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
 * Maps raw CSV job roles (e.g. "Product Designer") to valid API roles (Admin, Editor, Viewer).
 * Done deterministically to maintain user-level data balance.
 */
function getValidApiRole(csvRole) {
  const cleanRole = (csvRole || '').trim().toLowerCase();
  // Provide deterministic mapping based on string value
  const hash = cleanRole.length % 3;
  if (hash === 0) return 'Admin';
  if (hash === 1) return 'Editor';
  return 'Viewer';
}

/**
 * Helper to select a new role different from the current one to test PATCH transitions.
 */
function getAlternativeApiRole(currentRole) {
  if (currentRole === 'Admin') return 'Editor';
  if (currentRole === 'Editor') return 'Viewer';
  return 'Admin';
}

// VU execution context
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;
  
  // Track active VUs dynamically using our custom Gauge metric
  customActiveVus.add(vuId);
  
  // Retrieve sequential mock user from the parsed test-users CSV
  const csvUser = getVuSequentialUser(testUsers, vuId);
  
  // Map job title role to API supported roles
  const initialRole = getValidApiRole(csvUser.role);
  
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'K6-NovaUser-Performance-Framework',
    'Accept': 'application/json'
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
  const updatedRole = getAlternativeApiRole(initialRole);
  
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
  
  // Think time pacing
  sleep(0.5);
  
  // ----------------------------------------------------
  // TRANSACTION 4: GET /users (List / Search Directory Verification)
  // ----------------------------------------------------
  // Query directory by passing search parameter representing our specific unique user name
  const searchName = `${csvUser.name} VU${vuId}-${iterationId}`;
  const listUrl = `${config.baseUrl}/users?search=${encodeURIComponent(searchName)}`;
  
  logger.debug('Starting GET /users search transaction', { vu: vuId, iteration: iterationId, searchName });
  
  startTime = Date.now();
  let listResponse = http.get(listUrl, requestParams);
  duration = Date.now() - startTime;
  
  customHttpReqDuration.add(duration);
  
  let listCheck = check(listResponse, {
    'GET list status is 200': (r) => r.status === 200,
    'GET list returns matched user': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body) && body.length > 0 && body[0].id === userId;
      } catch (e) {
        return false;
      }
    }
  });
  
  customSuccessRate.add(listCheck);
  
  if (!listCheck) {
    logger.warn('GET /users list search transaction validation failed', {
      vu: vuId,
      iteration: iterationId,
      status: listResponse.status,
      body: listResponse.body ? listResponse.body.substring(0, 200) : ''
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
  
  return {
    'reports/summary.html': htmlReport(data),
    'reports/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
