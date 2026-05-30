# K6 Performance Testing Boilerplate Framework

A complete, production-ready, modular performance testing framework built on **Grafana K6** adhering strictly to official performance engineering design patterns and best practices.

---

## Functional Features
* **Multi-Scenario Architecture**: Built-in support for different testing profiles including **Fixed Load** (baseline), **Ramp-up** (stepped stress loading), and **Spike** (extreme surge and recovery tracking).
* **Decoupled Configuration System**: Independent environment targets (`staging` vs `production`) loaded dynamically through JSON files and overridden by system environment variables.
* **K6 Safe Loader Implementation**: Resolves K6 compilation limitations by loading all environment configs statically via literal `open()` imports and dynamically routing them at runtime execution.
* **Structured JSON Logging**: Custom logging helper formatting stdout as structured JSON to ensure high-load tracking details are readily ingestible by Datadog, Grafana Loki, or Elasticsearch.
* **Custom Performance Metrics**: Tracks transaction throughput and latency metrics using custom Grafana metrics:
  * `custom_http_req_duration_ms` (Trend)
  * `custom_success_rate` (Rate)
  * `custom_transaction_count` (Counter)
  * `custom_active_vus` (Gauge)
* **Multi-Format Data Parameterization**: Parameterize test scenarios by loading test credentials dynamically from either a JSON array or a CSV file (parsed using the K6-optimized PapaParse library), toggled simply via environment variables.
* **Build Failure Gates**: Fine-grained error rate and latency percentile validation gates (checks and thresholds) that raise failure exit codes to cleanly halt CI/CD merges.
* **Automated Summary Reporting**: Exports standard JSON summaries alongside beautifully rendered visual HTML report dashboards natively via the K6 `handleSummary` hook.

---

## 🚀 Beginner-Friendly Customization Guide

This framework is built to be extremely flexible. You can customize test scenarios, input datasets, and load intensities **without rewriting any core test logic**.

### 1. Adjusting Scenario Profiles (Fixed, Stress, or Spike)
The load shape is defined inside the files under the `profiles/` directory.

* **Fixed Baseline Profile (`profiles/fixed-load.js`)**:
  * Edit the `vus` (Virtual Users) and `duration` values directly:
    ```javascript
    vus: 10,       // Number of concurrent simulated users
    duration: '30s' // Test duration (e.g. '30s', '5m', '1h')
    ```
* **Stress (Ramp-up) Profile (`profiles/ramp-up.js`)**:
  * Steps up the load gradually. Adjust the `stages` targets and times:
    ```javascript
    stages: [
      { duration: '10s', target: 20 }, // Ramp from 0 to 20 VUs in 10s
      { duration: '15s', target: 50 }, // Ramp from 20 to 50 VUs in 15s
      { duration: '20s', target: 50 }, // Maintain 50 VUs for 20s
      { duration: '10s', target: 0 },  // Cool down back to 0 in 10s
    ]
    ```
* **Spike Profile (`profiles/spike.js`)**:
  * Simulates a sudden traffic surge. Edit stage target peaks to check auto-scaling latency.

### 2. Modifying Your Test Datasets
You can customize the credentials, API paths, or dynamic fields fed to your tests in two simple formats:
* **JSON Format (`data/users.json`)**:
  Add, remove, or modify user records. Ensure they follow the structured layout:
  ```json
  [
    { "id": 1, "username": "your_custom_user", "role": "admin" }
  ]
  ```
* **CSV Format (`data/users.csv`)**:
  Add rows below the header column names (`id,username,role`):
  ```csv
  id,username,role
  1,your_custom_user,admin
  ```
* *Note: The data-loader automatically loops through this array sequentially, ensuring VUs receive separate credentials and do not step on each other.*

---

## ⚡ Command-Line Execution & Overrides

You can override virtual users, durations, and stages directly from your command line **without changing any code in your files**.

### Option A: Native K6 Command-Line Overrides (Ad-Hoc Running)
Passing native K6 flags automatically bypasses all profiles, scenario structures, and thresholds in favor of a quick, custom ad-hoc execution:

* **Override VUs and Duration on-the-fly**:
  ```bash
  # Run a simple test using 25 Virtual Users for 45 seconds
  k6 run --vus 25 --duration 45s tests/api-test.js
  ```
* **Override Ramping Stages on-the-fly**:
  ```bash
  # Ramp up to 10 VUs in 5s, scale to 30 VUs in 10s, cool down in 5s
  k6 run --stage 5s:10,10s:30,5s:0 tests/api-test.js
  ```

### Option B: Structured Scenario Scaling (Profile-Preserved Overrides)
If you want to keep the custom assertions/thresholds and multi-stage shape of your structured profiles but scale their intensity, pass environment variables:

* **Fixed Baseline Profile: Custom VUs & Duration**:
  ```bash
  # Scale Fixed Baseline scenario to 50 concurrent VUs for 2 minutes
  npx cross-env K6_VUS=50 K6_DURATION=2m npm run test:fixed:staging
  ```
* **Stress (Ramp-up) Profile: Scale the Peak Load**:
  ```bash
  # Scale peak load of your stress ramping stages to 150 VUs (ratios auto-adjust)
  npx cross-env K6_MAX_VUS=150 npm run test:rampup:staging
  ```
* **Spike Profile: Scale the Peak Surge**:
  ```bash
  # Scale maximum traffic burst peak of your spike stages to 300 VUs
  npx cross-env K6_SPIKE_VUS=300 npm run test:spike:staging
  ```

---

## User Guide

### 1. Local Prerequisites
You must have the following tools installed on your local workstation:
* **K6 CLI Engine**: Install via homebrew (`brew install k6`), scoop (`scoop install k6`), winget (`winget install gnu.k6`), or direct binary downloads.
* **Node.js LTS (v20+)**: Required for running the task automation script runners.

### 2. Framework Installation
Clone the repository and install developer support packages:
```bash
# Install cross-env and support tools
npm install
```

### 3. Executing Tests Locally
The framework includes convenient scripts to easily select execution targets:

#### Run Fixed Baseline Load:
* Run against **Staging**:
  ```bash
  npm run test:fixed:staging
  ```
* Run against **Production**:
  ```bash
  npm run test:fixed:prod
  ```

#### Run Stress (Ramp-up) Test:
* Run against **Staging**:
  ```bash
  npm run test:rampup:staging
  ```
* Run against **Production**:
  ```bash
  npm run test:rampup:prod
  ```

#### Run Traffic Spike Test:
* Run against **Staging**:
  ```bash
  npm run test:spike:staging
  ```
* Run against **Production**:
  ```bash
  npm run test:spike:prod
  ```

#### Select Data Input Format (CSV or JSON)
By default, the framework runs with **JSON** format. You can switch to **CSV** data parsing by passing the `K6_DATA_FORMAT=csv` environment variable prefix:
* Run with **CSV** data format:
  ```bash
  npx cross-env K6_DATA_FORMAT=csv k6 run tests/api-test.js
  ```
* Or combine it with our script runners:
  ```bash
  npx cross-env K6_DATA_FORMAT=csv npm run test:fixed:staging
  ```

---

## Architecture Information

### Technical Breakdown & Data Flow
The framework is designed to bypass K6 execution engine boundaries while preserving standard software design principles.

```mermaid
graph TD
    A[Environment Variables] -->|K6_ENV & K6_PROFILE & K6_DATA_FORMAT| B(tests/api-test.js)
    C[config/staging.json] -->|Static Literal Import| D(utils/env.js)
    E[config/production.json] -->|Static Literal Import| D
    F[config/default.json] -->|Static Literal Import| D
    D -->|loadConfig| B
    G1[data/users.json] -->|Static Loader open| H(utils/data-loader.js)
    G2[data/users.csv] -->|Static Loader open| H
    H -->|getVuSequentialUser| B
    B -->|Import Options| I[profiles/fixed-load.js]
    B -->|Import Options| J[profiles/ramp-up.js]
    B -->|Import Options| K[profiles/spike.js]
    B -->|API Traffic Requests| L[Target Endpoint: httpbin.test.k6.io]
    B -->|Record Metrics| M(utils/metrics.js)
    B -->|Write JSON Logs| N(utils/logger.js)
    B -->|handleSummary| O[reports/summary.html & summary.json]
```

1. **Compilation Phase**:
   * K6 scans the scripts and compiles the files.
   * `utils/env.js` imports all environment profiles using the mandatory literal string path `open()` syntax.
   * `utils/data-loader.js` loads `users.json` and `users.csv` statically.
2. **Setup/Init Phase**:
   * `tests/api-test.js` resolves the environment variables `__ENV.K6_ENV` and `__ENV.K6_PROFILE`.
   * The active load profile is resolved, and its scenarios and thresholds options are exported.
3. **Execution Phase**:
   * Virtual Users (VUs) execute the test loops.
   * Dynamic data loader allocates unique, sequential users to each VU iteration using `getVuSequentialUser(data, __VU)`.
   * Standard and custom metrics (`Trend`, `Rate`, `Counter`, `Gauge`) are captured on each HTTP response check.
   * On validation failure, a structured JSON entry is written to stdout.
4. **Summary & Reporting Phase**:
   * On completion, K6 invokes `handleSummary()`.
   * HTML summary pages and JSON telemetry snapshots are written directly to the `reports/` folder.

---

## Tech Stack
* **Core Engine**: Grafana K6 (Goja JS runtime engine)
* **Standard Specifications**: ES6 Modules (import/export syntax)
* **Reporting Extensions**: `k6-reporter` (HTML) and `k6-summary` (JSON)
* **Log Formatting**: JSON Structured Logging
* **Automation**: GitHub Actions & npm scripts

---

## Pending Features and Roadmap
* [x] **Data Parameterization Expansion**: Integrate CSV file streams for structured datasets using PapaParse.
* [ ] **Distributed Execution Setup**: Configure Kubernetes K6 Operator templates for orchestrating cloud-scale distributed tests.
* [ ] **API Gateway Integrations**: Add automated OpenID Connect/OAuth2 authentication token renewal routines inside the K6 `setup()` hook.
* [ ] **Telemetry Ingestion Hook**: Export live testing statistics straight to Prometheus/InfluxDB for real-time visualization in Grafana dashboards.
