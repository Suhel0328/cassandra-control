const API_BASE = '';

const nodesListEl = document.getElementById('nodesList');
const nodeCountEl = document.getElementById('nodeCount');
const targetSelect = document.getElementById('target');
const actionSelect = document.getElementById('action');
const paramsRow = document.getElementById('paramsRow');
const paramsInput = document.getElementById('params');
const resultsEl = document.getElementById('results');
const commandForm = document.getElementById('commandForm');
const refreshBtn = document.getElementById('refreshNodes');
const runBtn = document.getElementById('runCmd');

const PARAM_ACTIONS = ['restore', 'archive_commitlog'];

function setResults(text, isError) {
  resultsEl.textContent = text;
  resultsEl.classList.toggle('error', !!isError);
  resultsEl.classList.toggle('success', !isError);
}

async function fetchNodes() {
  const res = await fetch(API_BASE + '/api/nodes');
  if (!res.ok) throw new Error('Failed to fetch nodes');
  return res.json();
}

function renderNodes(nodes) {
  nodeCountEl.textContent = nodes.length + ' node(s)';

  const options = targetSelect.querySelectorAll('option:not([value=""])');
  options.forEach(o => o.remove());
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All nodes';
  targetSelect.insertBefore(allOpt, targetSelect.options[1] || null);

  if (nodes.length === 0) {
    nodesListEl.innerHTML = '<p class="muted">No nodes connected. Start agents on Cassandra nodes.</p>';
    return;
  }

  nodesListEl.innerHTML = nodes.map(n => `
    <div class="node-item">
      <div>
        <span class="ip">${escapeHtml(n.ip)}</span>
        ${n.hostname && n.hostname !== n.ip ? `<span class="meta"> · ${escapeHtml(n.hostname)}</span>` : ''}
      </div>
      <div class="meta">${escapeHtml(n.cluster || '-')} / ${escapeHtml(n.data_center || '-')}</div>
      <div class="status">Active</div>
    </div>
  `).join('');

  nodes.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.ip;
    opt.textContent = n.hostname && n.hostname !== n.ip ? `${n.ip} (${n.hostname})` : n.ip;
    targetSelect.appendChild(opt);
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function loadNodes() {
  try {
    refreshBtn.disabled = true;
    const data = await fetchNodes();
    renderNodes(data.nodes || []);
  } catch (e) {
    setResults('Error loading nodes: ' + e.message, true);
    nodesListEl.innerHTML = '<p class="muted">Error loading nodes.</p>';
  } finally {
    refreshBtn.disabled = false;
  }
}

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
    setResults(lines.join('\n\n') || 'No output.', false);
  } catch (err) {
    setResults('Request failed: ' + err.message, true);
  } finally {
    runBtn.disabled = false;
  }
});

refreshBtn.addEventListener('click', loadNodes);

loadNodes();
