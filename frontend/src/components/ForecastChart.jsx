/**
 * ForecastChart.jsx
 * Line chart with confidence band for demand predictions vs actuals.
 */
import { useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts'
import { useForecasts } from '../hooks/useData'
import { format, parseISO } from 'date-fns'

const MODEL_COLORS = {
  ensemble: '#0d9488',   // teal-600    — primary / positive
  xgboost: '#d92906ff',   // amber-600   — secondary
  prophet: '#000000ff',   // violet-600  — tertiary
  lstm: '#e11d48',   // rose-600    — quaternary
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip" style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12.5,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
    }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color || 'var(--text-secondary)' }}>{p.name}</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 600, color: 'var(--text-primary)' }}>
            {typeof p.value === 'number' ? p.value.toFixed(2) : '–'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ForecastChart({ model = 'ensemble', productId = null, mini = false }) {
  const { data, loading, error } = useForecasts({ model, product_id: productId })

  // Group by date → one series per product if no product filter
  const chartData = useMemo(() => {
    if (!data?.length) return []

    if (productId) {
      // Single product: one row per date
      return data.map(row => ({
        date: format(parseISO(String(row.date)), 'MMM dd'),
        rawDate: row.date,
        predicted: row.predicted,
        actual: row.actual,
        lower: row.confidence_lower,
        upper: row.confidence_upper,
        band: [row.confidence_lower, row.confidence_upper],
      }))
    }

    // All products: group by date, average predictions
    const byDate = {}
    data.forEach(row => {
      const d = String(row.date)
      if (!byDate[d]) byDate[d] = { preds: [], actuals: [], lowers: [], uppers: [] }
      byDate[d].preds.push(row.predicted)
      if (row.actual != null) byDate[d].actuals.push(row.actual)
      byDate[d].lowers.push(row.confidence_lower)
      byDate[d].uppers.push(row.confidence_upper)
    })

    const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({
        date: format(parseISO(d), 'MMM dd'),
        predicted: avg(v.preds),
        actual: avg(v.actuals),
        lower: avg(v.lowers),
        upper: avg(v.uppers),
        band: [avg(v.lowers), avg(v.uppers)],
      }))
  }, [data, productId])

  const modelColor = MODEL_COLORS[model] || '#6384ff'
  const height = mini ? 200 : 320

  if (loading) return (
    <div className="loading-wrap" style={{ minHeight: height }}>
      <div className="spinner" />
      <span className="loading-text">Loading forecasts…</span>
    </div>
  )
  if (error) return <div className="error-box">Error: {error}</div>
  if (!chartData.length) return <div className="empty-state"><div className="empty-state-icon">📉</div>No data available.</div>

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={modelColor} stopOpacity={0.15} />
            <stop offset="100%" stopColor={modelColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          axisLine={false} tickLine={false}
          interval={mini ? 4 : 2}
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          axisLine={false} tickLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} />
        {!mini && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />}

        {/* Confidence band */}
        <Area
          type="monotone"
          dataKey="band"
          stroke="none"
          fill="url(#bandGrad)"
          name="Confidence Band"
          legendType="none"
        />
        {/* Actual */}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="rgba(26, 87, 228, 0.2)"
          strokeWidth={1.5}
          dot={false}
          name="Actual"
          strokeDasharray="4 3"
        />
        {/* Predicted */}
        <Line
          type="monotone"
          dataKey="predicted"
          stroke={modelColor}
          strokeWidth={2.5}
          dot={false}
          name={`Predicted (${model})`}
          activeDot={{ r: 5, fill: modelColor, stroke: 'var(--bg-base)', strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
