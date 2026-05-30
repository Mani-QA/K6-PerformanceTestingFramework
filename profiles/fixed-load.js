/**
 * Fixed Load Profile
 * Establishing a baseline: Constant VUs or arrival rate over a set duration.
 */

export const fixedLoadScenarios = {
  fixed_load_scenario: {
    executor: 'constant-vus',
    vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 10,
    duration: __ENV.K6_DURATION || '30s',
    gracefulStop: '5s',
  }
};

export const fixedLoadThresholds = {
  http_req_failed: ['rate < 0.01'], // Fail build if error rate exceeds 1%
  http_req_duration: ['p(95) < 500'], // Fail build if 95% of request latencies exceed 500ms
  custom_success_rate: ['rate > 0.99'], // Fail build if our custom success rate is under 99%
};
