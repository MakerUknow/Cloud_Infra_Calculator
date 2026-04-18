import React, { useState } from "react";
import { motion } from "framer-motion";

export default function CloudGamingCalculator() {
  const [users, setUsers] = useState(1000);
  const [pricePerUser, setPricePerUser] = useState(63);
  const [avgUsagePct, setAvgUsagePct] = useState(0.5);
  const [hoursAllowance, setHoursAllowance] = useState(100);

  const [peakConcurrencyPct, setPeakConcurrencyPct] = useState(0.25);
  const [offpeakConcurrencyPct, setOffpeakConcurrencyPct] = useState(0.1);
  const [weekendMultiplier, setWeekendMultiplier] = useState(1.3);

  const [usersPerRack, setUsersPerRack] = useState(20);
  const [rackBaseCost, setRackBaseCost] = useState(18);
  const [contractDiscount, setContractDiscount] = useState(0.6);
  const [idleCapacityDiscount, setIdleCapacityDiscount] = useState(0.2);

  const [storageCostPerUser, setStorageCostPerUser] = useState(6);
  const [windowsCostPerUser, setWindowsCostPerUser] = useState(7);
  const [ipCostTotal, setIpCostTotal] = useState(800);

  // ===== DEMAND =====
  const totalRevenue = users * pricePerUser;
  const totalUsageHours = users * hoursAllowance * avgUsagePct;

  const peakUsers = users * peakConcurrencyPct * weekendMultiplier;
  const offpeakUsers = users * offpeakConcurrencyPct;

  const effectiveConcurrentUsers = (peakUsers * 0.7) + (offpeakUsers * 0.3);

  // ===== INFRA REQUIREMENTS =====
  const baseRacksNeeded = effectiveConcurrentUsers / usersPerRack;
  const racksNeeded = Math.ceil(baseRacksNeeded * 1.15);

  // ===== TIME DISTRIBUTION =====
  const hoursPerMonth = 730;
  const peakHours = hoursPerMonth * 0.35;
  const offpeakHours = hoursPerMonth * 0.65;

  // ===== RACK HOURS (FIXED ISSUE) =====
  const peakRackHours = (peakUsers / usersPerRack) * peakHours;
  const offpeakRackHours = (offpeakUsers / usersPerRack) * offpeakHours;

  const rackHoursNeeded = peakRackHours + offpeakRackHours;

  // ===== PRICING =====
  const discountedCost = rackBaseCost * (1 - contractDiscount);
  const blendedRackCost = discountedCost * (1 - idleCapacityDiscount);

  // ===== COMPUTE COST =====
  const computeCost = rackHoursNeeded * blendedRackCost;

  // ===== OTHER COSTS =====
  const storageCost = users * storageCostPerUser;
  const windowsCost = users * windowsCostPerUser;

  const totalCosts = computeCost + storageCost + windowsCost + ipCostTotal;
  const profit = totalRevenue - totalCosts;
  const margin = (profit / totalRevenue) * 100;

  const costPerUserHour = computeCost / totalUsageHours;

  // ===== RISK METRICS =====
  const utilization = effectiveConcurrentUsers / (racksNeeded * usersPerRack);
  const overloadRisk = utilization > 0.9 ? "HIGH" : utilization > 0.75 ? "MEDIUM" : "LOW";

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-[#0a0f2c] to-[#140a2e] text-blue-100 p-8">
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-4xl font-semibold mb-8 bg-gradient-to-r from-blue-400 via-purple-400 to-indigo-500 bg-clip-text text-transparent"
      >
        Cloud Gaming Infra Dashboard
      </motion.h1>

      {/* INPUTS */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <Section title="Demand">
          <Input label="Users" value={users} setValue={setUsers} />
          <Input label="Price ($)" value={pricePerUser} setValue={setPricePerUser} />
          <Input label="Usage %" value={avgUsagePct} setValue={setAvgUsagePct} />
          <Input label="Hours Cap" value={hoursAllowance} setValue={setHoursAllowance} />
        </Section>

        <Section title="Concurrency">
          <Input label="Peak %" value={peakConcurrencyPct} setValue={setPeakConcurrencyPct} />
          <Input label="Offpeak %" value={offpeakConcurrencyPct} setValue={setOffpeakConcurrencyPct} />
          <Input label="Weekend Multiplier" value={weekendMultiplier} setValue={setWeekendMultiplier} />
        </Section>

        <Section title="Infra Efficiency">
          <Input label="Users per Rack" value={usersPerRack} setValue={setUsersPerRack} />
        </Section>

        <Section title="Pricing">
          <Input label="Base $/hr" value={rackBaseCost} setValue={setRackBaseCost} />
          <Input label="Contract Discount" value={contractDiscount} setValue={setContractDiscount} />
          <Input label="Idle Discount" value={idleCapacityDiscount} setValue={setIdleCapacityDiscount} />
        </Section>

        <Section title="Other Costs">
          <Input label="Storage/User" value={storageCostPerUser} setValue={setStorageCostPerUser} />
          <Input label="Windows/User" value={windowsCostPerUser} setValue={setWindowsCostPerUser} />
          <Input label="IP Total" value={ipCostTotal} setValue={setIpCostTotal} />
        </Section>
      </div>

      {/* RESULTS */}
      <div className="grid grid-cols-2 gap-6">
        <Card title="Core Metrics">
          <p>Revenue: ${totalRevenue.toFixed(0)}</p>
          <p>Usage Hours: {totalUsageHours.toFixed(0)}</p>
          <p>Concurrent Users: {effectiveConcurrentUsers.toFixed(0)}</p>
          <p>Racks Needed: {racksNeeded}</p>
        </Card>

        <Card title="Compute">
          <p>Rack Hours: {rackHoursNeeded.toFixed(0)}</p>
          <p>Cost/hr: ${blendedRackCost.toFixed(2)}</p>
          <p>Compute Cost: ${computeCost.toFixed(0)}</p>
          <p>Cost/User Hour: ${costPerUserHour.toFixed(2)}</p>
        </Card>

        <Card title="Financials">
          <p>Total Costs: ${totalCosts.toFixed(0)}</p>
          <p>Profit: ${profit.toFixed(0)}</p>
          <p>Margin: {margin.toFixed(1)}%</p>
        </Card>

        <Card title="Risk / Capacity">
          <p>Utilization: {(utilization * 100).toFixed(1)}%</p>
          <p>Overload Risk: {overloadRisk}</p>
        </Card>
      </div>

      {/* FORMULA */}
      <div className="mt-8 bg-black/40 border border-purple-900 p-6 rounded-2xl text-sm">
        <h2 className="text-purple-400 mb-3">Calculation Logic</h2>
        <p>1. Usage = Users × Hours × Usage %</p>
        <p>2. Peak/Offpeak Users calculated separately</p>
        <p>3. Rack Hours = (Peak Load × Peak Time) + (Offpeak Load × Offpeak Time)</p>
        <p>4. Cost/hr = Base × Contract × Idle Discounts</p>
        <p>5. Compute Cost = Rack Hours × Cost/hr</p>
        <p>6. Profit = Revenue − All Costs</p>
      </div>
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <div className="bg-black/30 border border-blue-900 p-4 rounded-xl space-y-2">
      <h3 className="text-blue-400 text-sm mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Card({ title, children }: any) {
  return (
    <div className="bg-gradient-to-br from-[#0b122a] to-[#140f3a] border border-blue-900 p-5 rounded-2xl">
      <h3 className="text-purple-300 mb-3">{title}</h3>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Input({ label, value, setValue }: any) {
  return (
    <div className="flex flex-col">
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
        className="bg-black/50 border border-blue-800 focus:border-purple-500 rounded p-2 text-blue-200"
      />
    </div>
  );
}
