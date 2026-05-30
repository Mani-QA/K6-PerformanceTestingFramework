/**
 * Custom Metrics Utility
 * 
 * Declares Trend, Rate, Counter, and Gauge metrics.
 * Using custom metrics allows rich diagnostic reporting and precise thresholds mapping.
 */

import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

// Trend: tracks percentiles, min, max, average response latencies
export const customHttpReqDuration = new Trend('custom_http_req_duration_ms');

// Rate: tracks percentage of successful transactions (true/false)
export const customSuccessRate = new Rate('custom_success_rate');

// Counter: tracks cumulative sum of successful operations completed
export const customTransactionCount = new Counter('custom_transaction_count');

// Gauge: tracks dynamic point-in-time value (like active virtual users load)
export const customActiveVus = new Gauge('custom_active_vus');
