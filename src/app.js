import { CaseService } from './services/caseService.js';
import { escapeHtml, formatTime, severityClass, statusPillClass, toTitle } from './utils/ui.js';

export function createApp(config = {}) {
  const svc = new CaseService(config);
  let currentView = 'overview';
  let selectedIncidentId = null;
  let selectedRuleId = null;
  let selectedRange = '24H';
  let logMode = 'table';
  let simulationTimer = null;

  const $ = (id) => document.getElementById(id);

  async function init() {
    showLoading('Loading JSON telemetry...', 42);
    await svc.init();
    showLoading('Building SOC workflow...', 84);
    bindGlobalEvents();
    svc.subscribe(renderCurrentView);
    startClock();
    startSimulation();
    switchView('overview');
    hideLoading();
  }

  function bindGlobalEvents() {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        switchView(item.dataset.view);
      });
    });

    $('menuToggle')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
    $('notificationClose')?.addEventListener('click', () => hideNotification());

    $('simulationToggle')?.addEventListener('change', (event) => {
      if (event.target.checked) startSimulation();
      else stopSimulation();
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      handleAction(button.dataset.action, button.dataset);
    });

    document.addEventListener('input', (event) => {
      if (event.target.id === 'caseNotes') {
        const caseId = event.target.dataset.caseId;
        svc.updateCase(caseId, { investigation_notes: event.target.value }, { silent: true });
      }
    });

    document.addEventListener('change', (event) => {
      if (event.target.id === 'caseVerdict') {
        svc.updateCase(event.target.dataset.caseId, { verdict: event.target.value });
      }
    });
  }

  function handleAction(action, dataset) {
    if (action === 'view-incident') {
      selectedIncidentId = dataset.incidentId;
      switchView('incident-detail');
    }

    if (action === 'nav-incidents') {
      switchView('incidents');
    }

    if (action === 'create-case') {
      selectedIncidentId = dataset.incidentId;
      const caseItem = svc.createCase(selectedIncidentId);
      notify('Case created', `${caseItem.case_id} linked to ${selectedIncidentId}`);
      switchView('incident-detail');
    }

    if (action === 'close-case') {
      svc.closeCase(dataset.caseId);
      notify('Case closed', `${dataset.caseId} has been closed and the linked incident is complete.`);
    }

    if (action === 'escalate') {
      svc.escalateIncident(dataset.incidentId);
      notify('Incident escalated', `${dataset.incidentId} marked for senior analyst review.`);
    }

    if (action === 'show-hint') {
      renderHints(dataset.alertId);
    }

    if (action === 'log-mode') {
      logMode = dataset.mode;
      renderCurrentView();
    }

    if (action === 'range') {
      selectedRange = dataset.range;
      renderCurrentView();
    }

    if (action === 'select-rule') {
      selectedRuleId = dataset.ruleId;
      renderCurrentView();
    }

    if (action === 'save-rule') {
      const summary = $('ruleSummaryEditor')?.value || '';
      const ruleCode = $('ruleCodeEditor')?.value || '';
      svc.updateRule(dataset.ruleId, { summary, rule_code: ruleCode });
      notify('Rule updated', `${dataset.ruleId} tuning changes apply to every linked alert.`);
    }

    if (action === 'reset-rule') {
      notify('Rule reset note', 'Reload the page to restore the original rule from alerts.json.');
    }
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === view || (view === 'incident-detail' && item.dataset.view === 'incidents'));
    });
    $('sidebar')?.classList.remove('open');
    renderCurrentView();
  }

  function renderCurrentView() {
    refreshBadges();
    const main = $('mainContent');
    if (!main) return;

    if (currentView === 'overview') main.innerHTML = overviewView();
    else if (currentView === 'incidents') main.innerHTML = incidentsView();
    else if (currentView === 'incident-detail') main.innerHTML = incidentDetailView();
    else if (currentView === 'threat-feed') main.innerHTML = threatFeedView();
    else if (currentView === 'rule-tuning') main.innerHTML = ruleTuningView();
    else main.innerHTML = moduleView(currentView);

    if (currentView === 'overview' || currentView === 'analytics') drawTrendChart();
  }

  function overviewView() {
    const stats = svc.getDashboardStats();
    const incidents = svc.getIncidents().slice(0, 5);
    const feed = svc.getLiveFeed().slice(0, 6);

    return `
      <h1 class="page-title">SOC Overview</h1>
      <p class="page-subtitle">Security monitoring, alert triage, investigation, case handling, and response workflow.</p>

      <div class="grid kpi-grid">
        ${kpiCard('Active Incidents', stats.activeIncidents, 'up', '2 vs last hour', 'fa-triangle-exclamation')}
        ${kpiCard('Threats Detected', stats.threatsDetected, 'up', '5 vs yesterday', 'fa-bug')}
        ${kpiCard('Assets Protected', stats.assetsProtected.toLocaleString(), 'down', 'stable since yesterday', 'fa-server')}
        ${kpiCard('MTTR', stats.mttr, 'down', '4m faster than yesterday', 'fa-stopwatch')}
      </div>

      <div class="grid two-col">
        <section class="card">
          <div class="card-header"><h2 class="card-title">Recent Incidents</h2><button class="btn" data-action="nav-incidents"><i class="fas fa-list"></i> Queue</button></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Incident ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>${incidents.map(incidentRow).join('')}</tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2 class="card-title">Live Threat Feed</h2><span class="pill in-progress">Streaming</span></div>
          <div class="card-body"><div class="feed-list">${feed.map(feedItem).join('')}</div></div>
        </section>
      </div>

      <section class="card" style="margin-top:16px;">
        <div class="card-header">
          <h2 class="card-title">Threat Detection Trends</h2>
          ${rangeSelector()}
        </div>
        <div class="card-body"><canvas class="chart" id="trendChart" width="900" height="260"></canvas></div>
      </section>
    `;
  }

  function incidentsView() {
    const incidents = svc.getIncidents();
    return `
      <h1 class="page-title">Active Incidents</h1>
      <p class="page-subtitle">Alerts are grouped into incidents. Analysts investigate incidents, create cases, document verdicts, and close cases.</p>
      <section class="card">
        <div class="card-header"><h2 class="card-title">Incident Queue</h2><span class="muted">${incidents.length} total</span></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Incident ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Assigned To</th><th>Created Date</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${incidents.map((incident) => `
                <tr>
                  <td class="mono">${escapeHtml(incident.incident_id)}</td>
                  <td>${escapeHtml(incident.title)} ${incident.escalated ? '<span class="pill escalated">Escalated</span>' : ''}</td>
                  <td><span class="severity-badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span></td>
                  <td><span class="pill ${statusPillClass(incident.status)}">${escapeHtml(incident.status)}</span></td>
                  <td>${escapeHtml(incident.assigned_to)}</td>
                  <td>${escapeHtml(formatTime(incident.created_date))}</td>
                  <td><div class="actions">
                    <button class="btn" data-action="view-incident" data-incident-id="${escapeHtml(incident.incident_id)}"><i class="fas fa-eye"></i> View</button>
                    <button class="btn btn-primary" data-action="create-case" data-incident-id="${escapeHtml(incident.incident_id)}" ${incident.case_id ? 'disabled' : ''}><i class="fas fa-folder-plus"></i> Create Case</button>
                  </div></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function incidentDetailView() {
    const incident = selectedIncidentId ? svc.getIncident(selectedIncidentId) : svc.getIncidents()[0];
    if (!incident) return `<h1 class="page-title">Incident Detail</h1><p class="page-subtitle">No incident selected.</p>`;
    selectedIncidentId = incident.incident_id;

    const alerts = svc.getIncidentAlerts(incident.incident_id);
    const activeAlert = alerts[0];
    const caseItem = svc.getCaseByIncident(incident.incident_id);

    return `
      <h1 class="page-title">${escapeHtml(incident.title)}</h1>
      <p class="page-subtitle"><span class="mono">${escapeHtml(incident.incident_id)}</span> follows the SOC flow: alert grouped into incident, investigated, converted to case, and closed after verdict.</p>

      <div class="grid kv-grid" style="margin-bottom:16px;">
        <div class="field-panel"><div class="field-label">Severity</div><div class="field-value"><span class="severity-badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span></div></div>
        <div class="field-panel"><div class="field-label">Status</div><div class="field-value"><span class="pill ${statusPillClass(incident.status)}">${escapeHtml(incident.status)}</span></div></div>
        <div class="field-panel"><div class="field-label">Case</div><div class="field-value">${caseItem ? `<span class="mono">${escapeHtml(caseItem.case_id)}</span>` : 'No case created'}</div></div>
      </div>

      <div class="grid two-col">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">Alert Overview</h2>
            <div class="actions">
              <button class="btn" data-action="show-hint" data-alert-id="${escapeHtml(activeAlert?.alert_id || '')}"><i class="fas fa-lightbulb"></i> Hint</button>
              <button class="btn btn-danger" data-action="escalate" data-incident-id="${escapeHtml(incident.incident_id)}"><i class="fas fa-arrow-up-right-dots"></i> Mark as Escalated</button>
            </div>
          </div>
          <div class="card-body">
            ${alerts.map(alertOverview).join('')}
            <div class="hint-box" id="hintBox" style="display:none; margin-top:12px;"></div>
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2 class="card-title">MITRE ATT&CK Panel</h2></div>
          <div class="card-body">
            ${alerts.map((alert) => `
              <div class="field-panel" style="margin-bottom:10px;">
                <div class="field-label">${escapeHtml(alert.name)}</div>
                <div class="field-value"><code>${escapeHtml(alert.mitre)}</code></div>
                <div class="muted" style="margin-top:6px;">Kill Chain: ${escapeHtml(alert.kill_chain_phase)}</div>
              </div>
            `).join('')}
          </div>
        </section>
      </div>

      <section class="card" style="margin-top:16px;">
        <div class="card-header">
          <h2 class="card-title">Event Logs</h2>
          <div class="segmented">
            <button class="${logMode === 'table' ? 'active' : ''}" data-action="log-mode" data-mode="table">Table</button>
            <button class="${logMode === 'raw' ? 'active' : ''}" data-action="log-mode" data-mode="raw">Raw</button>
          </div>
        </div>
        <div class="card-body">${logsView(alerts.flatMap((alert) => alert.logs || []))}</div>
      </section>

      <div class="grid two-col" style="margin-top:16px;">
        <section class="card">
          <div class="card-header"><h2 class="card-title">Attack Timeline</h2></div>
          <div class="card-body"><div class="timeline">${timelineView(alerts.flatMap((alert) => alert.logs || []))}</div></div>
        </section>

        <section class="card">
          <div class="card-header"><h2 class="card-title">Case Management</h2></div>
          <div class="card-body">${caseView(incident, caseItem)}</div>
        </section>
      </div>
    `;
  }

  function threatFeedView() {
    return `
      <h1 class="page-title">Threat Feed</h1>
      <p class="page-subtitle">Streaming-style security events generated from detection rules and simulation.</p>
      <section class="card">
        <div class="card-header"><h2 class="card-title">Live Feed</h2><span class="muted">Auto-refresh simulation can be toggled in the top bar.</span></div>
        <div class="card-body"><div class="feed-list">${svc.getLiveFeed().map(feedItem).join('')}</div></div>
      </section>
    `;
  }

  function ruleTuningView() {
    const rules = svc.getRules();
    if (!selectedRuleId || !rules.some((rule) => rule.rule_id === selectedRuleId)) {
      selectedRuleId = rules[0]?.rule_id || null;
    }

    const selected = rules.find((rule) => rule.rule_id === selectedRuleId);

    return `
      <h1 class="page-title">Rule Tuning</h1>
      <p class="page-subtitle">Review every alert rule and fine-tune the detection logic for a demo investigation.</p>

      <div class="grid two-col rule-tuning-grid">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">Alert Rules</h2>
            <span class="muted">${rules.length} rules</span>
          </div>
          <div class="rule-list">
            ${rules.map((rule) => `
              <button class="rule-list-item ${rule.rule_id === selectedRuleId ? 'active' : ''}" data-action="select-rule" data-rule-id="${escapeHtml(rule.rule_id)}">
                <span class="mono">${escapeHtml(rule.rule_id)}</span>
                <strong>${escapeHtml(rule.name)}</strong>
                <span class="muted">${escapeHtml(rule.mitre)} | ${escapeHtml(rule.severity)} | ${escapeHtml(rule.alert_count)} linked alerts</span>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${escapeHtml(selected?.name || 'No Rule Selected')}</h2>
            <div class="actions">
              <button class="btn" data-action="reset-rule"><i class="fas fa-rotate-left"></i> Reset</button>
              <button class="btn btn-primary" data-action="save-rule" data-rule-id="${escapeHtml(selected?.rule_id || '')}"><i class="fas fa-floppy-disk"></i> Save Tuning</button>
            </div>
          </div>
          <div class="card-body">
            ${selected ? `
              <div class="grid kv-grid" style="margin-bottom:12px;">
                <div class="field-panel"><div class="field-label">Rule ID</div><div class="field-value mono">${escapeHtml(selected.rule_id)}</div></div>
                <div class="field-panel"><div class="field-label">MITRE</div><div class="field-value">${escapeHtml(selected.mitre)}</div></div>
                <div class="field-panel"><div class="field-label">Linked Alerts</div><div class="field-value">${escapeHtml(selected.alert_count)}</div></div>
              </div>

              <label class="field-label" for="ruleSummaryEditor">Detection Summary</label>
              <textarea class="rule-summary-editor" id="ruleSummaryEditor">${escapeHtml(selected.summary)}</textarea>

              <label class="field-label" for="ruleCodeEditor" style="display:block; margin-top:14px;">Rule Code</label>
              <textarea class="rule-code-editor" id="ruleCodeEditor" spellcheck="false">${escapeHtml(selected.rule_code)}</textarea>

              <div style="margin-top:14px;">
                <div class="field-label">Preview</div>
                ${codeSnippet(selected.rule_code, selected.rule_code.includes('\n  events:') ? 'yara-l' : 'yara')}
              </div>
            ` : '<p class="muted">No rules available.</p>'}
          </div>
        </section>
      </div>
    `;
  }

  function moduleView(view) {
    const workload = svc.getWorkload();
    const titles = {
      forensics: 'Digital Forensics',
      'threat-hunting': 'Threat Hunting',
      intel: 'Threat Intel',
      playbooks: 'Playbooks',
      containment: 'Containment',
      recovery: 'Recovery',
      analytics: 'Analytics',
      reports: 'Reports',
    };

    if (view === 'analytics') {
      return `
        <h1 class="page-title">Analytics</h1>
        <p class="page-subtitle">Detection volume and analyst workload for the simulated SOC.</p>
        <div class="grid kpi-grid">
          ${kpiCard('Active Cases', workload.activeCases, 'up', 'open workload', 'fa-folder-open')}
          ${kpiCard('Unassigned Incidents', workload.unassigned, 'up', 'needs queue owner', 'fa-user-clock')}
          ${kpiCard('High Severity', workload.highSeverity, 'up', 'priority triage', 'fa-fire')}
          ${kpiCard('Feed Events', svc.getLiveFeed().length, 'down', 'current stream', 'fa-rss')}
        </div>
        <section class="card"><div class="card-header"><h2 class="card-title">Detection Trends</h2>${rangeSelector()}</div><div class="card-body"><canvas class="chart" id="trendChart" width="900" height="260"></canvas></div></section>
      `;
    }

    const content = {
      forensics: ['Collect endpoint process tree', 'Preserve suspicious file hash', 'Review network connection evidence'],
      'threat-hunting': ['Search for encoded PowerShell across endpoints', 'Hunt for same source IP across VPN logs', 'Pivot on malicious file hash'],
      intel: ['T1110 Brute Force', 'T1204 User Execution', 'T1059 Command and Scripting Interpreter'],
      playbooks: ['Brute Force Triage', 'Malware Download Response', 'Suspicious Script Execution'],
      containment: ['Block IP address', 'Isolate endpoint', 'Disable compromised account'],
      recovery: ['Re-enable account after password reset', 'Restore host from clean baseline', 'Validate EDR health'],
      reports: ['Incident closure report', 'Analyst workload report', 'MITRE technique coverage'],
    }[view] || ['No workflow configured'];

    return `
      <h1 class="page-title">${escapeHtml(titles[view] || toTitle(view))}</h1>
      <p class="page-subtitle">Operational module connected to the same SOC simulation data.</p>
      <section class="card">
        <div class="card-header"><h2 class="card-title">Workflow Items</h2></div>
        <div class="card-body"><div class="attack-steps">${content.map((item) => `<div class="attack-step">${escapeHtml(item)}</div>`).join('')}</div></div>
      </section>
    `;
  }

  function kpiCard(label, value, trend, comparison, icon) {
    return `
      <section class="card kpi-card">
        <div class="kpi-label"><i class="fas ${icon}"></i> ${escapeHtml(label)}</div>
        <div class="kpi-value">${escapeHtml(value)}</div>
        <div class="trend ${trend}">${trend === 'up' ? '↑' : '↓'} ${escapeHtml(comparison)}</div>
      </section>
    `;
  }

  function incidentRow(incident) {
    return `
      <tr>
        <td class="mono">${escapeHtml(incident.incident_id)}</td>
        <td>${escapeHtml(incident.title)}</td>
        <td><span class="severity-badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span></td>
        <td><span class="pill ${statusPillClass(incident.status)}">${escapeHtml(incident.status)}</span></td>
        <td>${escapeHtml(formatTime(incident.created_date))}</td>
      </tr>
    `;
  }

  function feedItem(item) {
    return `
      <div class="feed-item">
        <code>${escapeHtml(item.ip)}</code>
        <div><strong>${escapeHtml(item.event_type)}</strong><div class="muted">${escapeHtml(item.description)}</div></div>
        <span class="muted">${escapeHtml(formatTime(item.timestamp))}</span>
      </div>
    `;
  }

  function alertOverview(alert) {
    return `
      <div class="field-panel" style="margin-bottom:12px;">
        <div class="field-label">Alert Name</div>
        <div class="field-value"><strong>${escapeHtml(alert.name)}</strong></div>
        <div class="field-label" style="margin-top:12px;">Description</div>
        <div class="field-value">${escapeHtml(alert.description)}</div>
        <div class="field-label" style="margin-top:12px;">Detection Rule</div>
        <div class="field-value">${escapeHtml(alert.rule)}</div>
        ${alert.yara_rule ? codeSnippet(alert.yara_rule, alert.yara_rule.includes('\n  events:') ? 'yara-l' : 'yara') : ''}
        <div class="grid kv-grid" style="margin-top:12px;">
          <div><div class="field-label">MITRE Technique</div><div class="field-value"><code>${escapeHtml(alert.mitre)}</code></div></div>
          <div><div class="field-label">Kill Chain Phase</div><div class="field-value">${escapeHtml(alert.kill_chain_phase)}</div></div>
          <div><div class="field-label">Severity</div><div class="field-value"><span class="severity-badge ${severityClass(alert.severity)}">${escapeHtml(alert.severity)}</span></div></div>
        </div>
      </div>
    `;
  }

  function codeSnippet(source, language = 'code') {
    const lines = String(source || '').split('\n');
    return `
      <div class="code-card" style="margin-top:12px;">
        <div class="code-header">
          <span>${escapeHtml(lines.length)} lines</span>
          <span>${escapeHtml(language)}</span>
        </div>
        <pre class="code-snippet">${lines.map((line, index) => `<span class="code-line"><span class="line-no">${index + 1}</span><span class="line-code">${highlightCode(line)}</span></span>`).join('')}</pre>
      </div>
    `;
  }

  function highlightCode(line) {
    const safe = escapeHtml(line);
    const match = safe.match(/^(\s*)([A-Za-z_][\w-]*)(\s*[:=])?(.*)$/);
    if (!match) return safe;
    const [, indent, key, separator = '', rest = ''] = match;
    const highlightedRest = rest.replace(/(&quot;.*?&quot;|\/.*\/|#.*$)/g, '<span class="code-string">$1</span>');
    return `${indent}<span class="code-key">${key}</span>${separator}${highlightedRest}`;
  }

  function logsView(logs) {
    if (logMode === 'raw') return `<pre class="raw-log">${escapeHtml(JSON.stringify(logs, null, 2))}</pre>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Timestamp</th><th>Source IP</th><th>Destination IP</th><th>User</th><th>Action</th><th>Status</th><th>Raw Log</th></tr></thead>
          <tbody>${logs.map((log) => `
            <tr>
              <td>${escapeHtml(formatTime(log.timestamp, { second: '2-digit' }))}</td>
              <td><code>${escapeHtml(log.source_ip)}</code></td>
              <td><code>${escapeHtml(log.destination_ip)}</code></td>
              <td>${escapeHtml(log.user)}</td>
              <td>${escapeHtml(log.action)}</td>
              <td>${escapeHtml(log.status)}</td>
              <td><code>${escapeHtml(log.raw_log)}</code></td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function timelineView(logs) {
    return logs.map((log) => `
      <div class="timeline-item">
        <strong>${escapeHtml(log.action)}</strong>
        <div class="muted">${escapeHtml(formatTime(log.timestamp, { second: '2-digit' }))} | ${escapeHtml(log.source_ip)} to ${escapeHtml(log.destination_ip)} | ${escapeHtml(log.status)}</div>
      </div>
    `).join('');
  }

  function caseView(incident, caseItem) {
    if (!caseItem) {
      return `
        <p class="muted">No case exists yet. Creating a case moves this incident into analyst investigation.</p>
        <button class="btn btn-primary" data-action="create-case" data-incident-id="${escapeHtml(incident.incident_id)}"><i class="fas fa-folder-plus"></i> Create Case</button>
      `;
    }

    return `
      <div class="form-grid" style="margin-bottom:12px;">
        <div><div class="field-label">Case ID</div><div class="field-value mono">${escapeHtml(caseItem.case_id)}</div></div>
        <div><div class="field-label">Linked Incident ID</div><div class="field-value mono">${escapeHtml(caseItem.linked_incident_id)}</div></div>
        <div><div class="field-label">Status</div><div class="field-value"><span class="pill ${statusPillClass(caseItem.status)}">${escapeHtml(caseItem.status)}</span></div></div>
        <div><div class="field-label">Assigned Analyst</div><div class="field-value">${escapeHtml(caseItem.assigned_analyst)}</div></div>
      </div>
      <label class="field-label" for="caseVerdict">Verdict</label>
      <select id="caseVerdict" data-case-id="${escapeHtml(caseItem.case_id)}" style="margin:7px 0 12px;">
        <option value="">Select verdict</option>
        <option value="True Positive" ${caseItem.verdict === 'True Positive' ? 'selected' : ''}>True Positive</option>
        <option value="False Positive" ${caseItem.verdict === 'False Positive' ? 'selected' : ''}>False Positive</option>
      </select>
      <label class="field-label" for="caseNotes">Investigation Summary / Analyst Notes</label>
      <textarea id="caseNotes" data-case-id="${escapeHtml(caseItem.case_id)}" placeholder="Investigation Summary / Analyst Notes">${escapeHtml(caseItem.investigation_notes)}</textarea>
      <div class="actions" style="margin-top:12px;">
        <button class="btn btn-primary" data-action="close-case" data-case-id="${escapeHtml(caseItem.case_id)}" ${caseItem.status === 'Closed' ? 'disabled' : ''}><i class="fas fa-check"></i> Close Case</button>
      </div>
    `;
  }

  function rangeSelector() {
    return `
      <div class="segmented">
        ${['24H', '7D', '30D'].map((range) => `<button class="${selectedRange === range ? 'active' : ''}" data-action="range" data-range="${range}">${range}</button>`).join('')}
      </div>
    `;
  }

  function renderHints(alertId) {
    const alert = svc.getAlerts().find((item) => item.alert_id === alertId);
    const box = $('hintBox');
    if (!box || !alert) return;
    box.style.display = 'block';
    box.innerHTML = `<strong>Investigation Assistant</strong><div class="attack-steps" style="margin-top:10px;">${alert.hints.map((hint) => `<div class="attack-step">${escapeHtml(hint)}</div>`).join('')}</div>`;
  }

  function drawTrendChart() {
    const canvas = $('trendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const data = svc.getTrendData(selectedRange);
    const width = canvas.width;
    const height = canvas.height;
    const padding = 34;
    const max = Math.max(...data) + 4;
    const barWidth = (width - padding * 2) / data.length - 10;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#101b2d';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(157, 176, 200, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = padding + i * ((height - padding * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    data.forEach((value, index) => {
      const x = padding + index * (barWidth + 10);
      const barHeight = (value / max) * (height - padding * 2);
      const y = height - padding - barHeight;
      ctx.fillStyle = index % 2 ? '#22d3ee' : '#3b82f6';
      ctx.fillRect(x, y, barWidth, barHeight);
      ctx.fillStyle = '#9db0c8';
      ctx.font = '13px sans-serif';
      ctx.fillText(String(value), x + 3, y - 7);
    });
  }

  function refreshBadges() {
    const active = svc.getIncidents().filter((incident) => incident.status !== 'Closed').length;
    const badge = $('activeIncidentsBadge');
    if (badge) badge.textContent = String(active);
  }

  function startClock() {
    const tick = () => {
      const el = $('currentDateTime');
      if (el) el.textContent = new Date().toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'short', day: '2-digit' });
    };
    tick();
    setInterval(tick, 1000);
  }

  function startSimulation() {
    stopSimulation();
    simulationTimer = setInterval(() => {
      const generated = svc.addGeneratedAlert();
      if (generated) notify('New alert generated', `${generated.alert.name} grouped into ${generated.incident.incident_id}`);
      else {
        stopSimulation();
        const toggle = $('simulationToggle');
        if (toggle) toggle.checked = false;
        notify('Alert cap reached', 'Simulation stopped at the maximum of 10 alerts.');
      }
    }, 8000);
  }

  function stopSimulation() {
    if (simulationTimer) clearInterval(simulationTimer);
    simulationTimer = null;
  }

  function showLoading(status, progress) {
    const progressEl = $('loadingProgress');
    const statusEl = $('loadingStatus');
    if (progressEl) progressEl.style.width = `${progress}%`;
    if (statusEl) statusEl.textContent = status;
  }

  function hideLoading() {
    showLoading('Ready', 100);
    setTimeout(() => $('loadingScreen')?.classList.add('hidden'), 180);
    setTimeout(() => {
      const screen = $('loadingScreen');
      if (screen) screen.style.display = 'none';
    }, 420);
  }

  function notify(title, body) {
    const notification = $('notificationTemplate');
    if (!notification) return;
    notification.querySelector('.notification-title').textContent = title;
    notification.querySelector('.notification-body').textContent = body;
    notification.classList.add('show');
    setTimeout(hideNotification, 4300);
  }

  function hideNotification() {
    $('notificationTemplate')?.classList.remove('show');
  }

  return { init };
}
