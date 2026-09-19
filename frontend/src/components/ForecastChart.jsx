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

export const MODEL_COLORS = {
  ensemble: '#0d9488',   // teal-600   — brand / final model
  xgboost: '#4f46e5',    // indigo-600
  prophet: '#d97706',    // amber-600
  lstm: '#db2777',       // pink-600
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => p.dataKey !== 'band')
  const band = payload.find(p => p.dataKey === 'band')?.value
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {rows.map(p => (
        <div key={p.dataKey} className="tt-row">
          <span style={{ color: p.dataKey === 'actual' ? '#cbd5e1' : '#5eead4' }}>{p.name}</span>
          <span className="tt-value">{typeof p.value === 'number' ? p.value.toFixed(2) : '–'}</span>
        </div>
      ))}
      {Array.isArray(band) && band[0] != null && (
        <div className="tt-row" style={{ marginTop: 4, fontSize: 11 }}>
          <span style={{ color: '#94a3b8' }}>Interval</span>
          <span className="tt-value" style={{ fontWeight: 500 }}>{band[0].toFixed(1)} – {band[1].toFixed(1)}</span>
        </div>
      )}
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

  const modelColor = MODEL_COLORS[model] || MODEL_COLORS.ensemble
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
            <stop offset="0%" stopColor={modelColor} stopOpacity={0.22} />
            <stop offset="100%" stopColor={modelColor} stopOpacity={0.06} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#8a96a8', fontSize: 11 }}
          axisLine={false} tickLine={false}
          interval={mini ? 4 : 2}
        />
        <YAxis
          tick={{ fill: '#8a96a8', fontSize: 11 }}
          axisLine={false} tickLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeDasharray: '4 4' }} />
        {!mini && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 8 }} />}

        {/* Confidence band */}
        <Area
          type="monotone"
          dataKey="band"
          stroke="none"
          fill="url(#bandGrad)"
          name="Prediction interval"
          legendType="square"
        />
        {/* Actual */}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="#64748b"
          strokeWidth={1.75}
          dot={mini ? false : { r: 2.5, fill: '#64748b', strokeWidth: 0 }}
          name="Actual sales"
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
          activeDot={{ r: 5, fill: modelColor, stroke: '#fff', strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
