const fs = require('fs');
const path = require('path');

// Target paths
const summaryPath = path.join(__dirname, '../reports/summary.json');
const historyDir = path.join(__dirname, '../history');
const runsJsonPath = path.join(historyDir, 'runs.json');
const indexPath = path.join(historyDir, 'index.html');
const reportsDir = path.join(historyDir, 'reports');

if (!fs.existsSync(summaryPath)) {
  console.error("Error: summary.json not found!");
  process.exit(1);
}

const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

// Parse environment and profile from K6 options/env
const envName = process.env.K6_ENV || 'staging';
const profileName = process.env.K6_PROFILE || 'fixed';
const timestamp = new Date();

// Convert to IST string
const istDateString = timestamp.toLocaleString('en-US', { 
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'medium'
});
const timestampId = timestamp.getTime();

// Parse metrics safely
const metrics = summaryData.metrics || {};
const httpReqsCount = metrics.http_reqs ? metrics.http_reqs.values.count : 0;
const httpReqFailed = metrics.http_req_failed ? metrics.http_req_failed.values.value : 0; // rate of failure (0 to 1)
const httpReqDurationP95 = metrics.http_req_duration ? metrics.http_req_duration.values['p(95)'] : 0;

const customSuccessRate = metrics.custom_success_rate ? metrics.custom_success_rate.values.value * 100 : 100;
const customTxCount = metrics.custom_transaction_count ? metrics.custom_transaction_count.values.count : 0;
const customDurationP95 = metrics.custom_http_req_duration_ms ? metrics.custom_http_req_duration_ms.values['p(95)'] : 0;

// Thresholds assessment
const checksPass = metrics.checks ? metrics.checks.values.passes : 0;
const checksFail = metrics.checks ? metrics.checks.values.fails : 0;
const checksTotal = checksPass + checksFail;
const checksSuccessRate = checksTotal > 0 ? (checksPass / checksTotal) * 100 : 100;

// Determine status based on thresholds
const passThresholds = (httpReqFailed < 0.05 && checksSuccessRate >= 95);
const runStatus = passThresholds ? 'PASSED' : 'FAILED';

// Define target APIs tested based on env
const targetApis = [
  `GET ${envName === 'production' ? 'https://httpbin.test.k6.io/get' : 'https://httpbin.test.k6.io/get'}`,
  `POST ${envName === 'production' ? 'https://httpbin.test.k6.io/post' : 'https://httpbin.test.k6.io/post'}`
];

// Create run entry
const newRun = {
  id: timestampId,
  timestamp: timestamp.toISOString(),
  timestampIST: istDateString,
  environment: envName.toUpperCase(),
  profile: profileName.toUpperCase(),
  status: runStatus,
  metrics: {
    totalRequests: httpReqsCount,
    failureRate: (httpReqFailed * 100).toFixed(2) + '%',
    p95LatencyMs: httpReqDurationP95.toFixed(2) + ' ms',
    customSuccessRate: customSuccessRate.toFixed(2) + '%',
    customTxCount: customTxCount,
    customP95LatencyMs: customDurationP95 ? customDurationP95.toFixed(2) + ' ms' : 'N/A',
    checks: `${checksPass} / ${checksTotal} (${checksSuccessRate.toFixed(2)}%)`
  },
  thresholds: [
    { name: "HTTP Errors Rate", expected: "< 5%", actual: (httpReqFailed * 100).toFixed(2) + '%', status: httpReqFailed < 0.05 ? 'PASSED' : 'FAILED' },
    { name: "95th Percentile Latency", expected: profileName === 'fixed' ? "< 500 ms" : (profileName === 'ramp-up' ? "< 1000 ms" : "< 2000 ms"), actual: httpReqDurationP95.toFixed(2) + ' ms', status: (profileName === 'fixed' && httpReqDurationP95 < 500) || (profileName === 'ramp-up' && httpReqDurationP95 < 1000) || (profileName === 'spike' && httpReqDurationP95 < 2000) ? 'PASSED' : 'FAILED' },
    { name: "Validations (Checks) Rate", expected: "> 95%", actual: checksSuccessRate.toFixed(2) + '%', status: checksSuccessRate >= 95 ? 'PASSED' : 'FAILED' }
  ],
  targetApis,
  reportPath: `reports/run-${timestampId}.html`
};

// Ensure directories exist
if (!fs.existsSync(historyDir)) {
  fs.mkdirSync(historyDir);
}
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir);
}

// Copy the latest HTML report
const sourceHtml = path.join(__dirname, '../reports/summary.html');
const destHtml = path.join(reportsDir, `run-${timestampId}.html`);
if (fs.existsSync(sourceHtml)) {
  fs.copyFileSync(sourceHtml, destHtml);
} else {
  fs.writeFileSync(destHtml, `<h1>Report Fallback for Run ${timestampId}</h1>`);
}

// Load existing history database
let history = [];
if (fs.existsSync(runsJsonPath)) {
  try {
    history = JSON.parse(fs.readFileSync(runsJsonPath, 'utf8'));
  } catch (e) {
    history = [];
  }
}

// Add new run to the start of history array
history.unshift(newRun);

// Filter out runs older than 30 days (30 * 24 * 60 * 60 * 1000 = 2592000000 ms)
const thirtyDaysAgo = Date.now() - 2592000000;
history = history.filter(run => new Date(run.timestamp).getTime() > thirtyDaysAgo);

// Save updated history list
fs.writeFileSync(runsJsonPath, JSON.stringify(history, null, 2));

// Prune report files that are no longer in active runs list
const activeReportPaths = new Set(history.map(run => path.basename(run.reportPath)));
const files = fs.readdirSync(reportsDir);
files.forEach(file => {
  if (file.endsWith('.html') && !activeReportPaths.has(file)) {
    try {
      fs.unlinkSync(path.join(reportsDir, file));
      console.log(`Pruned old report file: ${file}`);
    } catch (e) {
      console.error(`Failed to prune old report file ${file}:`, e);
    }
  }
});

// Compile and write dashboard index.html
const dashboardHtml = generateDashboard(history);
fs.writeFileSync(indexPath, dashboardHtml);

console.log(`Successfully added run ${timestampId} to history and rebuilt dashboard.`);

function generateDashboard(runs) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>K6 Performance Run History (30 Days)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-secondary: #111827;
      --bg-tertiary: #1f2937;
      --accent: #3b82f6;
      --text-primary: #f3f4f6;
      --text-secondary: #9ca3af;
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.1);
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.1);
      --border: #374151;
      --staging: #3b82f6;
      --staging-bg: rgba(59, 130, 246, 0.1);
      --production: #a855f7;
      --production-bg: rgba(168, 85, 247, 0.1);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    header {
      background-color: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .logo-badge {
      background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%);
      color: white;
      font-weight: 700;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      font-size: 1.1rem;
      letter-spacing: 0.05em;
    }
    
    header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      background: linear-gradient(to right, #f3f4f6, #9ca3af);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    header p {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    
    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    
    /* Left Pane - Sidebar */
    .sidebar {
      width: 380px;
      background-color: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    
    .search-container {
      padding: 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    
    .search-input {
      width: 100%;
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      color: var(--text-primary);
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .search-input:focus {
      border-color: var(--accent);
    }
    
    .runs-list {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .runs-list::-webkit-scrollbar {
      width: 6px;
    }
    
    .runs-list::-webkit-scrollbar-thumb {
      background-color: var(--border);
      border-radius: 3px;
    }
    
    .run-card {
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .run-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    
    .run-card.active {
      border-color: var(--accent);
      background-color: rgba(59, 130, 246, 0.05);
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.1);
    }
    
    .card-row-1 {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
    }
    
    .badge-passed {
      background-color: var(--success-bg);
      color: var(--success);
    }
    
    .badge-failed {
      background-color: var(--danger-bg);
      color: var(--danger);
    }
    
    .env-pill {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }
    
    .env-staging {
      background-color: var(--staging-bg);
      color: var(--staging);
    }
    
    .env-production {
      background-color: var(--production-bg);
      color: var(--production);
    }
    
    .card-row-2 {
      font-size: 0.875rem;
      color: var(--text-primary);
      font-weight: 500;
    }
    
    .card-row-3 {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    
    /* Right Pane - Details */
    .details-pane {
      flex: 1;
      background-color: var(--bg-primary);
      overflow-y: auto;
      padding: 2.5rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    
    .details-pane::-webkit-scrollbar {
      width: 6px;
    }
    
    .details-pane::-webkit-scrollbar-thumb {
      background-color: var(--border);
      border-radius: 3px;
    }
    
    .empty-state {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      color: var(--text-secondary);
      gap: 1rem;
    }
    
    .empty-state svg {
      width: 64px;
      height: 64px;
      stroke: var(--border);
    }
    
    .run-header-card {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header-details-left {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .run-title {
      font-size: 1.5rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .run-subtitle {
      color: var(--text-secondary);
      font-size: 0.95rem;
    }
    
    .btn-report {
      background-color: var(--accent);
      color: white;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.875rem;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: opacity 0.2s;
    }
    
    .btn-report:hover {
      opacity: 0.9;
    }
    
    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.25rem;
    }
    
    .metric-card {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .metric-card-label {
      color: var(--text-secondary);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 500;
    }
    
    .metric-card-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }
    
    /* Section Layout */
    .section-title {
      font-size: 1.1rem;
      font-weight: 600;
      border-left: 4px solid var(--accent);
      padding-left: 0.75rem;
      margin-bottom: 1rem;
      color: var(--text-primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .content-box {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.5rem;
    }
    
    /* Thresholds Table */
    .thresholds-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    
    .thresholds-table th, .thresholds-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    
    .thresholds-table th {
      color: var(--text-secondary);
      font-size: 0.8rem;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.05em;
    }
    
    .thresholds-table td {
      font-size: 0.9rem;
    }
    
    .table-status {
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .status-text-passed {
      color: var(--success);
    }
    
    .status-text-failed {
      color: var(--danger);
    }
    
    /* Target APIs */
    .api-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .api-item {
      font-family: monospace;
      font-size: 0.95rem;
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .method-badge {
      font-weight: 700;
      font-size: 0.75rem;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
    }
    
    .method-get {
      background-color: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }
    
    .method-post {
      background-color: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
    }
  </style>
</head>
<body>

  <header>
    <div class="logo-container">
      <span class="logo-badge">K6</span>
      <div>
        <h1>Performance Run History Dashboard</h1>
        <p>Continuous telemetry and regression tracking over the last 30 days</p>
      </div>
    </div>
    <div style="text-align: right;">
      <p style="font-weight: 500;">Active Environment Target: <span style="color:var(--accent);">Staging / Production</span></p>
      <p style="font-size:0.75rem; color:var(--text-secondary);">Last Generated: <span id="generation-time"></span></p>
    </div>
  </header>

  <div class="main-container">
    <!-- Left Sidebar -->
    <div class="sidebar">
      <div class="search-container">
        <input type="text" class="search-input" id="search" placeholder="Search by environment, profile, status...">
      </div>
      <div class="runs-list" id="runs-list-container">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- Right Pane -->
    <div class="details-pane" id="details-pane-container">
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
        </svg>
        <p>Select a performance execution run from the left panel to inspect detailed metrics.</p>
      </div>
    </div>
  </div>

  <script>
    // Embedded run database
    const runsHistory = ${JSON.stringify(runs)};
    
    document.getElementById('generation-time').innerText = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST';

    let activeRunId = null;

    function renderRunsList(filterText = '') {
      const container = document.getElementById('runs-list-container');
      container.innerHTML = '';
      
      const filtered = runsHistory.filter(run => {
        const term = filterText.toLowerCase();
        return run.environment.toLowerCase().includes(term) ||
               run.profile.toLowerCase().includes(term) ||
               run.status.toLowerCase().includes(term) ||
               run.timestampIST.toLowerCase().includes(term);
      });
      
      if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:2rem;font-size:0.875rem;">No runs match your search.</div>';
        return;
      }
      
      filtered.forEach(run => {
        const card = document.createElement('div');
        card.className = \`run-card \${activeRunId === run.id ? 'active' : ''}\`;
        card.onclick = () => selectRun(run.id);
        
        const envClass = run.environment === 'PRODUCTION' ? 'env-production' : 'env-staging';
        const badgeClass = run.status === 'PASSED' ? 'badge-passed' : 'badge-failed';
        
        card.innerHTML = \`
          <div class="card-row-1">
            <span class="env-pill \${envClass}">\${run.environment}</span>
            <span class="badge \${badgeClass}">\${run.status}</span>
          </div>
          <div class="card-row-2">Profile: \${run.profile}</div>
          <div class="card-row-3">
            <span>\${run.timestampIST} IST</span>
            <span>Reqs: \${run.metrics.totalRequests}</span>
          </div>
        \`;
        container.appendChild(card);
      });
    }

    function selectRun(runId) {
      activeRunId = runId;
      renderRunsList(document.getElementById('search').value);
      
      const run = runsHistory.find(r => r.id === runId);
      const detailsContainer = document.getElementById('details-pane-container');
      
      const badgeClass = run.status === 'PASSED' ? 'badge-passed' : 'badge-failed';
      const envClass = run.environment === 'PRODUCTION' ? 'env-production' : 'env-staging';
      
      let thresholdsRows = '';
      run.thresholds.forEach(t => {
        const statusClass = t.status === 'PASSED' ? 'status-text-passed' : 'status-text-failed';
        const indicator = t.status === 'PASSED' ? '✓' : '✗';
        thresholdsRows += \`
          <tr>
            <td><strong>\${t.name}</strong></td>
            <td>\${t.expected}</td>
            <td>\${t.actual}</td>
            <td><span class="table-status \${statusClass}">\${indicator} \${t.status}</span></td>
          </tr>
        \`;
      });
      
      let apiItems = '';
      run.targetApis.forEach(api => {
        const isPost = api.startsWith('POST');
        const badge = isPost ? '<span class="method-badge method-post">POST</span>' : '<span class="method-badge method-get">GET</span>';
        const url = api.replace(/^(GET|POST)\\s+/, '');
        apiItems += \`
          <li class="api-item">
            \${badge}
            <span>\${url}</span>
          </li>
        \`;
      });
      
      detailsContainer.innerHTML = \`
        <div class="run-header-card">
          <div class="header-details-left">
            <div class="run-title">
              Execution Run #\${run.id}
              <span class="badge \${badgeClass}">\${run.status}</span>
              <span class="env-pill \${envClass}">\${run.environment}</span>
            </div>
            <div class="run-subtitle">Executed on <strong>\${run.timestampIST} IST</strong> with profile <strong>\${run.profile}</strong></div>
          </div>
          <div>
            <a href="\${run.reportPath}" class="btn-report" target="_blank">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              View Standalone K6 HTML Report
            </a>
          </div>
        </div>

        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-card-label">Total Requests Fired</span>
            <span class="metric-card-value">\${run.metrics.totalRequests}</span>
          </div>
          <div class="metric-card">
            <span class="metric-card-label">95th Percentile Latency</span>
            <span class="metric-card-value">\${run.metrics.p95LatencyMs}</span>
          </div>
          <div class="metric-card">
            <span class="metric-card-label">HTTP Request Failure Rate</span>
            <span class="metric-card-value">\${run.metrics.failureRate}</span>
          </div>
          <div class="metric-card">
            <span class="metric-card-label">Validations Check Success</span>
            <span class="metric-card-value">\${run.metrics.customSuccessRate}</span>
          </div>
        </div>

        <div>
          <h3 class="section-title">Expected vs Actual Thresholds</h3>
          <div class="content-box">
            <table class="thresholds-table">
              <thead>
                <tr>
                  <th>Validation Objective</th>
                  <th>Expected Limit</th>
                  <th>Actual Result</th>
                  <th>Status Gate</th>
                </tr>
              </thead>
              <tbody>
                \${thresholdsRows}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 class="section-title">Target APIs Tested</h3>
          <div class="content-box">
            <ul class="api-list">
              \${apiItems}
            </ul>
          </div>
        </div>
      \`;
    }

    // Search input handler
    document.getElementById('search').addEventListener('input', (e) => {
      renderRunsList(e.target.value);
    });

    // Auto-select latest run if history exists
    if (runsHistory.length > 0) {
      activeRunId = runsHistory[0].id;
      renderRunsList();
      selectRun(activeRunId);
    } else {
      renderRunsList();
    }
  </script>
</body>
</html>`;
}
