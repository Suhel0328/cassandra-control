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
  const labels = { overview: 'Cluster Overview', nodes: 'Nodes', operations: 'Operations', logs: 'Logs & Events' };
  const bread = document.getElementById('breadcrumbText');
  if (bread) bread.textContent = labels[viewId] || viewId;
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(el.getAttribute('data-view'));
  });
});

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
