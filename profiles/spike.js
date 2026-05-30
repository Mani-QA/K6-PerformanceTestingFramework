/**
 * Spike Load Profile
 * A sudden, extreme traffic burst followed by rapid decay to test system recovery.
 */

const targetSpikeMax = __ENV.K6_SPIKE_VUS ? parseInt(__ENV.K6_SPIKE_VUS, 10) : 100;
const baselineVus = Math.max(1, Math.floor(targetSpikeMax * 0.05)); // 5% of spike

export const spikeScenarios = {
  spike_test_scenario: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '5s', target: baselineVus },    // Low baseline
      { duration: '5s', target: targetSpikeMax }, // Extreme sudden spike
      { duration: '10s', target: targetSpikeMax }, // Hold high traffic burst
      { duration: '10s', target: baselineVus },    // Rapid drop/recovery
      { duration: '5s', target: 0 },              // Cool down
    ],
    gracefulRampDown: '5s',
  }
};

export const spikeThresholds = {
  http_req_failed: ['rate < 0.10'], // Fail build if error rate exceeds 10% during extreme spike
  http_req_duration: ['p(95) < 2000'], // Fail build if 95% of request latencies exceed 2000ms
  custom_success_rate: ['rate > 0.90'], // Custom success rate must be over 90%
};
