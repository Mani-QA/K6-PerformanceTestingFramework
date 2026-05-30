/**
 * Configuration Loader Utility
 * 
 * Strict K6 constraint: the open() function can only accept literal strings resolved
 * statically during execution compilation (Goja). Dynamic paths are not supported.
 * To circumvent this, we open all environment configuration files statically at the module 
 * level and return the chosen mapping dynamically at execution runtime.
 */

// Statically open all environment configs
const defaultJson = JSON.parse(open('../config/default.json'));
const stagingJson = JSON.parse(open('../config/staging.json'));
const productionJson = JSON.parse(open('../config/production.json'));

export function loadConfig() {
  const envName = __ENV.K6_ENV || 'staging';
  let config;

  if (envName === 'production') {
    config = productionJson;
  } else if (envName === 'staging') {
    config = stagingJson;
  } else {
    config = defaultJson;
  }

  // Allow environment variables to dynamically override properties (e.g. in CI/CD pipeline)
  if (__ENV.K6_BASE_URL) {
    config.baseUrl = __ENV.K6_BASE_URL;
  }
  if (__ENV.K6_TIMEOUT) {
    config.timeout = __ENV.K6_TIMEOUT;
  }
  if (__ENV.K6_MAX_REDIRECTS) {
    config.maxRedirects = parseInt(__ENV.K6_MAX_REDIRECTS, 10);
  }

  return config;
}
