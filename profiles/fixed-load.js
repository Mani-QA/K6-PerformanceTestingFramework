/**
 * Fixed Load Profile
 * Establishing a baseline: Constant VUs or arrival rate over a set duration.
 */

export const fixedLoadScenarios = {
  fixed_load_scenario: {
    executor: 'constant-vus',
    vus: __ENV.K6_VUS ? parseInt(__ENV.K6_VUS, 10) : 50,
    duration: __ENV.K6_DURATION || '60s',
    gracefulStop: '5s',
  }
};

export const fixedLoadThresholds = {
  http_req_failed: ['rate < 0.10'], // Allow up to 10% errors for public rate-limited endpoints
  http_req_duration: ['p(95) < 3000'], // Widen budget to 3000ms to avoid network jitter flakiness
  custom_success_rate: ['rate > 0.90'], // Allow up to 10% failed validations
};
