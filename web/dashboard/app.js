const API_BASE = '';

let currentNodes = [];

const nodesListEl = document.getElementById('nodesList');
const nodesListOverviewEl = document.getElementById('nodesListOverview');
const clusterSummaryEl = document.getElementById('clusterSummary');
const nodeCountEl = document.getElementById('nodeCount');
const targetSelect = document.getElementById('target');
const actionSelect = document.getElementById('action');
const paramsRow = document.getElementById('paramsRow');
const paramsInput = document.getElementById('params');
const resultsEl = document.getElementById('results');
const metricsCardsEl = document.getElementById('metricsCards');
const commandForm = document.getElementById('commandForm');
const refreshBtn = document.getElementById('refreshNodes');
const runBtn = document.getElementById('runCmd');
const logsOutputEl = document.getElementById('logsOutput');

const PARAM_ACTIONS = ['restore', 'archive_commitlog'];

const MAX_METRICS_POINTS = 30;
const METRICS_POLL_INTERVAL_MS = 30000;
let metricsHistory = {};
let metricsCharts = {};
let metricsPollInterval = null;
const LOGS_POLL_INTERVAL_MS = 10000;
let logsPollInterval = null;

function setResults(text, isError) {
  resultsEl.textContent = text;
  resultsEl.style.display = text ? 'block' : 'none';
  resultsEl.classList.toggle('error', !!isError);
  resultsEl.classList.toggle('success', !isError);
  metricsCardsEl.style.display = 'none';
  metricsCardsEl.innerHTML = '';
}

function setMetricsCards(html) {
  metricsCardsEl.innerHTML = html;
  metricsCardsEl.style.display = html ? 'block' : 'none';
  if (html) resultsEl.style.display = 'none';
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function fetchNodes() {
  const res = await fetch(API_BASE + '/api/nodes');
  if (!res.ok) throw new Error('Failed to fetch nodes');
  return res.json();
}

function renderNodesList(nodes, container) {
  if (!container) return;
  if (nodes.length === 0) {
    container.innerHTML = '<p class="muted">No nodes connected.</p>';
    return;
  }
  container.innerHTML = nodes.map(n => `
    <div class="node-item">
      <div>
        <span class="ip">${escapeHtml(n.ip)}</span>
        ${n.hostname && n.hostname !== n.ip ? `<span class="meta"> · ${escapeHtml(n.hostname)}</span>` : ''}
      </div>
      <div class="meta">${escapeHtml(n.cluster || '-')} / ${escapeHtml(n.data_center || '-')}</div>
      <div class="status">Active</div>
    </div>
  `).join('');
}

function renderClusterSummary(nodes) {
  if (!clusterSummaryEl) return;
  if (nodes.length === 0) {
    clusterSummaryEl.innerHTML = '<p class="muted">No nodes connected.</p>';
    return;
  }
  const dcs = [...new Set(nodes.map(n => n.data_center || 'default').filter(Boolean))];
  clusterSummaryEl.innerHTML = `
    <div class="stat"><div class="stat-value">${nodes.length}</div><div class="stat-label">Nodes</div></div>
    <div class="stat"><div class="stat-value">${dcs.length}</div><div class="stat-label">Data centers</div></div>
    <div class="stat"><div class="stat-value">${nodes[0] && nodes[0].cluster ? escapeHtml(nodes[0].cluster) : '-'}</div><div class="stat-label">Cluster</div></div>
  `;
}

function populateTargetSelect(nodes) {
  const options = targetSelect.querySelectorAll('option:not([value=""])');
  options.forEach(o => o.remove());
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All nodes';
  targetSelect.insertBefore(allOpt, targetSelect.options[1] || null);
  nodes.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.ip;
    opt.textContent = n.hostname && n.hostname !== n.ip ? `${n.ip} (${n.hostname})` : n.ip;
    targetSelect.appendChild(opt);
  });
}

function renderNodes(nodes) {
  currentNodes = nodes || [];
  nodeCountEl.textContent = (nodes && nodes.length) + ' node(s)';
  renderNodesList(nodes || [], nodesListEl);
  renderNodesList(nodes || [], nodesListOverviewEl);
  renderClusterSummary(nodes || []);
  populateTargetSelect(nodes || []);
  populateMetricsNodeSelect(nodes || []);
  populateLogsNodeSelect(nodes || []);
}

function populateMetricsNodeSelect(nodes) {
  const sel = document.getElementById('metricsNode');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">Select a node</option>';
  (nodes || []).forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.ip;
    opt.textContent = n.hostname && n.hostname !== n.ip ? `${n.ip} (${n.hostname})` : n.ip;
    sel.appendChild(opt);
  });
  if (keep && nodes.some(n => n.ip === keep)) sel.value = keep;
}

function populateLogsNodeSelect(nodes) {
  const sel = document.getElementById('logsNode');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">Select a node</option>';
  (nodes || []).forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.ip;
    opt.textContent = n.hostname && n.hostname !== n.ip ? `${n.ip} (${n.hostname})` : n.ip;
    sel.appendChild(opt);
  });
  if (keep && nodes.some(n => n.ip === keep)) sel.value = keep;
}

function parseOtelMetrics(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    const metrics = [];
    const rms = data.resourceMetrics || [];
    for (const rm of rms) {
      const scopes = rm.scopeMetrics || [];
      for (const scope of scopes) {
        const list = scope.metrics || [];
        for (const m of list) {
          let value = '';
          let unit = m.unit || '';
          if (m.gauge && m.gauge.dataPoints && m.gauge.dataPoints[0]) {
            const dp = m.gauge.dataPoints[0];
            value = dp.asDouble !== undefined ? dp.asDouble : (dp.asInt !== undefined ? dp.asInt : '');
          } else if (m.sum && m.sum.dataPoints && m.sum.dataPoints.length) {
            const dps = m.sum.dataPoints;
            if (dps.length === 1) value = dps[0].asInt !== undefined ? dps[0].asInt : dps[0].asDouble;
            else value = dps.map(d => d.asInt !== undefined ? d.asInt : d.asDouble).join(', ');
          }
          const name = (m.name || '').replace(/^cassandra\./, '');
          if (name && (value !== '' || value === 0)) metrics.push({ name: m.name, short: name, value, unit });
        }
      }
    }
    return metrics;
  } catch (e) {
    return [];
  }
}

function buildMetricsCardsHtml(metrics) {
  if (!metrics.length) return '';
  const priority = ['client.request.read.latency.50p', 'client.request.write.latency.50p', 'client.request.count', 'compaction.tasks.completed', 'storage.total_hints.count', 'client.request.error.count'];
  const byName = {};
  metrics.forEach(m => { byName[m.name] = m; });
  let html = '<div class="metric-card section-title">Throughput &amp; Latency</div>';
  priority.forEach(name => {
    const m = byName[name];
    if (m) {
      html += `<div class="metric-card"><div class="metric-name">${escapeHtml(m.short)}</div><div class="metric-value">${escapeHtml(String(m.value))}<span class="metric-unit">${escapeHtml(m.unit)}</span></div></div>`;
    }
  });
  const rest = metrics.filter(m => !priority.includes(m.name));
  if (rest.length) {
    html += '<div class="metric-card section-title">Other metrics</div>';
    rest.slice(0, 12).forEach(m => {
      html += `<div class="metric-card"><div class="metric-name">${escapeHtml(m.short)}</div><div class="metric-value">${escapeHtml(String(m.value))}<span class="metric-unit">${escapeHtml(m.unit)}</span></div></div>`;
    });
  }
  return html;
}

function parseOtelToMap(jsonStr) {
  const map = {};
  try {
    const data = JSON.parse(jsonStr);
    const rms = data.resourceMetrics || [];
    for (const rm of rms) {
      for (const scope of rm.scopeMetrics || []) {
        for (const m of scope.metrics || []) {
          const name = m.name || '';
          if (m.gauge && m.gauge.dataPoints) {
            m.gauge.dataPoints.forEach((dp, i) => {
              const v = dp.asDouble !== undefined ? dp.asDouble : dp.asInt;
              if (v === undefined) return;
              const attr = (dp.attributes || []).map(a => a.value?.stringValue || a.value).filter(Boolean).join('.');
              const key = attr ? `${name}.${attr}` : name;
              map[key] = v;
            });
          } else if (m.sum && m.sum.dataPoints) {
            m.sum.dataPoints.forEach((dp) => {
              const v = dp.asInt !== undefined ? dp.asInt : dp.asDouble;
              if (v === undefined) return;
              const attrs = (dp.attributes || []).slice().sort((a, b) => (a.key || '').localeCompare(b.key || ''));
              const attr = attrs.map(a => (a.value && (a.value.stringValue || a.value.intValue != null)) ? (a.value.stringValue || String(a.value.intValue)) : '').filter(Boolean).join('.');
              const key = attr ? `${name}.${attr}` : name;
              map[key] = v;
            });
          }
        }
      }
    }
  } catch (e) {}
  return map;
}

function pushMetricsToHistory(map) {
  const t = new Date();
  for (const [key, v] of Object.entries(map)) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    if (!metricsHistory[key]) metricsHistory[key] = [];
    metricsHistory[key].push({ t, v });
    if (metricsHistory[key].length > MAX_METRICS_POINTS) metricsHistory[key].shift();
  }
}

const CHART_COLORS = { line: 'rgba(0, 200, 255, 0.9)', fill: 'rgba(0, 200, 255, 0.1)', orange: 'rgba(255, 150, 50, 0.9)' };

function ensureChart(canvasId, label, unit, colorKey) {
  const c = document.getElementById(canvasId);
  if (!c) return null;
  if (metricsCharts[canvasId]) return metricsCharts[canvasId];
  const color = colorKey === 'orange' ? CHART_COLORS.orange : CHART_COLORS.line;
  const fill = colorKey === 'orange' ? 'rgba(255, 150, 50, 0.1)' : CHART_COLORS.fill;
  metricsCharts[canvasId] = new Chart(c.getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: label + (unit ? ' (' + unit + ')' : ''), data: [], borderColor: color, backgroundColor: fill, fill: true, tension: 0.2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#e6edf3' } } },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: '#30363d' } },
        y: { beginAtZero: true, ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
      }
    }
  });
  return metricsCharts[canvasId];
}

function updateChart(canvasId, historyKey, label, unit, colorKey) {
  const arr = metricsHistory[historyKey];
  if (!arr || !arr.length) return;
  const chart = ensureChart(canvasId, label, unit, colorKey);
  if (!chart) return;
  chart.data.labels = arr.map(p => p.t.toLocaleTimeString());
  chart.data.datasets[0].data = arr.map(p => p.v);
  chart.update('none');
}

function updateAllMetricsCharts() {
  updateChart('chartReadCount', 'cassandra.client.request.count.Read', 'Read count', '1', 'line');
  updateChart('chartWriteCount', 'cassandra.client.request.count.Write', 'Write count', '1', 'line');
  updateChart('chartCompaction', 'cassandra.compaction.tasks.completed', 'Compaction completed', '1', 'orange');
  updateChart('chartHints', 'cassandra.storage.total_hints.count', 'Total hints', '1', 'line');
  updateChart('chartHintsInProgress', 'cassandra.storage.total_hints.in_progress.count', 'Hints in progress', '1', 'line');
  updateChart('chartQueueSize', 'queueSize', 'Log queue size', '1', 'line');
  updateChart('chartReadLatency', 'cassandra.client.request.read.latency.50p', 'Read latency 50p', 'µs', 'orange');
  updateChart('chartWriteLatency', 'cassandra.client.request.write.latency.50p', 'Write latency 50p', 'µs', 'orange');
  updateChart('chartReadLatency99', 'cassandra.client.request.read.latency.99p', 'Read latency 99p', 'µs', 'orange');
  updateChart('chartWriteLatency99', 'cassandra.client.request.write.latency.99p', 'Write latency 99p', 'µs', 'orange');
  updateChart('chartReadLatencyMax', 'cassandra.client.request.read.latency.max', 'Read latency max', 'µs', 'orange');
  updateChart('chartWriteLatencyMax', 'cassandra.client.request.write.latency.max', 'Write latency max', 'µs', 'orange');
  updateChart('chartCompactionStorage', 'cassandra.compaction.tasks.completed', 'Compaction completed', '1', 'orange');
  updateChart('chartTotalHints', 'cassandra.storage.total_hints.count', 'Total hints', '1', 'line');
  updateChart('chartHintsInProgressStorage', 'cassandra.storage.total_hints.in_progress.count', 'Hints in progress', '1', 'line');
  updateChart('chartErrReadTimeout', 'cassandra.client.request.error.count.Read.Timeout', 'Read Timeout', 'count', 'orange');
  updateChart('chartErrWriteTimeout', 'cassandra.client.request.error.count.Write.Timeout', 'Write Timeout', 'count', 'orange');
  updateChart('chartErrReadUnavailable', 'cassandra.client.request.error.count.Read.Unavailable', 'Read Unavailable', 'count', 'orange');
  updateChart('chartErrWriteUnavailable', 'cassandra.client.request.error.count.Write.Unavailable', 'Write Unavailable', 'count', 'orange');
  updateChart('chartErrReadFailure', 'cassandra.client.request.error.count.Read.Failure', 'Read Failure', 'count', 'orange');
  updateChart('chartErrWriteFailure', 'cassandra.client.request.error.count.Write.Failure', 'Write Failure', 'count', 'orange');
}

async function fetchMetricsForNode(nodeIp) {
  const res = await fetch(API_BASE + '/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: nodeIp, action: 'metrics', params: '' }),
  });
  const data = await res.json().catch(() => ({}));
  const results = data.results || {};
  const r = results[nodeIp];
  if (!r) return { output: null, error: 'No response from node' };
  if (r.error) return { output: null, error: r.error };
  return { output: r.output || null, error: null };
}

async function metricsPollTick() {
  const sel = document.getElementById('metricsNode');
  const nodeIp = sel && sel.value;
  if (!nodeIp) return;
  const statusEl = document.getElementById('metricsStatus');
  if (statusEl) statusEl.textContent = 'Fetching…';
  const { output, error } = await fetchMetricsForNode(nodeIp);
  if (statusEl) {
    if (error) statusEl.textContent = 'Error: ' + error;
    else if (output) statusEl.textContent = new Date().toLocaleTimeString() + ' — OK';
    else statusEl.textContent = 'Error: no metrics data';
  }
  if (output) {
    const map = parseOtelToMap(output);
    pushMetricsToHistory(map);
    updateAllMetricsCharts();
  }
}

function startMetricsPolling() {
  const sel = document.getElementById('metricsNode');
  if (!sel || !sel.value) {
    const statusEl = document.getElementById('metricsStatus');
    if (statusEl) statusEl.textContent = 'Select a node first.';
    return;
  }
  if (metricsPollInterval) return;
  const startBtn = document.getElementById('metricsStart');
  const stopBtn = document.getElementById('metricsStop');
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  metricsPollInterval = setInterval(metricsPollTick, METRICS_POLL_INTERVAL_MS);
  metricsPollTick();
}

function stopMetricsPolling() {
  if (metricsPollInterval) {
    clearInterval(metricsPollInterval);
    metricsPollInterval = null;
  }
  document.getElementById('metricsStart').disabled = false;
  document.getElementById('metricsStop').disabled = true;
  const statusEl = document.getElementById('metricsStatus');
  if (statusEl) statusEl.textContent = 'Stopped.';
}

async function fetchLogsForNode(nodeIp) {
  const res = await fetch(API_BASE + '/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: nodeIp, action: 'logs' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { output: null, error: data.error || res.statusText };
  const results = data.results || {};
  const r = results[nodeIp];
  if (!r) return { output: null, error: 'No result for node' };
  if (r.error) return { output: r.output || '', error: r.error };
  return { output: r.output || '', error: null };
}

function startLogsPolling() {
  const sel = document.getElementById('logsNode');
  const nodeIp = sel ? sel.value : '';
  if (!nodeIp) {
    const statusEl = document.getElementById('logsStatus');
    if (statusEl) statusEl.textContent = 'Select a node first.';
    return;
  }
  if (logsPollInterval) return;
  document.getElementById('logsStart').disabled = true;
  document.getElementById('logsStop').disabled = false;
  const statusEl = document.getElementById('logsStatus');
  if (statusEl) statusEl.textContent = 'Live tail started…';
  const tick = async () => {
    const { output, error } = await fetchLogsForNode(nodeIp);
    if (logsOutputEl) {
      logsOutputEl.textContent = error ? `Error: ${error}\n\n${output || ''}` : (output || 'No output.');
      logsOutputEl.classList.toggle('error', !!error);
    }
    if (statusEl) statusEl.textContent = error ? `Error: ${error}` : `Updated ${new Date().toLocaleTimeString()}`;
  };
  tick();
  logsPollInterval = setInterval(tick, LOGS_POLL_INTERVAL_MS);
}

function stopLogsPolling() {
  if (logsPollInterval) {
    clearInterval(logsPollInterval);
    logsPollInterval = null;
  }
  document.getElementById('logsStart').disabled = false;
  document.getElementById('logsStop').disabled = true;
  const statusEl = document.getElementById('logsStatus');
  if (statusEl) statusEl.textContent = 'Stopped.';
}

async function loadNodes() {
  try {
    refreshBtn.disabled = true;
    const data = await fetchNodes();
    const nodes = data.nodes || [];
    renderNodes(nodes);
    if (nodes.length === 0) {
      setResults('Error loading nodes.', true);
      nodesListEl.innerHTML = '<p class="muted">Error loading nodes.</p>';
    }
  } catch (e) {
    setResults('Error loading nodes: ' + e.message, true);
    nodesListEl.innerHTML = '<p class="muted">Error loading nodes.</p>';
    renderNodes([]);
  } finally {
    refreshBtn.disabled = false;
  }
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const viewEl = document.getElementById('view-' + viewId);
  const navEl = document.querySelector('.nav-item[data-view="' + viewId + '"]');
  if (viewEl) viewEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  const labels = { overview: 'Cluster Overview', nodes: 'Nodes', metrics: 'Metrics', operations: 'Operations', logs: 'Logs & Events' };
  const bread = document.getElementById('breadcrumbText');
  if (bread) bread.textContent = labels[viewId] || viewId;
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(el.getAttribute('data-view'));
  });
});

const metricsStartBtn = document.getElementById('metricsStart');
const metricsStopBtn = document.getElementById('metricsStop');
if (metricsStartBtn) metricsStartBtn.addEventListener('click', startMetricsPolling);
if (metricsStopBtn) metricsStopBtn.addEventListener('click', stopMetricsPolling);

const logsStartBtn = document.getElementById('logsStart');
const logsStopBtn = document.getElementById('logsStop');
if (logsStartBtn) logsStartBtn.addEventListener('click', startLogsPolling);
if (logsStopBtn) logsStopBtn.addEventListener('click', stopLogsPolling);

actionSelect.addEventListener('change', () => {
  const needParams = PARAM_ACTIONS.includes(actionSelect.value);
  paramsRow.style.display = needParams ? 'flex' : 'none';
  if (!needParams) paramsInput.value = '';
});

commandForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const target = targetSelect.value;
  const action = actionSelect.value;
  const params = paramsInput.value.trim();

  if (!target) {
    setResults('Please select a target node or "All nodes".', true);
    return;
  }
  if (!action) {
    setResults('Please select an action.', true);
    return;
  }

  setResults('Running…', false);
  runBtn.disabled = true;

  try {
    const res = await fetch(API_BASE + '/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, action, params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setResults(data.error || res.statusText || 'Request failed', true);
      return;
    }
    const results = data.results || {};
    const lines = Object.entries(results).map(([ip, r]) => {
      const err = r.error ? `\nError: ${r.error}` : '';
      return `--- ${ip} ---\n${r.output || ''}${err}`;
    });
    const fullOutput = lines.join('\n\n') || 'No output.';

    if (action === 'metrics' && lines.length === 1 && results[Object.keys(results)[0]] && !results[Object.keys(results)[0]].error) {
      const firstOutput = results[Object.keys(results)[0]].output || '';
      const metrics = parseOtelMetrics(firstOutput);
      if (metrics.length > 0) {
        setMetricsCards(buildMetricsCardsHtml(metrics));
        setResults('', false);
        resultsEl.textContent = fullOutput;
        resultsEl.style.display = 'block';
      } else {
        setResults(fullOutput, false);
      }
    } else if (action === 'logs' && lines.length === 1 && results[Object.keys(results)[0]] && !results[Object.keys(results)[0]].error) {
      setResults(fullOutput, false);
      logsOutputEl.textContent = results[Object.keys(results)[0]].output || 'No output.';
      logsOutputEl.classList.remove('error');
    } else {
      setResults(fullOutput, false);
    }
  } catch (err) {
    setResults('Request failed: ' + err.message, true);
  } finally {
    runBtn.disabled = false;
  }
});

refreshBtn.addEventListener('click', loadNodes);

loadNodes();
