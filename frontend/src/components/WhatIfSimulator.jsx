/**
 * WhatIfSimulator.jsx
 * Sliders to adjust inventory assumptions and see real-time impact on
 * Safety Stock, Reorder Point, and EOQ.
 * Responsive: stacks vertically on mobile (<768px).
 */
import { useState, useMemo } from 'react'
import { useInventory } from '../hooks/useData'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const Z_SCORES = { 0.90: 1.282, 0.95: 1.645, 0.99: 2.326 }
const PRODUCTS = ['Milk', 'Yogurt', 'Cheese', 'Eggs', 'Bread']

// Category colours (avoid all-green — each metric gets its own hue)
const METRIC_COLORS = {
  safety: { bg: 'var(--teal-50)', border: 'var(--teal-border)', text: 'var(--teal-700)', label: 'var(--teal-600)' },
  reorder: { bg: 'var(--amber-50)', border: 'var(--amber-border)', text: 'var(--amber-700)', label: 'var(--amber-600)' },
  eoq: { bg: 'var(--violet-50)', border: 'var(--violet-border)', text: 'var(--violet-700)', label: 'var(--violet-600)' },
}

function computeMetrics(avgDemand, sigma, price, leadTime, serviceLevel, orderingCost, holdingRate) {
  const z = Z_SCORES[serviceLevel] || 1.645
  const safetyStock = z * sigma * Math.sqrt(leadTime)
  const reorderPoint = avgDemand * leadTime + safetyStock
  const annualDemand = avgDemand * 365
  const holdingCost = Math.max(price, 0.01) * holdingRate
  const eoq = annualDemand > 0 ? Math.sqrt((2 * annualDemand * orderingCost) / holdingCost) : 0
  return { safety_stock: safetyStock, reorder_point: reorderPoint, eoq }
}

function SliderRow({ label, value, min, max, step, onChange, format: fmt, unit = '', accentBg, accentText }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
        <span style={{
          fontFamily: 'JetBrains Mono', fontSize: 12.5, fontWeight: 700,
          color: accentText || 'var(--violet-700)',
          background: accentBg || 'var(--violet-50)',
          borderRadius: 6, padding: '2px 10px',
          border: '1px solid var(--violet-border)',
        }}>
          {fmt ? fmt(value) : value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

export default function WhatIfSimulator() {
  const { data: inventory } = useInventory()

  const [leadTime, setLeadTime] = useState(7)
  const [serviceLevel, setServiceLevel] = useState(0.95)
  const [orderingCost, setOrderingCost] = useState(50)
  const [holdingRate, setHoldingRate] = useState(0.20)
  const [selectedProduct, setSelectedProduct] = useState(0)

  const baseMetrics = inventory?.[selectedProduct]
  const avgDemand = baseMetrics ? baseMetrics.reorder_point / Math.max(leadTime, 1) * 0.7 : 10
  const sigma = baseMetrics ? baseMetrics.safety_stock / (1.645 * Math.sqrt(7)) : 3
  const price = 2.5

  const simulated = useMemo(() =>
    computeMetrics(avgDemand, sigma, price, leadTime, serviceLevel, orderingCost, holdingRate),
    [avgDemand, sigma, price, leadTime, serviceLevel, orderingCost, holdingRate]
  )
  const baseline = useMemo(() =>
    computeMetrics(avgDemand, sigma, price, 7, 0.95, 50, 0.20),
    [avgDemand, sigma, price]
  )

  const chartData = [
    { name: 'Safety Stock', baseline: +baseline.safety_stock.toFixed(1), simulated: +simulated.safety_stock.toFixed(1) },
    { name: 'Reorder Point', baseline: +baseline.reorder_point.toFixed(1), simulated: +simulated.reorder_point.toFixed(1) },
    { name: 'EOQ', baseline: +baseline.eoq.toFixed(1), simulated: +simulated.eoq.toFixed(1) },
  ]

  const delta = (sim, base) => {
    const diff = sim - base
    const pct = base !== 0 ? (diff / base * 100).toFixed(1) : '0.0'
    return { diff: diff.toFixed(1), pct, up: diff > 0 }
  }

  const kpis = [
    { label: 'Safety Stock', value: simulated.safety_stock.toFixed(1), ...METRIC_COLORS.safety, key: 'safety' },
    { label: 'Reorder Point', value: simulated.reorder_point.toFixed(1), ...METRIC_COLORS.reorder, key: 'reorder' },
    { label: 'EOQ', value: simulated.eoq.toFixed(0), ...METRIC_COLORS.eoq, key: 'eoq' },
  ]

  const deltas = [
    { label: 'Safety Stock', ...delta(simulated.safety_stock, baseline.safety_stock) },
    { label: 'Reorder Pt', ...delta(simulated.reorder_point, baseline.reorder_point) },
    { label: 'EOQ', ...delta(simulated.eoq, baseline.eoq) },
  ]

  return (
    <div className="simulator-layout">
      {/* ── Left: Controls ───────────────────────────────────────────────── */}
      <div className="simulator-controls">
        {/* Product selector */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Select Product
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRODUCTS.map((p, i) => (
              <button
                key={i}
                id={`simulator-product-${p.toLowerCase()}`}
                className={`tab ${selectedProduct === i ? 'active' : ''}`}
                onClick={() => setSelectedProduct(i)}
                style={{ fontSize: 12 }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <SliderRow label="Lead Time" value={leadTime} min={1} max={30} step={1} unit=" days" onChange={setLeadTime} />
        <SliderRow label="Service Level" value={serviceLevel} min={0.80} max={0.99} step={0.01} format={v => `${(v * 100).toFixed(0)}%`} onChange={setServiceLevel} />
        <SliderRow label="Ordering Cost" value={orderingCost} min={10} max={500} step={5} format={v => `$${v}`} onChange={setOrderingCost} />
        <SliderRow label="Holding Cost Rate" value={holdingRate} min={0.05} max={0.50} step={0.01} format={v => `${(v * 100).toFixed(0)}%`} unit="/yr" onChange={setHoldingRate} />

        {/* Delta summary */}
        <div style={{
          background: '#f8fafc', borderRadius: 10,
          border: '1px solid var(--border)', padding: '14px 16px', marginTop: 4,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Impact vs Baseline
          </div>
          {deltas.map(d => (
            <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 500 }}>{d.label}</span>
              <span style={{
                fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 12.5,
                color: d.up ? 'var(--amber-700)' : 'var(--rose-700)',
                background: d.up ? 'var(--amber-50)' : 'var(--rose-50)',
                border: `1px solid ${d.up ? 'var(--amber-border)' : 'var(--rose-border)'}`,
                borderRadius: 6, padding: '1px 8px',
              }}>
                {d.up ? '▲' : '▼'} {Math.abs(d.pct)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: KPIs + Chart ────────────────────────────────────────────── */}
      <div className="simulator-results">
        {/* KPI mini-cards — Teal / Amber / Violet */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {kpis.map(k => (
            <div key={k.label} style={{
              background: k.bg, borderRadius: 10,
              border: `1px solid ${k.border}`, padding: '14px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: k.label_color || k.label, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontWeight: 700 }}>
                {k.label}
              </div>
              <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 900, fontSize: 24, color: k.text, lineHeight: 1 }}>
                {k.value}
              </div>
              <div style={{ fontSize: 10.5, color: k.text, opacity: 0.65, marginTop: 4 }}>units</div>
            </div>
          ))}
        </div>

        {/* Bar chart */}
        <div style={{
          background: '#f9f8f8ff', borderRadius: 10,
          border: '1px solid var(--border)', padding: '16px 16px 12px',
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, fontWeight: 600 }}>
            Baseline vs Simulated
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={{
                  background: '#ffffff', border: '1px solid var(--teal-border)',
                  borderRadius: 8, fontSize: 12.5, color: 'var(--text-primary)',
                  boxShadow: '0 4px 16px rgba(15,23,42,0.08)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 8 }} />
              <Bar dataKey="baseline" name="Baseline" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="simulated" name="Simulated" fill="var(--teal-500)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Formula note */}
        <div style={{
          background: 'var(--violet-50)', border: '1px solid var(--violet-border)',
          borderRadius: 8, padding: '10px 14px',
          fontSize: 11.5, color: 'var(--violet-700)', lineHeight: 1.8,
        }}>
          <strong style={{ color: 'var(--violet-700)' }}>Baseline:</strong> lead time=7d · service level=95% · ordering cost=$50 · holding rate=20%/yr.
          {' '}Adjust sliders to see live impact.{' '}
          <span style={{ opacity: 0.85 }}>SS = Z × σ × √LT &nbsp;|&nbsp; ROP = μ × LT + SS &nbsp;|&nbsp; EOQ = √(2 × D × S / H)</span>
        </div>
      </div>
    </div>
  )
}
