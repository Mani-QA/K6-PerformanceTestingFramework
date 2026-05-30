/**
 * Ramp-up (Stress) Load Profile
 * Gradual, stepped scaling of load over time to identify bottleneck thresholds.
 */

const targetVuMax = __ENV.K6_MAX_VUS ? parseInt(__ENV.K6_MAX_VUS, 10) : 50;
const targetVuMid = Math.floor(targetVuMax * 0.4);

export const rampUpScenarios = {
  stress_test_scenario: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: targetVuMid }, // Ramp up to 40% of max
      { duration: '15s', target: targetVuMax }, // Stepped escalation to max
      { duration: '20s', target: targetVuMax }, // Stress hold at max
      { duration: '10s', target: 0 },          // Cool down ramp down
    ],
    gracefulRampDown: '5s',
  }
};

export const rampUpThresholds = {
  http_req_failed: ['rate < 0.05'], // Fail build if error rate exceeds 5% under heavy stress
  http_req_duration: ['p(95) < 1000'], // Fail build if 95% of request latencies exceed 1000ms
  custom_success_rate: ['rate > 0.95'], // Custom rate must be over 95%
};
