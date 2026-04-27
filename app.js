/* ================================================
   Cloud Gaming Dashboard — Application Controller
   ================================================ */

// ── Chart instances (for cleanup on re-render) ──
let chartInstances = {};

// ── Format helpers ──
const fmt = {
  usd: (v) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  usd2: (v) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  usd4: (v) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
  pct: (v) => Number(v).toFixed(1) + '%',
  num: (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
  num1: (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
};

// ── Info-tooltip helper ──
// Emits an inline (i) icon with a hover tooltip describing how a derived value
// was calculated. Tooltip text is HTML-escaped at the attribute boundary.
const escapeAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tip = (text) => `<span class="info-tip" tabindex="0" data-tip="${escapeAttr(text)}" aria-label="${escapeAttr(text)}">i</span>`;

// ── Tab Navigation ──
function initNav() {
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Update nav
      document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update content
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const target = document.getElementById('tab-' + tab);
      if (target) target.classList.add('active');
      // Re-render charts when switching to charts tab
      if (tab === 'charts') renderCharts();
    });
  });
}

// ── Preset System ──
function initPresets() {
  const presetEl = document.getElementById('scenarioPreset');
  if (!presetEl) return;

  const presets = {
    conservative: {
      'cfg-users': 500, 'cfg-price': 50, 'cfg-avg-usage': 40,
      'cfg-weekend-share': 35, 'cfg-weekday-peak-intensity': 2.5, 'cfg-weekend-peak-intensity': 3.0, 'cfg-window-peak-factor': 1.6,
      'cfg-gpu-tier': 'l40s', 'cfg-l40s-users-per-gpu': 2, 'cfg-rtx6000-users-per-gpu': 4,
      'cfg-contract-discount': 55, 'cfg-idle-discount': 15, 'cfg-burst-multiplier': 1.4, 'cfg-peak-coverage': 100, 'cfg-intra-window-util': 60,
    },
    expected: {
      'cfg-users': 1000, 'cfg-price': 50, 'cfg-avg-usage': 50,
      'cfg-weekend-share': 40, 'cfg-weekday-peak-intensity': 3.0, 'cfg-weekend-peak-intensity': 3.8, 'cfg-window-peak-factor': 2.0,
      'cfg-gpu-tier': 'l40s', 'cfg-l40s-users-per-gpu': 2, 'cfg-rtx6000-users-per-gpu': 4,
      'cfg-contract-discount': 60, 'cfg-idle-discount': 20, 'cfg-burst-multiplier': 1.5, 'cfg-peak-coverage': 95, 'cfg-intra-window-util': 70,
    },
    aggressive: {
      'cfg-users': 2500, 'cfg-price': 50, 'cfg-avg-usage': 55,
      'cfg-weekend-share': 42, 'cfg-weekday-peak-intensity': 3.2, 'cfg-weekend-peak-intensity': 4.0, 'cfg-window-peak-factor': 2.1,
      'cfg-gpu-tier': 'mixed', 'cfg-l40s-users-per-gpu': 3, 'cfg-rtx6000-users-per-gpu': 6,
      'cfg-contract-discount': 60, 'cfg-idle-discount': 25, 'cfg-burst-multiplier': 1.4, 'cfg-peak-coverage': 90, 'cfg-intra-window-util': 65,
    },
    stress: {
      'cfg-users': 1000, 'cfg-price': 50, 'cfg-avg-usage': 70,
      'cfg-weekend-share': 45, 'cfg-weekday-peak-intensity': 3.4, 'cfg-weekend-peak-intensity': 4.2, 'cfg-window-peak-factor': 2.4,
      'cfg-gpu-tier': 'rtx6000', 'cfg-l40s-users-per-gpu': 1, 'cfg-rtx6000-users-per-gpu': 2,
      'cfg-contract-discount': 50, 'cfg-idle-discount': 10, 'cfg-burst-multiplier': 2.0, 'cfg-peak-coverage': 80, 'cfg-intra-window-util': 85,
    },
  };

  presetEl.addEventListener('change', () => {
    const key = presetEl.value;
    if (key === 'custom' || !presets[key]) return;
    const p = presets[key];
    for (const [id, val] of Object.entries(p)) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
    recalculate();
  });
}

// ── Input change listener ──
function initInputListeners() {
  const onConfigChange = () => {
    const presetEl = document.getElementById('scenarioPreset');
    if (presetEl) presetEl.value = 'custom';
    recalculate();
  };
  document.querySelectorAll('#tab-config input, #tab-config select').forEach(el => {
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', onConfigChange);
    } else {
      el.addEventListener('input', onConfigChange);
      el.addEventListener('change', onConfigChange);
    }
  });
}

// ── MAIN RECALCULATE ──
function recalculate() {
  const r = Engine.calculate();
  renderDashboard(r);
  renderFinancials(r);
  renderInfra(r);
  renderScenarios();
  // Charts only re-render when tab is active (expensive)
  const chartsTab = document.getElementById('tab-charts');
  if (chartsTab && chartsTab.classList.contains('active')) {
    renderCharts();
  }
}

// ════════════════════════════════════
//  DASHBOARD TAB
// ════════════════════════════════════
function renderDashboard(r) {
  // KPIs
  const kpiRow = document.getElementById('kpi-row');
  kpiRow.innerHTML = `
    <div class="kpi-card" data-color="blue">
      <div class="kpi-label">Monthly Revenue ${tip(`Subscribers (${fmt.num(r.config.users)}) × Price USD (${fmt.usd2(r.priceUSD)}) = ${fmt.usd(r.monthlyRevenue)}`)}</div>
      <div class="kpi-value neutral">${fmt.usd(r.monthlyRevenue)}</div>
      <div class="kpi-sub">${fmt.num(r.config.users)} users × ${fmt.usd2(r.priceUSD)}/mo</div>
    </div>
    <div class="kpi-card" data-color="amber">
      <div class="kpi-label">Total Infra Cost ${tip(`Compute (${fmt.usd(r.totalComputeCost)}) + Storage (${fmt.usd(r.totalStorageCost)}) + Windows (${fmt.usd(r.totalWindowsCost)}) + IPs (${fmt.usd(r.totalIPCost)}) = ${fmt.usd(r.totalInfraCosts)}`)}</div>
      <div class="kpi-value neutral">${fmt.usd(r.totalInfraCosts)}</div>
      <div class="kpi-sub">${fmt.usd2(r.totalCostPerUser)}/user/mo</div>
    </div>
    <div class="kpi-card" data-color="${r.monthlyProfit >= 0 ? 'emerald' : 'rose'}">
      <div class="kpi-label">Monthly Profit ${tip(`Revenue (${fmt.usd(r.monthlyRevenue)}) − Total Costs (${fmt.usd(r.totalInfraCosts)}) = ${fmt.usd(r.monthlyProfit)}. Gross margin = profit ÷ revenue = ${fmt.pct(r.grossMargin)}`)}</div>
      <div class="kpi-value ${r.monthlyProfit >= 0 ? 'positive' : 'negative'}">${fmt.usd(r.monthlyProfit)}</div>
      <div class="kpi-sub">${fmt.pct(r.grossMargin)} gross margin</div>
    </div>
    <div class="kpi-card" data-color="purple">
      <div class="kpi-label">Cost/User Hour ${tip(`Total Infra Cost (${fmt.usd(r.totalInfraCosts)}) ÷ Total User-Hours (${fmt.num(r.totalUsageHours)}) = ${fmt.usd2(r.totalCostPerUserHour)}`)}</div>
      <div class="kpi-value neutral">${fmt.usd2(r.totalCostPerUserHour)}</div>
      <div class="kpi-sub">Compute: ${fmt.usd2(r.costPerUserHourCompute)}/hr</div>
    </div>
    <div class="kpi-card" data-color="cyan">
      <div class="kpi-label">Peak Demand ${tip(`Window user-hours are distributed by demand shape, then avg concurrency in each window is converted to peak concurrency using the ${r.config.windowPeakOverAvgFactor.toFixed(1)}× peak-over-average factor. Absolute peak = max(${r.peakUsersWeekday}, ${r.offpeakUsersWeekday}, ${r.peakUsersWeekend}, ${r.offpeakUsersWeekend}) = ${fmt.num(r.absolutePeakUsers)} users, requiring ${r.maxRacksRaw} racks.`)}</div>
      <div class="kpi-value neutral">${fmt.num(r.absolutePeakUsers)}</div>
      <div class="kpi-sub">${r.maxRacksRaw} racks needed at peak</div>
    </div>
  `;

  // Alerts
  const alertBar = document.getElementById('alert-bar');
  let alerts = '';
  if (r.grossMargin < 0) {
    alerts += `<div class="alert alert-danger">🚨 Operating at a loss — costs exceed revenue by ${fmt.usd(Math.abs(r.monthlyProfit))}/mo</div>`;
  } else if (r.grossMargin < 20) {
    alerts += `<div class="alert alert-warning">⚠️ Thin margins (${fmt.pct(r.grossMargin)}) — consider optimizing GPU slicing or negotiating better contracts</div>`;
  } else if (r.grossMargin > 50) {
    alerts += `<div class="alert alert-success">✅ Strong margins at ${fmt.pct(r.grossMargin)} — healthy business fundamentals</div>`;
  }
  if (r.scalingRisk === 'HIGH') {
    alerts += `<div class="alert alert-warning">⚠️ ${r.maxRacksRaw} racks needed at peak — high scaling demand for dynamic provisioning</div>`;
  }
  if (r.costPerActiveUserHour > 0.75) {
    alerts += `<div class="alert alert-warning">💡 High cost per active user-hour: ${fmt.usd2(r.costPerActiveUserHour)}. Consider increasing MIG slicing or raising Peak Coverage % to reduce burst reliance.</div>`;
  }

  const burstHoursPct = r.burstHoursShare * 100;
  if (burstHoursPct > 15) {
    alerts += `<div class="alert alert-warning">⚠️ High Burst Usage: ${fmt.pct(burstHoursPct)} of rack-hours priced at burst (${fmt.pct(r.burstCostShare * 100)} of compute spend). Raise Peak Coverage % under Provisioning Strategy to shift demand onto the committed baseline.</div>`;
  } else if (r.burstRackHours > 0) {
    alerts += `<div class="alert alert-info">✅ Scaling Efficiency: Healthy mix — ${fmt.pct(burstHoursPct)} burst hours (${fmt.pct(r.burstCostShare * 100)} of compute spend).</div>`;
  } else {
    alerts += `<div class="alert alert-success">🎯 Optimized Scaling: 100% of demand covered by committed capacity (no burst).</div>`;
  }
  alertBar.innerHTML = alerts;

  // Revenue Summary
  document.getElementById('revenue-summary-body').innerHTML = `
    <div class="stat-header">Revenue</div>
    <div class="stat-row">
      <span class="stat-label">Subscription Price (GBP)</span>
      <span class="stat-value">£${r.config.priceGBP}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Subscription Price (USD)</span>
      <span class="stat-value">${fmt.usd2(r.priceUSD)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Monthly Revenue</span>
      <span class="stat-value highlight">${fmt.usd(r.monthlyRevenue)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Annual Revenue (projected)</span>
      <span class="stat-value highlight">${fmt.usd(r.annualRevenue)}</span>
    </div>
    <hr class="stat-divider">
    <div class="stat-header">Costs</div>
    <div class="stat-row">
      <span class="stat-label">Compute (GPU racks)</span>
      <span class="stat-value">${fmt.usd(r.totalComputeCost)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Storage</span>
      <span class="stat-value">${fmt.usd(r.totalStorageCost)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Windows Licensing</span>
      <span class="stat-value">${fmt.usd(r.totalWindowsCost)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Public IPs</span>
      <span class="stat-value">${fmt.usd(r.totalIPCost)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total Costs</span>
      <span class="stat-value warning">${fmt.usd(r.totalInfraCosts)}</span>
    </div>
    <hr class="stat-divider">
    <div class="stat-header">Profit</div>
    <div class="stat-row">
      <span class="stat-label">Monthly Profit</span>
      <span class="stat-value ${r.monthlyProfit >= 0 ? 'highlight' : 'danger'}">${fmt.usd(r.monthlyProfit)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Annual Profit (projected)</span>
      <span class="stat-value ${r.annualProfit >= 0 ? 'highlight' : 'danger'}">${fmt.usd(r.annualProfit)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Gross Margin</span>
      <span class="stat-value ${r.grossMargin >= 30 ? 'highlight' : r.grossMargin >= 0 ? 'warning' : 'danger'}">${fmt.pct(r.grossMargin)}</span>
    </div>
  `;

  // Cost donut chart
  renderCostDonut(r);

  // Infra summary
  document.getElementById('infra-summary-body').innerHTML = `
    <div class="stat-row">
      <span class="stat-label">GPU Tier</span>
      <span class="stat-value">${r.gpuTierName}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Users per Rack ${tip(`GPUs/Rack (${r.gpusPerRack}) × MIG Slices/GPU (${r.usersPerGpu}) = ${r.usersPerRack}`)}</span>
      <span class="stat-value">${r.usersPerRack} (${r.gpusPerRack} GPUs × ${r.usersPerGpu} MIG slices)</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Avg Concurrent Users ${tip(`Total User-Hours (${fmt.num(r.totalUsageHours)}) ÷ Total Month Hours (${fmt.num1(r.totalMonthHours)}) = ${fmt.num1(r.avgConcurrentOverall)}`)}</span>
      <span class="stat-value">${fmt.num1(r.avgConcurrentOverall)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Avg Active Racks ${tip(`Total Rack-Hours (${fmt.num(Math.round(r.totalRackHours))}) ÷ Total Month Hours (${fmt.num1(r.totalMonthHours)}) = ${fmt.num1(r.avgRacksOverall)}`)}</span>
      <span class="stat-value">${fmt.num1(r.avgRacksOverall)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Peak Racks Required ${tip(`Peak concurrent users (${fmt.num(r.absolutePeakUsers)}) ÷ Users per Rack (${r.usersPerRack}) = ${r.maxRacksRaw} racks after rounding up.`)}</span>
      <span class="stat-value">${r.maxRacksRaw}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total Rack-Hours/mo ${tip(`For each window: Required Racks × Window Hours × Intra-Window Utilisation (${(r.config.intraWindowUtilPct*100).toFixed(0)}%). Then split into committed (${fmt.num(Math.round(r.committedRackHours))}) and burst (${fmt.num(Math.round(r.burstRackHours))}) rack-hours based on the ${r.committedRacks}-rack committed baseline. See Infrastructure tab for the full audit table.`)}</span>
      <span class="stat-value">${fmt.num(Math.round(r.totalRackHours))}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Committed Rate ${tip(`On-Demand (${fmt.usd2(r.onDemandPrice)}) × (1 − ContractDisc ${(r.config.contractDiscount*100).toFixed(0)}%) × (1 − IdleDisc ${(r.config.idleDiscount*100).toFixed(0)}%) = ${fmt.usd2(r.committedRate)}`)}</span>
      <span class="stat-value">${fmt.usd2(r.committedRate)}/rack/hr</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Burst Rate ${tip(`Committed Rate (${fmt.usd2(r.committedRate)}) × Burst Multiplier (${r.config.burstMultiplier.toFixed(2)}×) = ${fmt.usd2(r.burstRate)}`)}</span>
      <span class="stat-value ${r.burstCostShare > 0.15 ? 'warning' : ''}">${fmt.usd2(r.burstRate)}/rack/hr</span>
    </div>
  `;

  // Utilization & Demand
  const riskClass = r.scalingRisk === 'HIGH' ? 'risk-high' : r.scalingRisk === 'MEDIUM' ? 'risk-medium' : 'risk-low';
  document.getElementById('efficiency-body').innerHTML = `
    <div class="stat-row">
      <span class="stat-label">User Utilization (of ${r.config.hoursAllowance}hr cap) ${tip(`Avg Usage % configuration input. Users consume ${r.userUtilization.toFixed(1)}% of their ${r.config.hoursAllowance}hr monthly allowance.`)}</span>
      <span class="stat-value">${fmt.pct(r.userUtilization)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Avg Hours / User / Month ${tip(`Hours Allowance (${r.config.hoursAllowance}) × Avg Usage % (${(r.config.avgUsagePct*100).toFixed(0)}%) = ${fmt.num1(r.avgHoursPerUser)}`)}</span>
      <span class="stat-value">${fmt.num1(r.avgHoursPerUser)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total User-Hours / Month ${tip(`Avg Hours/User/Month (${fmt.num1(r.avgHoursPerUser)}) × Total Subscribers (${fmt.num(r.config.users)}) = ${fmt.num(r.totalUsageHours)}`)}</span>
      <span class="stat-value">${fmt.num(r.totalUsageHours)}</span>
    </div>
    <hr class="stat-divider">
    <div class="stat-row">
      <span class="stat-label">Peak Concurrent Users ${tip(`Each window gets a share of total monthly user-hours from the normalized demand shape. Window peak concurrent users = ceil(window avg concurrent × ${r.config.windowPeakOverAvgFactor.toFixed(1)}×). Absolute peak = max = ${fmt.num(r.absolutePeakUsers)}`)}</span>
      <span class="stat-value">${fmt.num(r.absolutePeakUsers)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Avg Concurrent Users ${tip(`Total User-Hours (${fmt.num(r.totalUsageHours)}) ÷ Total Month Hours (${fmt.num1(r.totalMonthHours)}) = ${fmt.num1(r.avgConcurrentOverall)}`)}</span>
      <span class="stat-value">${fmt.num1(r.avgConcurrentOverall)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Peak : Avg Ratio ${tip(`Peak Concurrent (${fmt.num(r.absolutePeakUsers)}) ÷ Avg Concurrent (${fmt.num1(r.avgConcurrentOverall)}) = ${fmt.num1(r.peakToAvgRatio)}×. Higher ratio = spikier load = more burst hours.`)}</span>
      <span class="stat-value">${fmt.num1(r.peakToAvgRatio)}×</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Scaling Risk ${tip(`LOW: ≤15 peak racks. MEDIUM: 16–30. HIGH: >30. Current peak = ${r.maxRacksRaw} racks.`)}</span>
      <span class="stat-value"><span class="risk-badge ${riskClass}">${r.scalingRisk}</span></span>
    </div>
    <hr class="stat-divider">
    <div class="stat-row">
      <span class="stat-label">$/Physical GPU/hr ${tip(`Total Compute Cost (${fmt.usd(r.totalComputeCost)}) ÷ ( Total Rack-Hours (${fmt.num(Math.round(r.totalRackHours))}) × GPUs/Rack (${r.gpusPerRack}) ) = ${fmt.usd4(r.costPerPhysicalGpuHour)}`)}</span>
      <span class="stat-value">${fmt.usd4(r.costPerPhysicalGpuHour)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">$/GPU-slice/hr (${r.usersPerGpu}:1 slicing) ${tip(`$/Physical GPU/hr (${fmt.usd4(r.costPerPhysicalGpuHour)}) ÷ Slices per GPU (${r.usersPerGpu}) = ${fmt.usd4(r.costPerSliceHour)}. Each physical GPU is shared across ${r.usersPerGpu} MIG slices, so the billed slice-hour cost is a fraction of the physical GPU-hour cost.`)}</span>
      <span class="stat-value ${r.costPerSliceHour <= 0.4 ? 'highlight' : 'warning'}">${fmt.usd4(r.costPerSliceHour)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">$/Active User-Hour (utilisation) ${tip(`Total Compute Cost (${fmt.usd(r.totalComputeCost)}) ÷ Total User-Hours (${fmt.num(r.totalUsageHours)}) = ${fmt.usd4(r.costPerActiveUserHour)}. Gap vs $/GPU-slice/hr reflects the residual fleet-level idle share after intra-window scaling (${(r.config.intraWindowUtilPct*100).toFixed(0)}%) — i.e. slices provisioned but not matched to an active user. Close the gap by raising Intra-Window Utilisation or MIG Slicing.`)}</span>
      <span class="stat-value ${r.costPerActiveUserHour <= 0.75 ? 'highlight' : 'warning'}">${fmt.usd4(r.costPerActiveUserHour)}</span>
    </div>
  `;

  // Logic panel
  document.getElementById('logic-content').innerHTML = `
    <div class="logic-step">
      <div class="logic-num">1</div>
      <div>
        <div class="logic-text">Monthly User-Consumption</div>
        <span class="logic-formula">${fmt.num(r.config.users)} users × ${fmt.num1(r.avgHoursPerUser)} avg hrs = <b>${fmt.num(r.totalUsageHours)} hours/mo</b></span>
      </div>
    </div>
    <div class="logic-step">
      <div class="logic-num">2</div>
      <div>
        <div class="logic-text">Demand Shape to Peak Capacity</div>
        <span class="logic-formula">Monthly user-hours are split across 4 windows, avg concurrency is derived from user-hours ÷ window-hours, then window peaks = avg × <b>${r.config.windowPeakOverAvgFactor.toFixed(1)}×</b>. Current absolute peak requires <b>${r.maxRacksRaw} racks</b>.</span>
      </div>
    </div>
    <div class="logic-step">
      <div class="logic-num">3</div>
      <div>
        <div class="logic-text">Provisioning and Billing Envelope</div>
        <div class="logic-formula">
          For each window: rack-hours = required racks × window hours × ${(r.config.intraWindowUtilPct*100).toFixed(0)}% intra-window utilisation.
          Baseline committed capacity = <b>${r.committedRacks} racks</b> from ${fmt.pct(r.config.peakCoveragePct * 100)} peak coverage plus the off-peak floor of ${r.offpeakFloorRacks} racks.
          Burst (${fmt.pct(r.burstHoursShare * 100)} of rack-hrs, ${fmt.pct(r.burstCostShare * 100)} of spend) billed at <b>${fmt.usd2(r.burstRate)}/hr</b>.
        </div>
      </div>
    </div>
    <div class="logic-step">
      <div class="logic-num">4</div>
      <div>
        <div class="logic-text">Financial Efficiency Index</div>
        <span class="logic-formula">Compute ${fmt.usd(r.totalComputeCost)} / ${fmt.num(r.totalUsageHours)} active user-hrs = <b>${fmt.usd4(r.costPerActiveUserHour)}</b> per active user-hour</span>
      </div>
    </div>
  `;
}

// ════════════════════════════════════
//  FINANCIALS TAB
// ════════════════════════════════════
function renderFinancials(r) {
  const c = r.config;
  document.getElementById('financials-content').innerHTML = `
    <div class="card card-full" style="margin-bottom:20px">
      <h3 class="card-title">Monthly P&L Statement</h3>
      <table class="fin-table">
        <thead>
          <tr><th>Line Item</th><th>Per Unit</th><th>Qty / Rate</th><th>Monthly Total</th></tr>
        </thead>
        <tbody>
          <tr class="subtotal-row"><td colspan="4">REVENUE</td></tr>
          <tr>
            <td>Subscription Revenue</td>
            <td>£${c.priceGBP}/user (${fmt.usd2(r.priceUSD)})</td>
            <td>${fmt.num(c.users)} users</td>
            <td>${fmt.usd(r.monthlyRevenue)}</td>
          </tr>
          <tr class="subtotal-row"><td colspan="3">Total Revenue</td><td>${fmt.usd(r.monthlyRevenue)}</td></tr>

          <tr><td colspan="4">&nbsp;</td></tr>
          <tr class="subtotal-row"><td colspan="4">COST OF GOODS — COMPUTE</td></tr>
          <tr>
            <td>Committed Rack-Hours ${tip(`Rack-hours served within the ${r.committedRacks}-rack committed baseline. Billed at ${fmt.usd2(r.committedRate)}/hr = On-Demand (${fmt.usd2(r.onDemandPrice)}) × (1 − contract ${(r.config.contractDiscount*100).toFixed(0)}%) × (1 − idle ${(r.config.idleDiscount*100).toFixed(0)}%).`)}</td>
            <td>${fmt.usd2(r.committedRate)}/rack-hr</td>
            <td>${fmt.num(Math.round(r.committedRackHours))} rack-hrs</td>
            <td>${fmt.usd(r.committedComputeCost)}</td>
          </tr>
          <tr>
            <td>Burst Rack-Hours ${tip(`Rack-hours demanded above the ${r.committedRacks}-rack committed baseline. Billed at Committed Rate (${fmt.usd2(r.committedRate)}) × Burst Multiplier (${r.config.burstMultiplier.toFixed(2)}×) = ${fmt.usd2(r.burstRate)}/hr.`)}</td>
            <td>${fmt.usd2(r.burstRate)}/rack-hr</td>
            <td>${fmt.num(Math.round(r.burstRackHours))} rack-hrs</td>
            <td>${fmt.usd(r.burstComputeCost)}</td>
          </tr>
          <tr class="subtotal-row"><td colspan="3">Total Compute ${tip(`Committed (${fmt.usd(r.committedComputeCost)}) + Burst (${fmt.usd(r.burstComputeCost)}) = ${fmt.usd(r.totalComputeCost)}. Burst share: ${fmt.pct(r.burstCostShare*100)}.`)}</td><td>${fmt.usd(r.totalComputeCost)}</td></tr>

          <tr><td colspan="4">&nbsp;</td></tr>
          <tr class="subtotal-row"><td colspan="4">COST OF GOODS — OTHER</td></tr>
          <tr>
            <td>Distributed File Storage</td>
            <td>${fmt.usd2(c.storageRate)}/GB/mo</td>
            <td>${c.storageGB}GB × ${fmt.num(c.users)} users</td>
            <td>${fmt.usd(r.totalStorageCost)}</td>
          </tr>
          <tr>
            <td>Windows BYOL Licensing</td>
            <td>${fmt.usd2(c.windowsCostPerUser)}/user/mo</td>
            <td>${fmt.num(c.users)} users</td>
            <td>${fmt.usd(r.totalWindowsCost)}</td>
          </tr>
          <tr>
            <td>Public IP Addresses</td>
            <td>$4.00/IP/mo</td>
            <td>${c.publicIPs} IPs</td>
            <td>${fmt.usd(r.totalIPCost)}</td>
          </tr>
          <tr class="subtotal-row"><td colspan="3">Total Other Costs</td><td>${fmt.usd(r.totalStorageCost + r.totalWindowsCost + r.totalIPCost)}</td></tr>

          <tr><td colspan="4">&nbsp;</td></tr>
          <tr class="total-row">
            <td colspan="3">TOTAL COSTS</td>
            <td>${fmt.usd(r.totalInfraCosts)}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3" style="color: ${r.monthlyProfit >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)'}">GROSS PROFIT</td>
            <td style="color: ${r.monthlyProfit >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)'}">${fmt.usd(r.monthlyProfit)}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3">GROSS MARGIN</td>
            <td style="color: ${r.grossMargin >= 30 ? 'var(--accent-emerald)' : r.grossMargin >= 0 ? 'var(--accent-amber)' : 'var(--accent-rose)'}">${fmt.pct(r.grossMargin)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div class="card">
        <h3 class="card-title">Per-User Economics</h3>
        <div class="stat-row"><span class="stat-label">Revenue per User</span><span class="stat-value">${fmt.usd2(r.priceUSD)}/mo</span></div>
        <div class="stat-row"><span class="stat-label">Total Cost per User</span><span class="stat-value">${fmt.usd2(r.totalCostPerUser)}/mo</span></div>
        <div class="stat-row"><span class="stat-label">Profit per User</span><span class="stat-value ${r.monthlyProfit >= 0 ? 'highlight' : 'danger'}">${fmt.usd2(r.priceUSD - r.totalCostPerUser)}/mo</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Cost per User Hour (total)</span><span class="stat-value">${fmt.usd2(r.totalCostPerUserHour)}</span></div>
        <div class="stat-row"><span class="stat-label">Cost per User Hour (compute only)</span><span class="stat-value">${fmt.usd2(r.costPerUserHourCompute)}</span></div>
        <div class="stat-row"><span class="stat-label">Revenue per User Hour</span><span class="stat-value highlight">${fmt.usd2(r.priceUSD / Math.max(r.avgHoursPerUser, 1))}</span></div>
      </div>
      <div class="card">
        <h3 class="card-title">Contract Pricing Breakdown</h3>
        <div class="stat-row"><span class="stat-label">On-Demand Rack Rate ${tip(`Published CoreWeave on-demand list price for an 8× ${r.gpuTierName} rack. Source: Engine.GPU_TIERS.`)}</span><span class="stat-value">${fmt.usd2(r.onDemandPrice)}/hr</span></div>
        <div class="stat-row"><span class="stat-label">After Contract Discount (${(r.config.contractDiscount * 100).toFixed(0)}%) ${tip(`On-Demand (${fmt.usd2(r.onDemandPrice)}) × (1 − ${(r.config.contractDiscount*100).toFixed(0)}%) = ${fmt.usd2(r.contractRate)}. Intermediate rate before idle-capacity discount.`)}</span><span class="stat-value">${fmt.usd2(r.contractRate)}/hr</span></div>
        <div class="stat-row"><span class="stat-label">Committed Rate (after Idle Discount ${(r.config.idleDiscount * 100).toFixed(0)}%) ${tip(`Contract Rate (${fmt.usd2(r.contractRate)}) × (1 − ${(r.config.idleDiscount*100).toFixed(0)}%) = ${fmt.usd2(r.committedRate)}. This is the canonical committed rack-hour price applied to the baseline.`)}</span><span class="stat-value highlight">${fmt.usd2(r.committedRate)}/hr</span></div>
        <div class="stat-row"><span class="stat-label">Burst Rate (${r.config.burstMultiplier.toFixed(2)}× premium) ${tip(`Committed Rate (${fmt.usd2(r.committedRate)}) × Burst Multiplier (${r.config.burstMultiplier.toFixed(2)}×) = ${fmt.usd2(r.burstRate)}. Applied to rack-hours demanded above the committed baseline.`)}</span><span class="stat-value warning">${fmt.usd2(r.burstRate)}/hr</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Total Saving vs On-Demand ${tip(`1 − (Committed Rate ${fmt.usd2(r.committedRate)} ÷ On-Demand ${fmt.usd2(r.onDemandPrice)}) = ${fmt.pct((1 - r.committedRate / r.onDemandPrice) * 100)}`)}</span><span class="stat-value highlight">${fmt.pct((1 - r.committedRate / r.onDemandPrice) * 100)}</span></div>
        <div class="stat-row"><span class="stat-label">$/Physical GPU/hr ${tip(`Total Compute Cost (${fmt.usd(r.totalComputeCost)}) ÷ ( Total Rack-Hours (${fmt.num(Math.round(r.totalRackHours))}) × GPUs/Rack (${r.gpusPerRack}) ) = ${fmt.usd4(r.costPerPhysicalGpuHour)}`)}</span><span class="stat-value">${fmt.usd4(r.costPerPhysicalGpuHour)}</span></div>
        <div class="stat-row"><span class="stat-label">$/GPU-slice/hr (${r.usersPerGpu}:1) ${tip(`$/Physical GPU/hr (${fmt.usd4(r.costPerPhysicalGpuHour)}) ÷ Slices/GPU (${r.usersPerGpu}) = ${fmt.usd4(r.costPerSliceHour)}`)}</span><span class="stat-value ${r.costPerSliceHour <= 0.4 ? 'highlight' : 'warning'}">${fmt.usd4(r.costPerSliceHour)}</span></div>
      </div>
    </div>

    <div class="card card-full" style="margin-top:20px">
      <h3 class="card-title">Annual Projection</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center;">
        <div>
          <div class="kpi-label">Annual Revenue</div>
          <div class="kpi-value neutral" style="font-size:1.3rem">${fmt.usd(r.annualRevenue)}</div>
        </div>
        <div>
          <div class="kpi-label">Annual Costs</div>
          <div class="kpi-value neutral" style="font-size:1.3rem">${fmt.usd(r.totalInfraCosts * 12)}</div>
        </div>
        <div>
          <div class="kpi-label">Annual Profit</div>
          <div class="kpi-value ${r.annualProfit >= 0 ? 'positive' : 'negative'}" style="font-size:1.3rem">${fmt.usd(r.annualProfit)}</div>
        </div>
        <div>
          <div class="kpi-label">Break-Even Users</div>
          <div class="kpi-value neutral" style="font-size:1.3rem">${fmt.num(r.breakEvenUsers)}</div>
        </div>
      </div>
    </div>
  `;
}

// ════════════════════════════════════
//  INFRASTRUCTURE TAB
// ════════════════════════════════════

// Per-window rack-hour derivation table — exposes every operand and an audit
// total so the user can verify no double-counting across the four windows.
function renderWindowTable(r) {
  const util = r.config.intraWindowUtilPct;
  const utilPctStr = (util * 100).toFixed(0) + '%';
  const rows = [
    r.windows.weekdayPeak,
    r.windows.weekdayOffpeak,
    r.windows.weekendPeak,
    r.windows.weekendOffpeak,
  ];

  const totalWindowHours = rows.reduce((sum, x) => sum + x.duration, 0);
  const totalUserHours = rows.reduce((sum, x) => sum + x.userHours, 0);
  const totalBilled = rows.reduce((sum, x) => sum + x.billedRackHours, 0);
  const totalCommitted = rows.reduce((sum, x) => sum + x.committed, 0);
  const totalBurst = rows.reduce((sum, x) => sum + x.burst, 0);

  const body = rows.map(x => `
    <tr>
      <td>${x.label}</td>
      <td>${fmt.pct(x.share * 100)}</td>
      <td>${fmt.num1(x.duration)}</td>
      <td>${fmt.num(Math.round(x.userHours))}</td>
      <td>${fmt.num1(x.avgConcurrent)}</td>
      <td>${fmt.num(x.peakConcurrent)}</td>
      <td>${x.peakRacks}</td>
      <td>${fmt.num(Math.round(x.committed))}</td>
      <td>${fmt.num(Math.round(x.burst))}</td>
      <td>${fmt.num(Math.round(x.billedRackHours))}
        ${tip(`Window share ${fmt.pct(x.share * 100)} of total user-hours gives ${fmt.num(Math.round(x.userHours))} user-hours. Avg concurrent = ${fmt.num(Math.round(x.userHours))} ÷ ${fmt.num1(x.duration)} = ${fmt.num1(x.avgConcurrent)}. Peak concurrent = ceil(${fmt.num1(x.avgConcurrent)} × ${r.config.windowPeakOverAvgFactor.toFixed(1)}) = ${x.peakConcurrent}. Required racks = ceil(${x.peakConcurrent} ÷ ${r.usersPerRack}) = ${x.peakRacks}. Billed rack-hours = ${x.peakRacks} × ${fmt.num1(x.duration)} × ${utilPctStr} = ${fmt.num(Math.round(x.billedRackHours))}.`)}
      </td>
    </tr>
  `).join('');

  // Audit row proves no overlap/double-count across the four windows.
  const auditHoursMatch = Math.abs(totalWindowHours - r.totalMonthHours) < 0.5;
  const auditUserHoursMatch = Math.abs(totalUserHours - r.totalUsageHours) < 1;

  return `
    <table class="fin-table">
      <thead>
        <tr>
          <th>Window</th>
          <th>Demand Share</th>
          <th>Window Hrs</th>
          <th>User-Hrs</th>
          <th>Avg Conc.</th>
          <th>Peak Conc.</th>
          <th>Peak Racks</th>
          <th>Committed Rack-Hrs</th>
          <th>Burst Rack-Hrs</th>
          <th>Billed Rack-Hrs</th>
        </tr>
      </thead>
      <tbody>
        ${body}
        <tr class="total-row">
          <td>Total</td>
          <td>${fmt.pct(rows.reduce((sum, x) => sum + x.share, 0) * 100)} ${tip(`Demand shares across the four windows must sum to 100%.`)}</td>
          <td>${fmt.num1(totalWindowHours)} ${tip(`Sum of window hours must equal total month hours (${fmt.num1(r.totalMonthHours)}). ${auditHoursMatch ? '✓ matches — no overlap/double-count.' : '⚠ mismatch!'}`)}</td>
          <td>${fmt.num(Math.round(totalUserHours))} ${tip(`Sum of per-window user-hours must equal total usage hours (${fmt.num(r.totalUsageHours)}). ${auditUserHoursMatch ? '✓ matches.' : '⚠ mismatch!'}`)}</td>
          <td>${fmt.num1(r.avgConcurrentOverall)}</td>
          <td>${fmt.num(r.absolutePeakUsers)} abs pk</td>
          <td>${r.maxRacksRaw}</td>
          <td>${fmt.num(Math.round(r.committedRackHours))}</td>
          <td>${fmt.num(Math.round(r.burstRackHours))}</td>
          <td>${fmt.num(Math.round(r.totalRackHours))}</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:14px;font-size:0.78rem;color:var(--text-secondary);line-height:1.55;">
      <strong style="color:var(--text-accent);">How each window is billed:</strong>
      Total monthly user-hours are distributed across the four windows using the normalized demand shape. Each window then derives avg concurrency from user-hours ÷ window-hours, converts that to peak concurrency using the ${r.config.windowPeakOverAvgFactor.toFixed(1)}× peak-over-average factor, and sizes racks from that peak. Billed rack-hours = required racks × window hours × intra-window utilisation (${utilPctStr}). Committed vs Burst within each window: anything ≤ ${r.committedRacks}-rack baseline bills at ${fmt.usd2(r.committedRate)}/hr; excess bills at ${fmt.usd2(r.burstRate)}/hr.
      <br><br>
      <strong style="color:var(--text-accent);">Audit:</strong>
      ${auditHoursMatch ? '✅' : '⚠️'} Window hours sum to ${fmt.num1(totalWindowHours)} (expected ${fmt.num1(r.totalMonthHours)}).
      ${auditUserHoursMatch ? '✅' : '⚠️'} User-hours sum to ${fmt.num(Math.round(totalUserHours))} (expected ${fmt.num(r.totalUsageHours)}).
      No window overlaps: weekday (24−${r.config.peakHoursWeekday} off-peak + ${r.config.peakHoursWeekday} peak) × 5 days + weekend (24−${r.config.peakHoursWeekend} + ${r.config.peakHoursWeekend}) × 2 days per week × ${Engine.CALENDAR_CONSTANTS.weeksPerMonth} weeks.
    </div>
  `;
}

function renderInfra(r) {
  const c = r.config;
  const l40s = Engine.GPU_TIERS.l40s;
  const rtx = Engine.GPU_TIERS.rtx6000;

  document.getElementById('infra-content').innerHTML = `
    <div class="infra-grid">
      <div class="card">
        <h3 class="card-title">GPU Tier Specifications</h3>
        <div class="gpu-tier-card">
          <div class="gpu-tier-name">${l40s.name}</div>
          <div class="gpu-spec">
            <span>${l40s.gpuCount} GPUs</span>
            <span>${l40s.vramGB}GB VRAM</span>
            <span>${l40s.vCPUs} vCPUs</span>
            <span>${l40s.ramGB}GB RAM</span>
            <span>${l40s.storageTB}TB NVMe</span>
          </div>
          <div class="stat-row"><span class="stat-label">On-Demand</span><span class="stat-value">${fmt.usd2(l40s.onDemandPrice)}/hr</span></div>
          <div class="stat-row"><span class="stat-label">Spot</span><span class="stat-value" style="color:var(--text-muted)">N/A</span></div>
        </div>
        <div class="gpu-tier-card">
          <div class="gpu-tier-name">${rtx.name}</div>
          <div class="gpu-spec">
            <span>${rtx.gpuCount} GPUs</span>
            <span>${rtx.vramGB}GB VRAM</span>
            <span>${rtx.vCPUs} vCPUs</span>
            <span>${rtx.ramGB}GB RAM</span>
            <span>${rtx.storageTB}TB NVMe</span>
          </div>
          <div class="stat-row"><span class="stat-label">On-Demand</span><span class="stat-value">${fmt.usd2(rtx.onDemandPrice)}/hr</span></div>
          <div class="stat-row"><span class="stat-label">Spot</span><span class="stat-value highlight">${fmt.usd2(rtx.spotPrice)}/hr</span></div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Active Configuration</h3>
        <div class="stat-row"><span class="stat-label">Selected Tier</span><span class="stat-value">${r.gpuTierName}</span></div>
        <div class="stat-row"><span class="stat-label">GPUs per Rack</span><span class="stat-value">${r.gpusPerRack}</span></div>
        <div class="stat-row"><span class="stat-label">MIG Slices per GPU</span><span class="stat-value">${r.usersPerGpu}</span></div>
        <div class="stat-row"><span class="stat-label">Users per Rack ${tip(`GPUs/Rack (${r.gpusPerRack}) × Slices/GPU (${r.usersPerGpu}) = ${r.usersPerRack}`)}</span><span class="stat-value highlight">${r.usersPerRack}</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">On-Demand Rack Rate ${tip(`Published CoreWeave on-demand list price for this 8× GPU tier — sourced from Engine.GPU_TIERS (${r.gpuTierName}: ${fmt.usd2(r.onDemandPrice)}/rack-hr).`)}</span><span class="stat-value">${fmt.usd2(r.onDemandPrice)}/hr</span></div>
        <div class="stat-row"><span class="stat-label">Committed Rate ${tip(`On-Demand (${fmt.usd2(r.onDemandPrice)}) × (1 − contract ${(r.config.contractDiscount*100).toFixed(0)}%) × (1 − idle ${(r.config.idleDiscount*100).toFixed(0)}%) = ${fmt.usd2(r.committedRate)}`)}</span><span class="stat-value">${fmt.usd2(r.committedRate)}/hr</span></div>
        <div class="stat-row"><span class="stat-label">Burst Rate ${tip(`Committed Rate (${fmt.usd2(r.committedRate)}) × Burst Multiplier (${r.config.burstMultiplier.toFixed(2)}×) = ${fmt.usd2(r.burstRate)}`)}</span><span class="stat-value warning">${fmt.usd2(r.burstRate)}/hr</span></div>
        <div class="stat-row"><span class="stat-label">Discount from On-Demand ${tip(`1 − (${fmt.usd2(r.committedRate)} ÷ ${fmt.usd2(r.onDemandPrice)}) = ${fmt.pct((1 - r.committedRate/r.onDemandPrice)*100)}`)}</span><span class="stat-value highlight">${fmt.pct((1 - r.committedRate / r.onDemandPrice) * 100)}</span></div>
      </div>

      <div class="card card-wide">
        <h3 class="card-title">Usage Distribution &amp; Rack-Hour Derivation — Time Windows</h3>
        ${renderWindowTable(r)}
      </div>

      <div class="card">
        <h3 class="card-title">Dynamic Provisioning</h3>
        <div class="stat-row"><span class="stat-label">Peak Racks Needed ${tip(`Absolute peak concurrent users (${fmt.num(r.absolutePeakUsers)}) ÷ Users/Rack (${r.usersPerRack}) = ${r.maxRacksRaw} racks after rounding up.`)}</span><span class="stat-value">${r.maxRacksRaw}</span></div>
        <div class="stat-row"><span class="stat-label">Committed Baseline ${tip(`max( ceil( Peak Racks (${r.maxRacksRaw}) × Coverage (${(r.config.peakCoveragePct*100).toFixed(0)}%) ) = ${r.peakCoverageRacks}, Off-Peak Floor = ${r.offpeakFloorRacks} ) = ${r.committedRacks} racks`)}</span><span class="stat-value highlight">${r.committedRacks} racks</span></div>
        <div class="stat-row"><span class="stat-label">Avg Active Racks ${tip(`Total Rack-Hours (${fmt.num(Math.round(r.totalRackHours))}) ÷ Total Month Hours (${fmt.num1(r.totalMonthHours)}) = ${fmt.num1(r.avgRacksOverall)}`)}</span><span class="stat-value">${fmt.num1(r.avgRacksOverall)}</span></div>
        <div class="stat-row"><span class="stat-label">Dynamic Range</span><span class="stat-value">${fmt.num1(Math.min(r.avgRacksWdOff, r.avgRacksWeOff))}–${r.maxRacksRaw} racks</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Committed Rack-Hours ${tip(`For each window: min(required racks, ${r.committedRacks}) × window hours × intra-window utilisation (${(r.config.intraWindowUtilPct*100).toFixed(0)}%). Sum across 4 windows = ${fmt.num(Math.round(r.committedRackHours))}`)}</span><span class="stat-value">${fmt.num(Math.round(r.committedRackHours))}</span></div>
        <div class="stat-row"><span class="stat-label">Burst Rack-Hours ${tip(`For each window: max(0, required racks − ${r.committedRacks}) × window hours × intra-window utilisation (${(r.config.intraWindowUtilPct*100).toFixed(0)}%). Total burst rack-hours = ${fmt.num(Math.round(r.burstRackHours))} (${fmt.pct(r.burstHoursShare*100)} of total).`)}</span><span class="stat-value ${r.burstHoursShare > 0.15 ? 'warning' : ''}">${fmt.num(Math.round(r.burstRackHours))}</span></div>
        <div class="stat-row"><span class="stat-label">Total Rack-Hours/mo ${tip(`Committed Rack-Hours (${fmt.num(Math.round(r.committedRackHours))}) + Burst Rack-Hours (${fmt.num(Math.round(r.burstRackHours))}) = ${fmt.num(Math.round(r.totalRackHours))}`)}</span><span class="stat-value highlight">${fmt.num(Math.round(r.totalRackHours))}</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Committed Cost ${tip(`${fmt.num(Math.round(r.committedRackHours))} rack-hrs × ${fmt.usd2(r.committedRate)}/hr = ${fmt.usd(r.committedComputeCost)}`)}</span><span class="stat-value">${fmt.usd(r.committedComputeCost)}</span></div>
        <div class="stat-row"><span class="stat-label">Burst Cost ${tip(`${fmt.num(Math.round(r.burstRackHours))} rack-hrs × ${fmt.usd2(r.burstRate)}/hr = ${fmt.usd(r.burstComputeCost)} (${fmt.pct(r.burstCostShare*100)} of compute)`)}</span><span class="stat-value ${r.burstCostShare > 0.15 ? 'warning' : ''}">${fmt.usd(r.burstComputeCost)}</span></div>
        <div class="stat-row"><span class="stat-label">Total Compute Cost</span><span class="stat-value">${fmt.usd(r.totalComputeCost)}</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Networking</span><span class="stat-value highlight">Free (CoreWeave)</span></div>
        <div class="stat-row"><span class="stat-label">NAT / VPC / Egress</span><span class="stat-value highlight">Free</span></div>
        <div class="stat-row"><span class="stat-label">IOPS</span><span class="stat-value highlight">Free</span></div>
      </div>
    </div>
  `;
}

// ════════════════════════════════════
//  SCENARIOS TAB
// ════════════════════════════════════
function renderScenarios() {
  const scenarios = Engine.calculateScenarios();
  const s = scenarios;

  function scenarioCard(label, subtitle, data, cssClass) {
    return `
      <div class="scenario-card ${cssClass}">
        <div class="scenario-title">${label}</div>
        <div class="scenario-subtitle">${subtitle}</div>
        <div class="stat-row"><span class="stat-label">Revenue</span><span class="stat-value">${fmt.usd(data.monthlyRevenue)}</span></div>
        <div class="stat-row"><span class="stat-label">Compute Cost</span><span class="stat-value">${fmt.usd(data.totalComputeCost)}</span></div>
        <div class="stat-row"><span class="stat-label">Total Costs</span><span class="stat-value">${fmt.usd(data.totalInfraCosts)}</span></div>
        <div class="stat-row"><span class="stat-label">Profit</span><span class="stat-value ${data.monthlyProfit >= 0 ? 'highlight' : 'danger'}">${fmt.usd(data.monthlyProfit)}</span></div>
        <div class="stat-row"><span class="stat-label">Margin</span><span class="stat-value ${data.grossMargin >= 30 ? 'highlight' : data.grossMargin >= 0 ? 'warning' : 'danger'}">${fmt.pct(data.grossMargin)}</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Peak Concurrent</span><span class="stat-value">${fmt.num(data.absolutePeakUsers)}</span></div>
        <div class="stat-row"><span class="stat-label">Racks (peak)</span><span class="stat-value">${data.maxRacksRaw}</span></div>
        <div class="stat-row"><span class="stat-label">Rack-Hours</span><span class="stat-value">${fmt.num(Math.round(data.totalRackHours))}</span></div>
        <div class="stat-row"><span class="stat-label">Cost/User/hr</span><span class="stat-value">${fmt.usd2(data.totalCostPerUserHour)}</span></div>
        <div class="stat-row"><span class="stat-label">$/GPU-slice/hr</span><span class="stat-value">${fmt.usd4(data.costPerSliceHour)}</span></div>
        <div class="stat-row"><span class="stat-label">Burst Share (cost)</span><span class="stat-value ${data.burstCostShare > 0.15 ? 'warning' : ''}">${fmt.pct(data.burstCostShare * 100)}</span></div>
        <hr class="stat-divider">
        <div class="stat-row"><span class="stat-label">Avg Usage</span><span class="stat-value">${fmt.pct(data.config.avgUsagePct * 100)}</span></div>
        <div class="stat-row"><span class="stat-label">Weekend Share</span><span class="stat-value">${fmt.pct(data.config.weekendSharePct * 100)}</span></div>
        <div class="stat-row"><span class="stat-label">Peak/Avg Factor</span><span class="stat-value">${data.config.windowPeakOverAvgFactor.toFixed(1)}×</span></div>
        <div class="stat-row"><span class="stat-label">Users/GPU (MIG)</span><span class="stat-value">${fmt.num1(data.usersPerGpu)}</span></div>
        <div class="stat-row"><span class="stat-label">Scaling Risk</span><span class="stat-value"><span class="risk-badge risk-${data.scalingRisk.toLowerCase()}">${data.scalingRisk}</span></span></div>
      </div>
    `;
  }

  document.getElementById('scenarios-content').innerHTML = `
    <div class="scenario-grid">
      ${scenarioCard('Optimistic', 'Lower usage, smoother demand shape, stronger contracts', s.optimistic, 'optimistic')}
      ${scenarioCard('Expected', 'Current configuration values', s.expected, 'expected')}
      ${scenarioCard('Pessimistic', 'Higher usage, sharper peaks, thinner commitment', s.pessimistic, 'pessimistic')}
    </div>
    
    <div class="card card-full" style="margin-top:20px">
      <h3 class="card-title">Scenario Assumptions</h3>
      <table class="fin-table">
        <thead><tr><th>Parameter</th><th>Optimistic</th><th>Expected</th><th>Pessimistic</th></tr></thead>
        <tbody>
          <tr><td>Avg Usage %</td><td>${(s.optimistic.config.avgUsagePct * 100).toFixed(0)}%</td><td>${(s.expected.config.avgUsagePct * 100).toFixed(0)}%</td><td>${(s.pessimistic.config.avgUsagePct * 100).toFixed(0)}%</td></tr>
          <tr><td>Weekend Share</td><td>${(s.optimistic.config.weekendSharePct * 100).toFixed(0)}%</td><td>${(s.expected.config.weekendSharePct * 100).toFixed(0)}%</td><td>${(s.pessimistic.config.weekendSharePct * 100).toFixed(0)}%</td></tr>
          <tr><td>Weekday Peak Intensity</td><td>${s.optimistic.config.weekdayPeakIntensity.toFixed(1)}×</td><td>${s.expected.config.weekdayPeakIntensity.toFixed(1)}×</td><td>${s.pessimistic.config.weekdayPeakIntensity.toFixed(1)}×</td></tr>
          <tr><td>Weekend Peak Intensity</td><td>${s.optimistic.config.weekendPeakIntensity.toFixed(1)}×</td><td>${s.expected.config.weekendPeakIntensity.toFixed(1)}×</td><td>${s.pessimistic.config.weekendPeakIntensity.toFixed(1)}×</td></tr>
          <tr><td>Window Peak Over Avg</td><td>${s.optimistic.config.windowPeakOverAvgFactor.toFixed(1)}×</td><td>${s.expected.config.windowPeakOverAvgFactor.toFixed(1)}×</td><td>${s.pessimistic.config.windowPeakOverAvgFactor.toFixed(1)}×</td></tr>
          <tr><td>Contract Discount</td><td>${(s.optimistic.config.contractDiscount * 100).toFixed(0)}%</td><td>${(s.expected.config.contractDiscount * 100).toFixed(0)}%</td><td>${(s.pessimistic.config.contractDiscount * 100).toFixed(0)}%</td></tr>
          <tr><td>Idle Discount</td><td>${(s.optimistic.config.idleDiscount * 100).toFixed(0)}%</td><td>${(s.expected.config.idleDiscount * 100).toFixed(0)}%</td><td>${(s.pessimistic.config.idleDiscount * 100).toFixed(0)}%</td></tr>
          <tr><td>Burst Multiplier</td><td>${s.optimistic.config.burstMultiplier.toFixed(2)}×</td><td>${s.expected.config.burstMultiplier.toFixed(2)}×</td><td>${s.pessimistic.config.burstMultiplier.toFixed(2)}×</td></tr>
          <tr><td>Peak Coverage %</td><td>${(s.optimistic.config.peakCoveragePct*100).toFixed(0)}%</td><td>${(s.expected.config.peakCoveragePct*100).toFixed(0)}%</td><td>${(s.pessimistic.config.peakCoveragePct*100).toFixed(0)}%</td></tr>
          <tr><td>Intra-Window Util %</td><td>${(s.optimistic.config.intraWindowUtilPct*100).toFixed(0)}%</td><td>${(s.expected.config.intraWindowUtilPct*100).toFixed(0)}%</td><td>${(s.pessimistic.config.intraWindowUtilPct*100).toFixed(0)}%</td></tr>
          <tr><td>MIG Slices/GPU</td><td>${fmt.num1(s.optimistic.usersPerGpu)}</td><td>${fmt.num1(s.expected.usersPerGpu)}</td><td>${fmt.num1(s.pessimistic.usersPerGpu)}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

// ════════════════════════════════════
//  CHARTS
// ════════════════════════════════════
function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

const chartColors = {
  blue: 'rgba(99, 102, 241, 1)',
  blueAlpha: 'rgba(99, 102, 241, 0.15)',
  purple: 'rgba(139, 92, 246, 1)',
  purpleAlpha: 'rgba(139, 92, 246, 0.15)',
  emerald: 'rgba(52, 211, 153, 1)',
  emeraldAlpha: 'rgba(52, 211, 153, 0.15)',
  amber: 'rgba(251, 191, 36, 1)',
  amberAlpha: 'rgba(251, 191, 36, 0.15)',
  rose: 'rgba(251, 113, 133, 1)',
  roseAlpha: 'rgba(251, 113, 133, 0.15)',
  cyan: 'rgba(34, 211, 238, 1)',
  cyanAlpha: 'rgba(34, 211, 238, 0.15)',
  orange: 'rgba(249, 115, 22, 1)',
  orangeAlpha: 'rgba(249, 115, 22, 0.15)',
};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
  },
  scales: {
    x: { ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
    y: { ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
  },
};

function renderCostDonut(r) {
  destroyChart('cost-donut');
  const ctx = document.getElementById('chart-cost-donut');
  if (!ctx) return;
  chartInstances['cost-donut'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Compute', 'Storage', 'Windows', 'IPs'],
      datasets: [{
        data: [r.totalComputeCost, r.totalStorageCost, r.totalWindowsCost, r.totalIPCost],
        backgroundColor: [chartColors.blue, chartColors.purple, chartColors.amber, chartColors.cyan],
        borderColor: 'rgba(0,0,0,0.3)',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12 } },
      },
    },
  });
}

function renderCharts() {
  const cfg = Engine.readConfig();

  // 1. Profit vs Users
  destroyChart('profit-users');
  const profitData = Engine.sensitivityProfitVsUsers(cfg);
  const ctx1 = document.getElementById('chart-profit-users');
  if (ctx1) {
    chartInstances['profit-users'] = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: profitData.map(d => d.users),
        datasets: [
          {
            label: 'Monthly Profit ($)',
            data: profitData.map(d => d.profit),
            borderColor: chartColors.emerald,
            backgroundColor: chartColors.emeraldAlpha,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Revenue ($)',
            data: profitData.map(d => d.revenue),
            borderColor: chartColors.blue,
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 0,
          },
          {
            label: 'Costs ($)',
            data: profitData.map(d => d.costs),
            borderColor: chartColors.rose,
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmt.usd(ctx.raw)}`,
            },
          },
        },
        scales: {
          ...chartDefaults.scales,
          x: { ...chartDefaults.scales.x, title: { display: true, text: 'Subscribers', color: '#64748b' } },
          y: { ...chartDefaults.scales.y, title: { display: true, text: 'USD / month', color: '#64748b' } },
        },
      },
    });
  }

  // 2. Margin vs Peak Factor
  destroyChart('margin-concurrency');
  const marginData = Engine.sensitivityMarginVsPeakFactor(cfg);
  const ctx2 = document.getElementById('chart-margin-concurrency');
  if (ctx2) {
    chartInstances['margin-concurrency'] = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: marginData.map(d => d.peakFactor.toFixed(1) + 'x'),
        datasets: [{
          label: 'Gross Margin (%)',
          data: marginData.map(d => d.margin),
          backgroundColor: marginData.map(d => d.margin >= 30 ? chartColors.emerald : d.margin >= 0 ? chartColors.amber : chartColors.rose),
          borderRadius: 4,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          x: { ...chartDefaults.scales.x, title: { display: true, text: 'Window Peak / Avg Factor', color: '#64748b' } },
          y: { ...chartDefaults.scales.y, title: { display: true, text: 'Gross Margin %', color: '#64748b' } },
        },
      },
    });
  }

  // 3. Cost/User-Hour vs MIG Slicing
  destroyChart('cost-slicing');
  const slicingData = Engine.sensitivityCostVsSlicing(cfg);
  const ctx3 = document.getElementById('chart-cost-slicing');
  if (ctx3) {
    chartInstances['cost-slicing'] = new Chart(ctx3, {
      type: 'line',
      data: {
        labels: slicingData.map(d => d.slicing + ':1'),
        datasets: [
          {
            label: 'Cost/User Hour ($)',
            data: slicingData.map(d => d.costPerUserHour),
            borderColor: chartColors.purple,
            backgroundColor: chartColors.purpleAlpha,
            fill: true,
            tension: 0.3,
            yAxisID: 'y',
          },
          {
            label: 'Gross Margin (%)',
            data: slicingData.map(d => d.margin),
            borderColor: chartColors.cyan,
            backgroundColor: 'transparent',
            tension: 0.3,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        ...chartDefaults,
        scales: {
          x: { ...chartDefaults.scales.x, title: { display: true, text: 'MIG Slices per GPU', color: '#64748b' } },
          y: { ...chartDefaults.scales.y, position: 'left', title: { display: true, text: '$/User Hour', color: '#64748b' } },
          y1: {
            ...chartDefaults.scales.y,
            position: 'right',
            title: { display: true, text: 'Margin %', color: '#64748b' },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  // 4. Burst Share vs Coverage
  destroyChart('scale-projection');
  const scaleData = Engine.sensitivityBurstVsCoverage(cfg);
  const ctx4 = document.getElementById('chart-scale-projection');
  if (ctx4) {
    chartInstances['scale-projection'] = new Chart(ctx4, {
      type: 'line',
      data: {
        labels: scaleData.map(d => d.coverage + '%'),
        datasets: [
          {
            label: 'Burst Cost Share (%)',
            data: scaleData.map(d => d.burstShare),
            borderColor: chartColors.orange,
            backgroundColor: chartColors.orangeAlpha,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Monthly Profit ($)',
            data: scaleData.map(d => d.profit),
            borderColor: chartColors.emerald,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 2,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        ...chartDefaults,
        scales: {
          x: { ...chartDefaults.scales.x, title: { display: true, text: 'Peak Coverage %', color: '#64748b' } },
          y: { ...chartDefaults.scales.y, position: 'left', title: { display: true, text: 'Burst Cost Share %', color: '#64748b' } },
          y1: {
            ...chartDefaults.scales.y,
            position: 'right',
            title: { display: true, text: 'Monthly Profit (USD)', color: '#64748b' },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }
}

// ════════════════════════════════════
//  INIT
// ════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initPresets();
  initInputListeners();
  recalculate();
});
