/**
 * ModelComparisonPanel.jsx
 * Bar chart + table comparing RMSE/MAE/WAPE across XGBoost, Prophet, LSTM, Ensemble.
 */
import { useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell
} from 'recharts'
import { useModelComparison, useEnsembleWeights } from '../hooks/useData'

const MODEL_DISPLAY = {
  xgboost: { label: 'XGBoost', color: '#f38304ff' },  // amber-600
  prophet: { label: 'Prophet', color: '#6310f2ff' },  // violet-600
  lstm: { label: 'LSTM', color: '#3a010dff' },  // rose-600
  stacked_ensemble: { label: 'Ensemble', color: '#012825ff' },  // teal-600
}

const METRIC_OPTIONS = [
  { key: 'rmse', label: 'RMSE' },
  { key: 'mae', label: 'MAE' },
  { key: 'mape', label: 'MAPE (%)' },
  { key: 'wape', label: 'WAPE (%)' },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12.5,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <p style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.fill }}>{p.name}</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: 'var(--text-primary)' }}>
            {p.value?.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ModelComparisonPanel({ compact = false }) {
  const { data: comparison, loading, error } = useModelComparison()
  const { data: weights } = useEnsembleWeights()
  const [metric, setMetric] = useState('rmse')

  if (loading) return (
    <div className="loading-wrap" style={{ minHeight: 160 }}>
      <div className="spinner" />
      <span className="loading-text">Loading comparison…</span>
    </div>
  )
  if (error) return <div className="error-box">Error: {error}</div>
  if (!comparison) return null

  // Build chart data: one bar group per metric value, one bar per model
  const chartData = Object.entries(MODEL_DISPLAY).map(([key, meta]) => ({
    model: meta.label,
    value: comparison[key]?.overall?.[metric] ?? 0,
    color: meta.color,
  }))

  const best = chartData.reduce((a, b) => a.value < b.value ? a : b)

  return (
    <div>
      {/* Metric selector */}
      {!compact && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          <div className="tabs">
            {METRIC_OPTIONS.map(m => (
              <button
                key={m.key}
                id={`metric-tab-${m.key}`}
                className={`tab ${metric === m.key ? 'active' : ''}`}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={compact ? 140 : 220}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="model" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(14,165,233,0.05)' }} />
          <Bar dataKey="value" name={METRIC_OPTIONS.find(m => m.key === metric)?.label} radius={[6, 6, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.color}
                opacity={entry.model === best.model ? 1 : 0.55}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Summary table */}
      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>RMSE</th>
              <th>MAE</th>
              <th>MAPE</th>
              <th>WAPE</th>
              <th>Best?</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(MODEL_DISPLAY).map(([key, meta]) => {
              const o = comparison[key]?.overall
              if (!o) return null
              const isBest = key === Object.entries(MODEL_DISPLAY).reduce((bestKey, [k]) => {
                const a = comparison[bestKey]?.overall?.rmse ?? Infinity
                const b = comparison[k]?.overall?.rmse ?? Infinity
                return b < a ? k : bestKey
              }, 'xgboost')
              return (
                <tr key={key}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{meta.label}</span>
                  </td>
                  <td className="td-mono">{o.rmse?.toFixed(3)}</td>
                  <td className="td-mono">{o.mae?.toFixed(3)}</td>
                  <td className="td-mono">{o.mape?.toFixed(1)}%</td>
                  <td className="td-mono">{o.wape?.toFixed(1)}%</td>
                  <td>
                    {isBest ? <span className="badge badge-low">🏆 Best</span> : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Blend weights */}
      {weights && !compact && (
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: 'var(--bg-surface)', borderRadius: 8,
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Learned Stacking Weights (non-negative linear blend)
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(weights.weights || {}).map(([model, w]) => (
              <div key={model} style={{ fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{model}: </span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: 'var(--teal-text)' }}>
                  {w.toFixed(4)}
                </span>
              </div>
            ))}
            <div style={{ fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-secondary)' }}>intercept: </span>
              <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: 'var(--text-muted)' }}>
                {weights.intercept?.toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
