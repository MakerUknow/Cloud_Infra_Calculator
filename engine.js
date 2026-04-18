/* ================================================
   Cloud Gaming Cost Calculator — Calculation Engine
   ================================================
   
   This engine models cloud gaming infrastructure costs
   with the following corrected principles:
   
   1. DYNAMIC PROVISIONING: Racks spin up/down based on 
      actual concurrent demand per time window. You pay 
      rack-hours only for racks that are actively serving users.
   
   2. CONCURRENCY + USAGE (METERED HOURS): Concurrency sizes
      peak/off-peak fleets per window. Aggregate playtime
      (allowance × avg usage %) scales billed GPU rack-hours
      vs a baseline so longer sessions consume more infra time
      even at unchanged peak concurrency. A throughput floor
      ensures rack-hours never fall below what is needed to
      deliver total user-hours at MIG capacity.
   
   3. TIME-WINDOWED MODEL: The month is divided into 
      distinct time windows (weekday peak, weekday off-peak, 
      weekend peak, weekend off-peak) each with their own 
      concurrency patterns.
   
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

  /* Concurrency constants — tunable but not exposed as UI */
  CONCURRENCY_CONSTANTS: {
    // Slight uplift on weekend off-peak hours vs weekday off-peak
    weekendOffpeakUplift: 1.10,
    // Weeks per month average
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

  /* Usage → GPU-time scaling (see header §2). Tunable; not duplicated inline. */
  USAGE_MODEL: {
    // Rack-hour stack is unity-scaled when Avg Usage % of allowance equals
    // this fraction (e.g. 0.5 = 50%). Higher/lower usage multiplies billed
    // window rack-hours to reflect metered playtime vs this baseline.
    baselineAvgUsageRatio: 0.5,
    // Conservative lower bound on slice delivery efficiency for the global
    // throughput floor only: required rack-hours ≥ U ÷ (usersPerRack × η).
    throughputDeliveryEfficiency: 1,
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

      // Concurrency
      peakConcurrencyPct: val('cfg-peak-pct', 25) / 100,
      offpeakConcurrencyPct: val('cfg-offpeak-pct', 8) / 100,
      weekendMultiplier: val('cfg-weekend-mult', 1.3),

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
    const weeksPerMonth = this.CONCURRENCY_CONSTANTS.weeksPerMonth;
    r.totalMonthHours = 24 * 7 * weeksPerMonth;

    // ── Time Windows ──
    const weekdaysPerMonth = weeksPerMonth * 5;
    const weekendDaysPerMonth = weeksPerMonth * 2;
    r.peakHoursWeekdayTotal = weekdaysPerMonth * cfg.peakHoursWeekday;
    r.offpeakHoursWeekdayTotal = weekdaysPerMonth * (24 - cfg.peakHoursWeekday);
    r.peakHoursWeekendTotal = weekendDaysPerMonth * cfg.peakHoursWeekend;
    r.offpeakHoursWeekendTotal = weekendDaysPerMonth * (24 - cfg.peakHoursWeekend);

    // ── Peak Users per Window ──
    r.peakUsersWeekday = Math.ceil(cfg.users * cfg.peakConcurrencyPct);
    r.peakUsersWeekend = Math.ceil(cfg.users * cfg.peakConcurrencyPct * cfg.weekendMultiplier);
    r.offpeakUsersWeekday = Math.ceil(cfg.users * cfg.offpeakConcurrencyPct);
    r.offpeakUsersWeekend = Math.ceil(cfg.users * cfg.offpeakConcurrencyPct * this.CONCURRENCY_CONSTANTS.weekendOffpeakUplift);
    r.absolutePeakUsers = Math.max(r.peakUsersWeekday, r.peakUsersWeekend);

    // ── Racks Needed per Window (Provisioned to PEAK of the window) ──
    r.racksWeekdayPeak = Math.ceil(r.peakUsersWeekday / r.usersPerRack);
    r.racksWeekendPeak = Math.ceil(r.peakUsersWeekend / r.usersPerRack);
    r.racksWeekdayOffpeak = Math.ceil(r.offpeakUsersWeekday / r.usersPerRack);
    r.racksWeekendOffpeak = Math.ceil(r.offpeakUsersWeekend / r.usersPerRack);
    r.maxRacksRaw = Math.max(r.racksWeekdayPeak, r.racksWeekendPeak);

    // ── Provisioning Strategy ──
    // Reference metric for sizing descriptions (not used as commit baseline)
    r.avgConcurrentOverall = r.totalUsageHours / r.totalMonthHours;

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
    const calcWindowHours = (racks, duration) => {
      const committedRacksInWindow = Math.min(racks, r.committedRacks);
      const burstRacksInWindow = Math.max(0, racks - r.committedRacks);
      return {
        peakRacks: racks,
        duration,
        committedRacksInWindow,
        burstRacksInWindow,
        committed: committedRacksInWindow * duration * util,
        burst: burstRacksInWindow * duration * util,
        billedRackHours: racks * duration * util,
      };
    };

    const wp = calcWindowHours(r.racksWeekdayPeak, r.peakHoursWeekdayTotal);
    const wo = calcWindowHours(r.racksWeekdayOffpeak, r.offpeakHoursWeekdayTotal);
    const ep = calcWindowHours(r.racksWeekendPeak, r.peakHoursWeekendTotal);
    const eo = calcWindowHours(r.racksWeekendOffpeak, r.offpeakHoursWeekendTotal);

    // Scale window-derived rack-hours by how much of the allowance subscribers
    // actually use vs the model baseline (metered GPU-time; see USAGE_MODEL).
    const usageIntensityScale =
      cfg.avgUsagePct / this.USAGE_MODEL.baselineAvgUsageRatio;
    const scaleWindow = (w) => ({
      peakRacks: w.peakRacks,
      duration: w.duration,
      committedRacksInWindow: w.committedRacksInWindow,
      burstRacksInWindow: w.burstRacksInWindow,
      committed: w.committed * usageIntensityScale,
      burst: w.burst * usageIntensityScale,
      billedRackHours: w.billedRackHours * usageIntensityScale,
    });

    r.usageIntensityScale = usageIntensityScale;
    r.windows = {
      weekdayPeak: scaleWindow(wp),
      weekdayOffpeak: scaleWindow(wo),
      weekendPeak: scaleWindow(ep),
      weekendOffpeak: scaleWindow(eo),
    };

    const swp = r.windows.weekdayPeak;
    const swo = r.windows.weekdayOffpeak;
    const sep = r.windows.weekendPeak;
    const seo = r.windows.weekendOffpeak;

    r.committedRackHours = swp.committed + swo.committed + sep.committed + seo.committed;
    r.burstRackHours = swp.burst + swo.burst + sep.burst + seo.burst;
    r.totalRackHours = r.committedRackHours + r.burstRackHours;

    // Throughput floor: cannot deliver more user-hours than R×P (per billed rack-hour)
    // without additional rack-time; η accounts for non-ideal scheduling/headroom.
    const eta = this.USAGE_MODEL.throughputDeliveryEfficiency;
    r.usageThroughputFloorRackHours =
      r.totalUsageHours / Math.max(r.usersPerRack * eta, 1e-9);
    r.rackHoursFromWindows = r.totalRackHours;
    r.rackHoursUsageShortfall = Math.max(0, r.usageThroughputFloorRackHours - r.rackHoursFromWindows);
    if (r.rackHoursUsageShortfall > 0) {
      r.committedRackHours += r.rackHoursUsageShortfall;
      r.totalRackHours += r.rackHoursUsageShortfall;
    }

    r.rackHoursWeekdayPeak = swp.billedRackHours;
    r.rackHoursWeekdayOffpeak = swo.billedRackHours;
    r.rackHoursWeekendPeak = sep.billedRackHours;
    r.rackHoursWeekendOffpeak = seo.billedRackHours;

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

    // Usage distribution (for UI table only)
    const totalWeights = (r.peakUsersWeekday * r.peakHoursWeekdayTotal) + (r.offpeakUsersWeekday * r.offpeakHoursWeekdayTotal) +
                         (r.peakUsersWeekend * r.peakHoursWeekendTotal) + (r.offpeakUsersWeekend * r.offpeakHoursWeekendTotal);
    r.userHoursWdPeak = r.totalUsageHours * (r.peakUsersWeekday * r.peakHoursWeekdayTotal) / totalWeights;
    r.userHoursWdOff = r.totalUsageHours * (r.offpeakUsersWeekday * r.offpeakHoursWeekdayTotal) / totalWeights;
    r.userHoursWePeak = r.totalUsageHours * (r.peakUsersWeekend * r.peakHoursWeekendTotal) / totalWeights;
    r.userHoursWeOff = r.totalUsageHours * (r.offpeakUsersWeekend * r.offpeakHoursWeekendTotal) / totalWeights;

    r.avgConcurrentWdPeak = r.userHoursWdPeak / (r.peakHoursWeekdayTotal || 1);
    r.avgConcurrentWdOff = r.userHoursWdOff / (r.offpeakHoursWeekdayTotal || 1);
    r.avgConcurrentWePeak = r.userHoursWePeak / (r.peakHoursWeekendTotal || 1);
    r.avgConcurrentWeOff = r.userHoursWeOff / (r.offpeakHoursWeekendTotal || 1);


    
    r.config = cfg;
    return r;
  },

  /* ===== Scenario Calculations ===== */
  calculateScenarios() {
    const base = this.readConfig();
    
    const optimistic = { ...base,
      avgUsagePct: 0.40,
      peakConcurrencyPct: 0.20,
      offpeakConcurrencyPct: 0.06,
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
      peakConcurrencyPct: 0.40,
      offpeakConcurrencyPct: 0.15,
      weekendMultiplier: 1.6,
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

  sensitivityMarginVsConcurrency(cfg) {
    const data = [];
    for (let p = 0.05; p <= 0.80; p += 0.05) {
      const c = { ...cfg, peakConcurrencyPct: p };
      const r = this.calculate(c);
      data.push({ concurrency: (p * 100).toFixed(0), margin: r.grossMargin, profit: r.monthlyProfit });
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

  sensitivityScaleProjection(cfg) {
    const data = [];
    for (let u = 500; u <= 10000; u += 500) {
      const c = { ...cfg, users: u };
      const r = this.calculate(c);
      data.push({ users: u, revenue: r.monthlyRevenue, costs: r.totalInfraCosts, margin: r.grossMargin });
    }
    return data;
  },
};
