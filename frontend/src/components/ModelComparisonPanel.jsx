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
import { MODEL_COLORS } from './ForecastChart.jsx'

const MODEL_DISPLAY = {
  xgboost: { label: 'XGBoost', color: MODEL_COLORS.xgboost },
  prophet: { label: 'Prophet', color: MODEL_COLORS.prophet },
  lstm: { label: 'LSTM', color: MODEL_COLORS.lstm },
  stacked_ensemble: { label: 'Ensemble', color: MODEL_COLORS.ensemble },
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
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tt-row">
          <span style={{ color: '#cbd5e1' }}>{p.name}</span>
          <span className="tt-value">{p.value?.toFixed(3)}</span>
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
  const metricLabel = METRIC_OPTIONS.find(m => m.key === metric)?.label ?? ''

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
          <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
          <XAxis dataKey="model" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
          <Bar dataKey="value" name={METRIC_OPTIONS.find(m => m.key === metric)?.label} radius={[8, 8, 0, 0]} maxBarSize={64}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.color}
                fillOpacity={entry.model === best.model ? 1 : 0.45}
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
              const isBest = meta.label === best.model
              return (
                <tr key={key}>
                  <td>
                    <div className="product-cell">
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: meta.color, flexShrink: 0 }} />
                      {meta.label}
                    </div>
                  </td>
                  <td className="td-mono">{o.rmse?.toFixed(3)}</td>
                  <td className="td-mono">{o.mae?.toFixed(3)}</td>
                  <td className="td-mono">{o.mape?.toFixed(1)}%</td>
                  <td className="td-mono">{o.wape?.toFixed(1)}%</td>
                  <td>
                    {isBest ? <span className="badge badge-best">🏆 Best {metricLabel.split(' ')[0]}</span> : <span style={{ color: 'var(--text-muted)' }}>–</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Blend weights */}
      {weights && !compact && (
        <div className="note">
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
            Learned stacking weights (non-negative linear blend)
          </div>
          {Object.entries(weights.weights || {}).map(([model, w]) => (
            <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 70, fontWeight: 600 }}>{MODEL_DISPLAY[model]?.label ?? model}</span>
              <div className="progress-track" style={{ flex: 1, background: '#fff', border: '1px solid var(--border)' }}>
                <div className="progress-fill" style={{ width: `${Math.max(w, 0) * 100}%`, background: MODEL_DISPLAY[model]?.color }} />
              </div>
              <span className="td-mono" style={{ width: 52, textAlign: 'right', fontWeight: 700 }}>{w.toFixed(3)}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
            intercept = {weights.intercept?.toFixed(3)} · a zero weight means that model added no extra signal once the others were known.
          </div>
        </div>
      )}
    </div>
  )
}
