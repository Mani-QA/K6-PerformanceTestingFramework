/**
 * Fixed Load Profile
 * Establishing a baseline: Constant VUs or arrival rate over a set duration.
 */

export const fixedLoadScenarios = {
  fixed_load_scenario: {
    executor: 'constant-vus',
    vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 2,
    duration: __ENV.K6_DURATION || '10s',
    gracefulStop: '5s',
  }
};

export const fixedLoadThresholds = {
  http_req_failed: ['rate < 0.05'], // Allow up to 5% errors for public rate-limited endpoints
  http_req_duration: ['p(95) < 2000'], // Widen budget to 2s to avoid network jitter flakiness
  custom_success_rate: ['rate > 0.95'], // Allow up to 5% failed validations
};
