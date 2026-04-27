/* ================================================
   Cloud Gaming Cost Calculator — Calculation Engine
   ================================================
   
   This engine models cloud gaming infrastructure costs
   with the following corrected principles:
   
   1. DYNAMIC PROVISIONING: Racks spin up/down based on 
      actual concurrent demand per time window. You pay 
      rack-hours only for racks that are actively serving users.
   
   2. CONSERVED USER-HOURS: Subscribers × allowance ×
      realised usage determines total delivered user-hours.
      A normalized demand shape allocates those user-hours
      across the month, and concurrency is derived from the
      same allocation rather than injected separately.
   
   3. TIME-WINDOWED MODEL: The month is divided into 
      distinct time windows (weekday peak, weekday off-peak, 
      weekend peak, weekend off-peak). Each window gets a
      share of monthly playtime, from which average and peak
      concurrency are derived.
   
   4. GPU SLICING: Users per rack = GPUs × slices per GPU.
      This directly constrains concurrency capacity.
   
   5. OVERSUBSCRIPTION: You can sell more subscriptions 
      than simultaneous capacity supports, relying on 
      not everyone being online at once.
   ================================================ */

const Engine = {

  /* ──────────────────────────────────────────────────────────────
     GPU Tier Specifications
     Source: CoreWeave published GPU rack (8×) on-demand pricing.
     These are PRE-DISCOUNT rack-hour rates; contract/idle/burst
     modifiers are applied downstream via `readConfig`.
     ────────────────────────────────────────────────────────────── */
  GPU_TIERS: {
    l40s: {
      name: 'NVIDIA L40S',
      gpuCount: 8,
      vramGB: 48,
      vCPUs: 128,
      ramGB: 1024,
      storageTB: 7.68,
      onDemandPrice: 18.00, // 8× L40S rack
      spotPrice: null,      // Spot not offered for L40S
    },
    rtx6000: {
      name: 'RTX PRO 6000 Blackwell Server Edition',
      gpuCount: 8,
      vramGB: 96,
      vCPUs: 128,
      ramGB: 1024,
      storageTB: 7.68,
      onDemandPrice: 20.00, // 8× RTX PRO 6000 Blackwell rack
      spotPrice: 9.24,
    },
  },

  /* Fleet-mix weights for the "Mixed Fleet" tier selection */
  MIX_WEIGHTS: { l40s: 0.70, rtx6000: 0.30 },

  /* Calendar constants */
  CALENDAR_CONSTANTS: {
    weeksPerMonth: 4.345,
  },

  /* Provisioning defaults (apply when UI inputs are absent) */
  PROVISIONING_DEFAULTS: {
    // % of absolute-peak rack demand covered by committed baseline.
    // Well-negotiated cloud-gaming contracts cover routine peak/weekend
    // cycles under commitment; burst is reserved for unforecasted spikes.
    peakCoveragePct: 95,
    // Off-peak floor — committed baseline will never fall below the racks
    // required to serve off-peak demand (ensures we don't burst at night).
    enforceOffpeakFloor: true,
    // Intra-window utilisation: fraction of a time-window's duration the
    // window-peak-sized fleet is actually billed. Models dynamic scale-down
    // (K8s HPA / CoreWeave autoscaling) within a window as concurrency
    // ramps up and fades, so you aren't billed for peak-sized capacity
    // during the ramp/taper portions of the window.
    intraWindowUtilPct: 70,
  },

  /* Normalized demand-shape defaults */
  DEMAND_SHAPE_DEFAULTS: {
    // Share of total monthly playtime that lands on weekends.
    weekendSharePct: 40,
    // Intensity of peak hours relative to off-peak within weekdays/weekends.
    weekdayPeakIntensity: 3.0,
    weekendPeakIntensity: 3.8,
    // Peak concurrent users inside a window relative to the average concurrent
    // users across that window.
    windowPeakOverAvgFactor: 2.0,
  },

  /* ===== Read all config inputs ===== */
  readConfig() {
    const val = (id, fallback) => {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = parseFloat(el.value);
      return isNaN(v) ? fallback : v;
    };
    const sel = (id, fallback) => {
      const el = document.getElementById(id);
      return el ? el.value : fallback;
    };

    return {
      // Demand
      users: val('cfg-users', 1000),
      priceGBP: val('cfg-price', 50),
      gbpToUsd: val('cfg-gbp-usd', 1.26),
      hoursAllowance: val('cfg-hours-allowance', 100),
      // Divide by 100 to convert UI percentage (0-100) to ratio (0-1)
      avgUsagePct: val('cfg-avg-usage', 50) / 100,

      // Demand Shape
      weekendSharePct: val('cfg-weekend-share', this.DEMAND_SHAPE_DEFAULTS.weekendSharePct) / 100,
      weekdayPeakIntensity: val('cfg-weekday-peak-intensity', this.DEMAND_SHAPE_DEFAULTS.weekdayPeakIntensity),
      weekendPeakIntensity: val('cfg-weekend-peak-intensity', this.DEMAND_SHAPE_DEFAULTS.weekendPeakIntensity),
      windowPeakOverAvgFactor: val('cfg-window-peak-factor', this.DEMAND_SHAPE_DEFAULTS.windowPeakOverAvgFactor),

      // GPU — per-tier configuration
      gpuTier: sel('cfg-gpu-tier', 'l40s'),
      l40sGpusPerRack: val('cfg-l40s-gpus-per-rack', 8),
      l40sUsersPerGpu: val('cfg-l40s-users-per-gpu', 2),
      rtx6000GpusPerRack: val('cfg-rtx6000-gpus-per-rack', 8),
      rtx6000UsersPerGpu: val('cfg-rtx6000-users-per-gpu', 4),

      // Contracts
      contractDiscount: val('cfg-contract-discount', 60) / 100,
      idleDiscount: val('cfg-idle-discount', 20) / 100,
      // Burst premium applied as a MULTIPLIER of the fully-blended committed rate
      // (rate after both contract + idle discounts). 1.5× means burst rack-hours
      // are priced 50% above committed rack-hours.
      burstMultiplier: val('cfg-burst-multiplier', 1.5),

      // Provisioning Strategy
      peakCoveragePct: val('cfg-peak-coverage', this.PROVISIONING_DEFAULTS.peakCoveragePct) / 100,
      intraWindowUtilPct: val('cfg-intra-window-util', this.PROVISIONING_DEFAULTS.intraWindowUtilPct) / 100,

      // Other costs
      storageGB: val('cfg-storage-gb', 150),
      storageRate: val('cfg-storage-rate', 0.05),
      windowsCostPerUser: val('cfg-windows-cost', 7),
      publicIPs: val('cfg-public-ips', 50),

      // Time
      peakHoursWeekday: val('cfg-peak-hours-weekday', 5),
      peakHoursWeekend: val('cfg-peak-hours-weekend', 10),
    };
  },

  /* ===== Core Calculation ===== */
  calculate(configOverride = null) {
    const cfg = configOverride || this.readConfig();
    const r = {}; // results

    // ── Revenue ──
    r.priceUSD = cfg.priceGBP * cfg.gbpToUsd;
    r.monthlyRevenue = cfg.users * r.priceUSD;
    r.annualRevenue = r.monthlyRevenue * 12;

    // ── GPU Tier Details ──
    if (cfg.gpuTier === 'mixed') {
      const l40s = this.GPU_TIERS.l40s;
      const rtx = this.GPU_TIERS.rtx6000;
      const wL = this.MIX_WEIGHTS.l40s;
      const wR = this.MIX_WEIGHTS.rtx6000;
      // Weighted physical GPUs/rack from per-tier config (must match users/rack weights)
      r.gpusPerRack = Math.round(cfg.l40sGpusPerRack * wL + cfg.rtx6000GpusPerRack * wR);
      r.usersPerGpu = (cfg.l40sUsersPerGpu * wL + cfg.rtx6000UsersPerGpu * wR);
      r.usersPerRack = (cfg.l40sGpusPerRack * cfg.l40sUsersPerGpu * wL) + (cfg.rtx6000GpusPerRack * cfg.rtx6000UsersPerGpu * wR);
      r.onDemandPrice = (l40s.onDemandPrice * wL + rtx.onDemandPrice * wR);
      r.gpuTierName = `Mixed Fleet (${Math.round(wL * 100)}% L40S / ${Math.round(wR * 100)}% RTX6000)`;
    } else {
      const tier = this.GPU_TIERS[cfg.gpuTier];
      r.gpusPerRack = cfg.gpuTier === 'l40s' ? cfg.l40sGpusPerRack : cfg.rtx6000GpusPerRack;
      r.usersPerGpu = cfg.gpuTier === 'l40s' ? cfg.l40sUsersPerGpu : cfg.rtx6000UsersPerGpu;
      r.usersPerRack = r.gpusPerRack * r.usersPerGpu;
      r.onDemandPrice = tier.onDemandPrice;
      r.gpuTierName = tier.name;
    }

    // ── Average Usage (Basis for Commitment) ──
    r.avgHoursPerUser = cfg.hoursAllowance * cfg.avgUsagePct;
    r.totalUsageHours = cfg.users * r.avgHoursPerUser;
    
    // Total hours in a month (~730)
    const weeksPerMonth = this.CALENDAR_CONSTANTS.weeksPerMonth;
    r.totalMonthHours = 24 * 7 * weeksPerMonth;

    // ── Time Windows ──
    const weekdaysPerMonth = weeksPerMonth * 5;
    const weekendDaysPerMonth = weeksPerMonth * 2;
    r.peakHoursWeekdayTotal = weekdaysPerMonth * cfg.peakHoursWeekday;
    r.offpeakHoursWeekdayTotal = weekdaysPerMonth * (24 - cfg.peakHoursWeekday);
    r.peakHoursWeekendTotal = weekendDaysPerMonth * cfg.peakHoursWeekend;
    r.offpeakHoursWeekendTotal = weekendDaysPerMonth * (24 - cfg.peakHoursWeekend);

    // ── Demand Shape → Window User-Hours / Concurrency ──
    // Monthly user-hours are the conserved work quantity. Demand-shape knobs
    // determine how that work is distributed across the four non-overlapping
    // windows; concurrency and rack demand are derived from that allocation.
    const weekendShare = Math.min(Math.max(cfg.weekendSharePct, 0.05), 0.95);
    const weekdayShare = 1 - weekendShare;

    const weekdayPeakLoad = r.peakHoursWeekdayTotal * cfg.weekdayPeakIntensity;
    const weekdayOffpeakLoad = r.offpeakHoursWeekdayTotal;
    const weekendPeakLoad = r.peakHoursWeekendTotal * cfg.weekendPeakIntensity;
    const weekendOffpeakLoad = r.offpeakHoursWeekendTotal;

    const weekdayLoadTotal = weekdayPeakLoad + weekdayOffpeakLoad;
    const weekendLoadTotal = weekendPeakLoad + weekendOffpeakLoad;

    r.windowShares = {
      weekdayPeak: weekdayShare * (weekdayPeakLoad / Math.max(weekdayLoadTotal, 1e-9)),
      weekdayOffpeak: weekdayShare * (weekdayOffpeakLoad / Math.max(weekdayLoadTotal, 1e-9)),
      weekendPeak: weekendShare * (weekendPeakLoad / Math.max(weekendLoadTotal, 1e-9)),
      weekendOffpeak: weekendShare * (weekendOffpeakLoad / Math.max(weekendLoadTotal, 1e-9)),
    };

    r.userHoursWdPeak = r.totalUsageHours * r.windowShares.weekdayPeak;
    r.userHoursWdOff = r.totalUsageHours * r.windowShares.weekdayOffpeak;
    r.userHoursWePeak = r.totalUsageHours * r.windowShares.weekendPeak;
    r.userHoursWeOff = r.totalUsageHours * r.windowShares.weekendOffpeak;

    r.avgConcurrentWdPeak = r.userHoursWdPeak / Math.max(r.peakHoursWeekdayTotal, 1);
    r.avgConcurrentWdOff = r.userHoursWdOff / Math.max(r.offpeakHoursWeekdayTotal, 1);
    r.avgConcurrentWePeak = r.userHoursWePeak / Math.max(r.peakHoursWeekendTotal, 1);
    r.avgConcurrentWeOff = r.userHoursWeOff / Math.max(r.offpeakHoursWeekendTotal, 1);
    r.avgConcurrentOverall = r.totalUsageHours / r.totalMonthHours;

    r.peakUsersWeekday = Math.min(cfg.users, Math.ceil(r.avgConcurrentWdPeak * cfg.windowPeakOverAvgFactor));
    r.offpeakUsersWeekday = Math.min(cfg.users, Math.ceil(r.avgConcurrentWdOff * cfg.windowPeakOverAvgFactor));
    r.peakUsersWeekend = Math.min(cfg.users, Math.ceil(r.avgConcurrentWePeak * cfg.windowPeakOverAvgFactor));
    r.offpeakUsersWeekend = Math.min(cfg.users, Math.ceil(r.avgConcurrentWeOff * cfg.windowPeakOverAvgFactor));
    r.absolutePeakUsers = Math.max(r.peakUsersWeekday, r.offpeakUsersWeekday, r.peakUsersWeekend, r.offpeakUsersWeekend);

    // ── Racks Needed per Window (Provisioned to derived peak of the window) ──
    r.racksWeekdayPeak = Math.ceil(r.peakUsersWeekday / r.usersPerRack);
    r.racksWeekendPeak = Math.ceil(r.peakUsersWeekend / r.usersPerRack);
    r.racksWeekdayOffpeak = Math.ceil(r.offpeakUsersWeekday / r.usersPerRack);
    r.racksWeekendOffpeak = Math.ceil(r.offpeakUsersWeekend / r.usersPerRack);
    r.maxRacksRaw = Math.max(r.racksWeekdayPeak, r.racksWeekendPeak, r.racksWeekdayOffpeak, r.racksWeekendOffpeak);

    // ── Provisioning Strategy ──

    // Committed baseline = percentage of ABSOLUTE PEAK rack demand covered by
    // the negotiated commitment. In a well-structured cloud-gaming contract the
    // provider scales dynamically within the committed envelope, so routine
    // weekday/weekend peaks are absorbed at the committed rate and burst is
    // reserved for genuine outlier spikes above coverage.
    const peakCoverageRacks = Math.ceil(r.maxRacksRaw * cfg.peakCoveragePct);
    // Off-peak floor: baseline should never drop below what off-peak demand
    // requires — otherwise the model would route quiet-hour usage to burst.
    const offpeakFloor = this.PROVISIONING_DEFAULTS.enforceOffpeakFloor
      ? Math.max(r.racksWeekdayOffpeak, r.racksWeekendOffpeak)
      : 0;
    r.committedRacks = Math.max(peakCoverageRacks, offpeakFloor);
    r.peakCoverageRacks = peakCoverageRacks;
    r.offpeakFloorRacks = offpeakFloor;

    // ── Blended Pricing ──
    // contractRate    = list price after long-term contract discount only
    // idleBlendedRate = final committed rack-hour rate (contract + idle discounts)
    // burstRate       = idleBlendedRate × user-configured burst multiplier
    //                   (premium applied to rack-hours above the committed baseline)
    r.contractRate = r.onDemandPrice * (1 - cfg.contractDiscount);
    r.idleBlendedRate = r.contractRate * (1 - cfg.idleDiscount);
    r.committedRate = r.idleBlendedRate; // Canonical committed rack-hour price
    r.burstRate = r.idleBlendedRate * cfg.burstMultiplier;

    // ── Compute Cost Calculation (Window-based Base + Burst) ──
    // Each window sizes its fleet to the in-window peak (racks), but dynamic
    // provisioning scales down during ramp/taper — so billed rack-hours are
    // peakRacks × duration × intraWindowUtilPct. Committed vs burst split
    // is applied after scaling (both types scale dynamically).
    const util = cfg.intraWindowUtilPct;
    const calcWindowHours = (key, label, share, userHours, avgConcurrent, peakConcurrent, racks, duration) => {
      const committedRacksInWindow = Math.min(racks, r.committedRacks);
      const burstRacksInWindow = Math.max(0, racks - r.committedRacks);
      return {
        key,
        label,
        share,
        userHours,
        avgConcurrent,
        peakConcurrent,
        peakRacks: racks,
        duration,
        committedRacksInWindow,
        burstRacksInWindow,
        committed: committedRacksInWindow * duration * util,
        burst: burstRacksInWindow * duration * util,
        billedRackHours: racks * duration * util,
      };
    };

    const wp = calcWindowHours(
      'weekdayPeak',
      'Weekday Peak',
      r.windowShares.weekdayPeak,
      r.userHoursWdPeak,
      r.avgConcurrentWdPeak,
      r.peakUsersWeekday,
      r.racksWeekdayPeak,
      r.peakHoursWeekdayTotal
    );
    const wo = calcWindowHours(
      'weekdayOffpeak',
      'Weekday Off-Peak',
      r.windowShares.weekdayOffpeak,
      r.userHoursWdOff,
      r.avgConcurrentWdOff,
      r.offpeakUsersWeekday,
      r.racksWeekdayOffpeak,
      r.offpeakHoursWeekdayTotal
    );
    const ep = calcWindowHours(
      'weekendPeak',
      'Weekend Peak',
      r.windowShares.weekendPeak,
      r.userHoursWePeak,
      r.avgConcurrentWePeak,
      r.peakUsersWeekend,
      r.racksWeekendPeak,
      r.peakHoursWeekendTotal
    );
    const eo = calcWindowHours(
      'weekendOffpeak',
      'Weekend Off-Peak',
      r.windowShares.weekendOffpeak,
      r.userHoursWeOff,
      r.avgConcurrentWeOff,
      r.offpeakUsersWeekend,
      r.racksWeekendOffpeak,
      r.offpeakHoursWeekendTotal
    );

    r.windows = {
      weekdayPeak: wp,
      weekdayOffpeak: wo,
      weekendPeak: ep,
      weekendOffpeak: eo,
    };

    r.committedRackHours = wp.committed + wo.committed + ep.committed + eo.committed;
    r.burstRackHours = wp.burst + wo.burst + ep.burst + eo.burst;
    r.totalRackHours = r.committedRackHours + r.burstRackHours;

    r.rackHoursFromWindows = r.totalRackHours;
    r.rackHoursUsageShortfall = 0;

    r.rackHoursWeekdayPeak = wp.billedRackHours;
    r.rackHoursWeekdayOffpeak = wo.billedRackHours;
    r.rackHoursWeekendPeak = ep.billedRackHours;
    r.rackHoursWeekendOffpeak = eo.billedRackHours;

    // Avg racks inside each window reflects the effective fleet size after
    // intra-window dynamic scaling (peak racks × utilisation fraction).
    r.avgRacksWdPeak = r.rackHoursWeekdayPeak / (r.peakHoursWeekdayTotal || 1);
    r.avgRacksWdOff = r.rackHoursWeekdayOffpeak / (r.offpeakHoursWeekdayTotal || 1);
    r.avgRacksWePeak = r.rackHoursWeekendPeak / (r.peakHoursWeekendTotal || 1);
    r.avgRacksWeOff = r.rackHoursWeekendOffpeak / (r.offpeakHoursWeekendTotal || 1);

    r.totalComputeCost = (r.committedRackHours * r.committedRate) + (r.burstRackHours * r.burstRate);
    r.committedComputeCost = r.committedRackHours * r.committedRate;
    r.burstComputeCost = r.burstRackHours * r.burstRate;
    r.burstCostShare = r.totalComputeCost > 0 ? (r.burstComputeCost / r.totalComputeCost) : 0;
    r.burstHoursShare = r.totalRackHours > 0 ? (r.burstRackHours / r.totalRackHours) : 0;

    // ── Efficiency Metrics ──
    r.avgRacksOverall = r.totalRackHours / r.totalMonthHours;
    r.peakToAvgRatio = r.absolutePeakUsers / Math.max(r.avgConcurrentOverall, 1);
    r.scalingRisk = r.maxRacksRaw > 30 ? 'HIGH' : r.maxRacksRaw > 15 ? 'MEDIUM' : 'LOW';

    // ── Per-Unit Metrics ──
    // Physical-GPU rate: compute cost spread across every billed GPU-hour
    r.costPerPhysicalGpuHour = r.totalComputeCost / Math.max(r.totalRackHours * r.gpusPerRack, 1);
    // Slice rate: physical GPU cost shared evenly across MIG slices on that GPU
    r.costPerSliceHour = r.costPerPhysicalGpuHour / Math.max(r.usersPerGpu, 1);
    // Compute cost per ACTIVE user-hour (utilisation metric — higher when slices
    // sit idle outside peak windows; used for unit-economics, not pricing).
    r.costPerActiveUserHour = r.totalComputeCost / Math.max(r.totalUsageHours, 1);
    r.costPerUserHourCompute = r.costPerActiveUserHour;

    // ── Other Costs ──
    r.totalStorageCost = cfg.users * cfg.storageGB * cfg.storageRate;
    r.totalWindowsCost = cfg.users * cfg.windowsCostPerUser;
    r.totalIPCost = cfg.publicIPs * 4;
    r.totalInfraCosts = r.totalComputeCost + r.totalStorageCost + r.totalWindowsCost + r.totalIPCost;
    
    r.totalCostPerUser = r.totalInfraCosts / cfg.users;
    r.totalCostPerUserHour = r.totalInfraCosts / Math.max(r.totalUsageHours, 1);

    // ── Profit ──
    r.monthlyProfit = r.monthlyRevenue - r.totalInfraCosts;
    r.annualRevenue = r.monthlyRevenue * 12;
    r.annualProfit = r.monthlyProfit * 12;
    r.grossMargin = (r.monthlyProfit / r.monthlyRevenue) * 100;

    // ── Utilization & Break-even ──
    r.userUtilization = (cfg.avgUsagePct * 100);
    r.maxConcurrentCapacity = r.maxRacksRaw * r.usersPerRack;
    r.peakCapacityUtil = (r.absolutePeakUsers / Math.max(r.maxConcurrentCapacity, 1)) * 100;
    
    // Legacy mapping
    r.utilizationPct = r.userUtilization;
    r.overloadRisk = r.scalingRisk;

    const marginalCostPerUser = (r.totalComputeCost / cfg.users) + (cfg.storageGB * cfg.storageRate) + cfg.windowsCostPerUser;
    r.profitPerUser = r.priceUSD - marginalCostPerUser;
    r.breakEvenUsers = r.profitPerUser > 0 ? Math.ceil(r.totalIPCost / r.profitPerUser) : Infinity;

    r.config = cfg;
    return r;
  },

  /* ===== Scenario Calculations ===== */
  calculateScenarios() {
    const base = this.readConfig();
    
    const optimistic = { ...base,
      avgUsagePct: 0.40,
      weekendSharePct: 0.35,
      weekdayPeakIntensity: 2.5,
      weekendPeakIntensity: 3.0,
      windowPeakOverAvgFactor: 1.6,
      contractDiscount: 0.65,
      idleDiscount: 0.25,
      burstMultiplier: 1.3,
      peakCoveragePct: 1.00,
      intraWindowUtilPct: 0.60,
      l40sUsersPerGpu: 3,
      rtx6000UsersPerGpu: 6,
    };

    const expected = { ...base };

    const pessimistic = { ...base,
      avgUsagePct: 0.70,
      weekendSharePct: 0.45,
      weekdayPeakIntensity: 3.4,
      weekendPeakIntensity: 4.2,
      windowPeakOverAvgFactor: 2.4,
      contractDiscount: 0.50,
      idleDiscount: 0.10,
      burstMultiplier: 2.0,
      peakCoveragePct: 0.80,
      intraWindowUtilPct: 0.85,
      l40sUsersPerGpu: 1,
      rtx6000UsersPerGpu: 2,
    };

    return {
      optimistic: this.calculate(optimistic),
      expected: this.calculate(expected),
      pessimistic: this.calculate(pessimistic),
    };
  },

  /* ===== Sensitivity Data for Charts ===== */
  sensitivityProfitVsUsers(cfg) {
    const data = [];
    for (let u = 100; u <= 5000; u += 100) {
      const c = { ...cfg, users: u };
      const r = this.calculate(c);
      data.push({ users: u, profit: r.monthlyProfit, revenue: r.monthlyRevenue, costs: r.totalInfraCosts });
    }
    return data;
  },

  sensitivityMarginVsPeakFactor(cfg) {
    const data = [];
    for (let p = 1.2; p <= 3.0; p += 0.2) {
      const c = { ...cfg, windowPeakOverAvgFactor: Number(p.toFixed(1)) };
      const r = this.calculate(c);
      data.push({ peakFactor: Number(p.toFixed(1)), margin: r.grossMargin, profit: r.monthlyProfit });
    }
    return data;
  },

  sensitivityCostVsSlicing(cfg) {
    const data = [];
    for (let s = 1; s <= 8; s++) {
      // Apply slicing to the active tier
      const c = { ...cfg, l40sUsersPerGpu: s, rtx6000UsersPerGpu: s };
      const r = this.calculate(c);
      data.push({ slicing: s, costPerUserHour: r.totalCostPerUserHour, margin: r.grossMargin });
    }
    return data;
  },

  sensitivityBurstVsCoverage(cfg) {
    const data = [];
    for (let p = 0.60; p <= 1.00; p += 0.05) {
      const c = { ...cfg, peakCoveragePct: Number(p.toFixed(2)) };
      const r = this.calculate(c);
      data.push({
        coverage: Math.round(p * 100),
        burstShare: r.burstCostShare * 100,
        profit: r.monthlyProfit,
        costs: r.totalInfraCosts,
      });
    }
    return data;
  },
};
