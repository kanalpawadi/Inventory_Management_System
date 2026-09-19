/**
 * WhatIfSimulator.jsx
 * Sliders to adjust inventory assumptions and see real-time impact on
 * Safety Stock, Reorder Point, and EOQ — driven by each product's REAL
 * average daily demand, demand std-dev and unit price from the API.
 */
import { useState, useMemo, useEffect } from 'react'
import { useInventory } from '../hooks/useData'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PRODUCT_EMOJI } from './InventoryTable.jsx'

const BASELINE = { leadTime: 7, serviceLevel: 0.95, orderingCost: 50, holdingRate: 0.20 }

/** Inverse standard-normal CDF (Acklam's approximation, |error| < 1.2e-9).
 *  Replaces a 3-entry lookup table that silently fell back to 95% for every
 *  other slider position. */
function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) return -normInv(1 - p)
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

function computeMetrics({ avgDemand, sigma, price }, { leadTime, serviceLevel, orderingCost, holdingRate }) {
  const z = normInv(serviceLevel)
  const safetyStock = z * sigma * Math.sqrt(leadTime)
  const reorderPoint = avgDemand * leadTime + safetyStock
  const annualDemand = avgDemand * 365
  const holdingCost = Math.max(price, 0.01) * holdingRate
  const eoq = annualDemand > 0 ? Math.sqrt((2 * annualDemand * orderingCost) / holdingCost) : 0
  return { safety_stock: safetyStock, reorder_point: reorderPoint, eoq }
}

function SliderRow({ label, value, min, max, step, onChange, fmt }) {
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        style={{ '--fill': fill }} onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tt-row">
          <span style={{ color: p.dataKey === 'baseline' ? '#cbd5e1' : '#5eead4' }}>{p.name}</span>
          <span className="tt-value">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function WhatIfSimulator() {
  const { data: inventory, loading, error } = useInventory()

  const [params, setParams] = useState(BASELINE)
  const [productId, setProductId] = useState(null)
  const set = key => v => setParams(p => ({ ...p, [key]: v }))

  useEffect(() => {
    if (inventory?.length && productId == null) setProductId(inventory[0].product_id)
  }, [inventory, productId])

  const item = inventory?.find(i => i.product_id === productId)
  const inputs = item
    ? { avgDemand: item.avg_daily_demand, sigma: item.demand_std, price: item.unit_price ?? 1 }
    : null

  const simulated = useMemo(() => inputs && computeMetrics(inputs, params), [inputs?.avgDemand, inputs?.sigma, inputs?.price, params])
  const baseline = useMemo(() => inputs && computeMetrics(inputs, BASELINE), [inputs?.avgDemand, inputs?.sigma, inputs?.price])

  if (loading) return <div className="loading-wrap"><div className="spinner" /><span className="loading-text">Loading product data…</span></div>
  if (error) return <div className="error-box">Error: {error}</div>
  if (!simulated) return null

  const chartData = [
    { name: 'Safety Stock', baseline: +baseline.safety_stock.toFixed(1), simulated: +simulated.safety_stock.toFixed(1) },
    { name: 'Reorder Point', baseline: +baseline.reorder_point.toFixed(1), simulated: +simulated.reorder_point.toFixed(1) },
    { name: 'EOQ', baseline: +baseline.eoq.toFixed(1), simulated: +simulated.eoq.toFixed(1) },
  ]

  const kpis = [
    { label: 'Safety Stock', sim: simulated.safety_stock, base: baseline.safety_stock, c: 'var(--teal-600)' },
    { label: 'Reorder Point', sim: simulated.reorder_point, base: baseline.reorder_point, c: 'var(--amber-500)' },
    { label: 'EOQ', sim: simulated.eoq, base: baseline.eoq, c: 'var(--indigo-600)' },
  ]

  const isBaseline = Object.keys(BASELINE).every(k => Math.abs(params[k] - BASELINE[k]) < 1e-9)
  // Extra units held vs baseline × unit price × holding rate = yearly holding cost change of safety stock
  const extraSafetyCost = (simulated.safety_stock - baseline.safety_stock) * inputs.price * params.holdingRate

  return (
    <div className="simulator-layout">
      {/* ── Controls ── */}
      <div className="simulator-controls">
        <div className="section-label">Select product</div>
        <div className="chip-group" style={{ marginBottom: 22 }}>
          {inventory.map(p => (
            <button key={p.product_id} id={`simulator-product-${p.product_name.toLowerCase()}`}
              className={`chip ${productId === p.product_id ? 'active' : ''}`}
              onClick={() => setProductId(p.product_id)}>
              {PRODUCT_EMOJI[p.product_name] ?? '📦'} {p.product_name}
            </button>
          ))}
        </div>

        <SliderRow label="Lead Time" value={params.leadTime} min={1} max={30} step={1} fmt={v => `${v} days`} onChange={set('leadTime')} />
        <SliderRow label="Service Level" value={params.serviceLevel} min={0.80} max={0.99} step={0.01} fmt={v => `${Math.round(v * 100)}%`} onChange={set('serviceLevel')} />
        <SliderRow label="Ordering Cost" value={params.orderingCost} min={10} max={500} step={5} fmt={v => `$${v}`} onChange={set('orderingCost')} />
        <SliderRow label="Holding Cost Rate" value={params.holdingRate} min={0.05} max={0.50} step={0.01} fmt={v => `${Math.round(v * 100)}%/yr`} onChange={set('holdingRate')} />

        <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}
          disabled={isBaseline} onClick={() => setParams(BASELINE)}>
          Reset to baseline
        </button>

        <div className="note">
          <strong>{item.product_name} demand inputs</strong> (from sales history):<br />
          μ = {inputs.avgDemand.toFixed(1)} units/day · σ = {inputs.sigma.toFixed(1)} · price = ${inputs.price.toFixed(2)}<br />
          z = {normInv(params.serviceLevel).toFixed(3)} for {Math.round(params.serviceLevel * 100)}% service level
        </div>
      </div>

      {/* ── Results ── */}
      <div className="simulator-results">
        <div className="sim-kpis">
          {kpis.map(k => {
            const pct = k.base ? ((k.sim - k.base) / k.base) * 100 : 0
            const cls = Math.abs(pct) < 0.05 ? 'delta-flat' : pct > 0 ? 'delta-up' : 'delta-down'
            return (
              <div key={k.label} className="sim-kpi" style={{ '--c': k.c }}>
                <div className="sim-kpi-label">{k.label}</div>
                <div className="sim-kpi-value">{k.sim.toFixed(k.label === 'EOQ' ? 0 : 1)}</div>
                <div className={`sim-kpi-delta ${cls}`}>
                  {cls === 'delta-flat' ? 'baseline' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% vs baseline`}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '16px 16px 8px' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, fontWeight: 700 }}>
            Baseline vs Simulated (units)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#8a96a8', fontSize: 11.5 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8a96a8', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 8 }} />
              <Bar dataKey="baseline" name="Baseline" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
              <Bar dataKey="simulated" name="Simulated" fill="#0d9488" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="note">
          {!isBaseline && Math.abs(extraSafetyCost) >= 0.01 && (
            <div style={{ marginBottom: 4 }}>
              <strong>Cost impact:</strong> safety stock changes by {(simulated.safety_stock - baseline.safety_stock).toFixed(1)} units ≈{' '}
              <b style={{ color: extraSafetyCost > 0 ? 'var(--amber-700)' : 'var(--teal-700)' }}>
                {extraSafetyCost > 0 ? '+' : '−'}${Math.abs(extraSafetyCost).toFixed(2)}/yr
              </b>{' '}in holding cost.
            </div>
          )}
          <strong>Formulas:</strong> SS = z × σ × √LT · ROP = μ × LT + SS · EOQ = √(2 × D × S / H).
          Baseline: 7-day lead time, 95% service level, $50/order, 20%/yr holding.
        </div>
      </div>
    </div>
  )
}
