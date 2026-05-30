/**
 * Main K6 Performance Test script.
 * Decouples logic from environments and load profiles, uses advanced multi-scenarios executors,
 * tracks custom metrics, and logs transactions cleanly in JSON.
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
import { loadTestData, getVuSequentialUser } from '../utils/data-loader.js';
import { logger } from '../utils/logger.js';
import { 
  customHttpReqDuration, 
  customSuccessRate, 
  customTransactionCount, 
  customActiveVus 
} from '../utils/metrics.js';

// Init context: static loader calls
const config = loadConfig();
const testData = loadTestData();

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

logger.info('Initialized K6 Performance Test Framework', {
  environment: config.environment,
  baseUrl: config.baseUrl,
  profile: selectedProfileName,
  totalUsersLoaded: testData.length
});

// VU execution context
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;
  
  // Load dynamic parameterized user for this specific VU iteration sequentially
  const user = getVuSequentialUser(testData, vuId);
  
  // Track active VUs dynamically using our custom Gauge metric
  customActiveVus.add(vuId);
  
  // ----------------------------------------------------
  // TRANSACTION 1: GET REQUEST
  // ----------------------------------------------------
  const getUrl = `${config.baseUrl}/get?userId=${user.id}&username=${user.username}&role=${user.role}`;
  const params = {
    timeout: parseInt(config.timeout, 10),
    headers: {
      'User-Agent': 'K6-Performance-Framework',
      'Accept': 'application/json'
    }
  };
  
  logger.debug('Starting GET transaction', { vu: vuId, iteration: iterationId, url: getUrl });
  
  let startTime = Date.now();
  let getResponse = http.get(getUrl, params);
  let duration = Date.now() - startTime;
  
  // Record custom trend metric (HTTP request latency)
  customHttpReqDuration.add(duration);
  
  // Perform checks
  let getCheck = check(getResponse, {
    'GET Status is 200': (r) => r.status === 200,
    'GET Content-Type is JSON': (r) => {
      const ct = r.headers['Content-Type'] || r.headers['content-type'] || '';
      return ct.includes('application/json');
    },
    'GET Payload validates user': (r) => {
      try {
        const json = JSON.parse(r.body);
        return json.args.username === user.username;
      } catch (e) {
        return false;
      }
    }
  });
  
  // Track custom Success Rate (adding true/false boolean)
  customSuccessRate.add(getCheck);
  
  if (!getCheck) {
    logger.warn('GET transaction validation failed', {
      vu: vuId,
      iteration: iterationId,
      status: getResponse.status,
      error: getResponse.error,
      body: getResponse.body ? getResponse.body.substring(0, 200) : ''
    });
  } else {
    // Increment success counter
    customTransactionCount.add(1);
  }
  
  // Simulating typical user pacing think time
  sleep(1);
  
  // ----------------------------------------------------
  // TRANSACTION 2: POST REQUEST
  // ----------------------------------------------------
  const postUrl = `${config.baseUrl}/post`;
  const postPayload = JSON.stringify({
    userId: user.id,
    action: 'perf_transaction',
    timestamp: new Date().toISOString(),
    client: 'k6-perf-agent'
  });
  
  const postParams = {
    timeout: parseInt(config.timeout, 10),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'K6-Performance-Framework',
      'Accept': 'application/json'
    }
  };
  
  logger.debug('Starting POST transaction', { vu: vuId, iteration: iterationId, url: postUrl });
  
  startTime = Date.now();
  let postResponse = http.post(postUrl, postPayload, postParams);
  duration = Date.now() - startTime;
  
  customHttpReqDuration.add(duration);
  
  let postCheck = check(postResponse, {
    'POST Status is 200': (r) => r.status === 200,
    'POST Payload echoes body': (r) => {
      try {
        const json = JSON.parse(r.body);
        const echoed = json.json || JSON.parse(json.data);
        return echoed.userId === user.id && echoed.action === 'perf_transaction';
      } catch (e) {
        return false;
      }
    }
  });
  
  customSuccessRate.add(postCheck);
  
  if (!postCheck) {
    logger.error('POST transaction validation failed', {
      vu: vuId,
      iteration: iterationId,
      status: postResponse.status,
      error: postResponse.error,
      body: postResponse.body ? postResponse.body.substring(0, 200) : ''
    });
  } else {
    customTransactionCount.add(1);
  }
  
  // Dynamic random think time between 1 and 2 seconds
  const thinkTime = 1 + Math.random();
  sleep(thinkTime);
}

// Summary hook called once execution completes
export function handleSummary(data) {
  logger.info('Execution completed. Rending summary HTML and JSON reports...');
  
  return {
    'reports/summary.html': htmlReport(data),
    'reports/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
