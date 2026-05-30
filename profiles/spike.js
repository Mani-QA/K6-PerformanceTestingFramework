/**
 * Spike Load Profile
 * A sudden, extreme traffic burst followed by rapid decay to test system recovery.
 */

const targetSpikeMax = __ENV.K6_SPIKE_VUS ? parseInt(__ENV.K6_SPIKE_VUS, 10) : 10;
const baselineVus = Math.max(1, Math.floor(targetSpikeMax * 0.2)); // 20% of spike

export const spikeScenarios = {
  spike_test_scenario: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '5s', target: baselineVus },    // Low baseline
      { duration: '5s', target: targetSpikeMax }, // Sudden spike
      { duration: '10s', target: targetSpikeMax }, // Hold high traffic burst
      { duration: '5s', target: baselineVus },    // Rapid recovery
      { duration: '5s', target: 0 },              // Cool down
    ],
    gracefulRampDown: '5s',
  }
};

export const spikeThresholds = {
  http_req_failed: ['rate < 0.20'], // Allow up to 20% errors under sudden spike
  http_req_duration: ['p(95) < 5000'], // Widen budget to 5000ms for extreme traffic bursts
  custom_success_rate: ['rate > 0.80'], // Allow up to 20% failed validations
};
