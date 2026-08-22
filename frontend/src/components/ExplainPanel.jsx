/**
 * ExplainPanel.jsx
 * SHAP waterfall / bar chart — "why did the model predict X for this product on this date?"
 */
import { useState, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts'
import { useExplainDates, useExplanation, useGlobalImportance } from '../hooks/useData'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const item = payload[0]
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <p style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>{label}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--text-secondary)' }}>SHAP contribution</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: item.value >= 0 ? '#0d9488' : '#be123c' }}>
          {item.value >= 0 ? '+' : ''}{item.value?.toFixed(4)}
        </span>
      </div>
      {payload[0]?.payload?.feature_value != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Feature value</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--text-muted)' }}>
            {payload[0].payload.feature_value}
          </span>
        </div>
      )}
    </div>
  )
}

export default function ExplainPanel() {
  const [productId, setProductId] = useState(1)
  const [selectedDate, setSelectedDate] = useState('')
  const [view, setView] = useState('waterfall') // 'waterfall' | 'global'

  const { data: dates } = useExplainDates(productId)
  const { data: explanation, loading, error } = useExplanation(
    productId,
    selectedDate
  )
  const { data: globalImportance } = useGlobalImportance()

  // Auto-select first available date when product changes
  const availableDates = useMemo(() => {
    return dates?.map(d => String(d.date)).sort() ?? []
  }, [dates])

  const dateToShow = selectedDate || availableDates[0] || ''
  const { data: explainData, loading: explainLoading, error: explainError } =
    useExplanation(productId, dateToShow)

  const chartData = useMemo(() => {
    if (!explainData?.shap_values) return []
    return explainData.shap_values.map(s => ({
      feature: s.feature.replace(/_/g, ' '),
      rawFeature: s.feature,
      shap_value: parseFloat(s.shap_value.toFixed(4)),
      feature_value: parseFloat(s.feature_value.toFixed(4)),
    })).slice(0, 12) // top 12 features
  }, [explainData])

  const globalChartData = useMemo(() => {
    if (!globalImportance) return []
    return globalImportance.slice(0, 12).map(g => ({
      feature: g.feature.replace(/_/g, ' '),
      mean_abs_shap: parseFloat(g.mean_abs_shap.toFixed(4)),
    }))
  }, [globalImportance])

  const PRODUCTS = [
    { id: 1, name: 'Milk' }, { id: 2, name: 'Yogurt' },
    { id: 3, name: 'Cheese' }, { id: 4, name: 'Eggs' }, { id: 5, name: 'Bread' },
  ]

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="tabs">
          <button
            id="shap-view-waterfall"
            className={`tab ${view === 'waterfall' ? 'active' : ''}`}
            onClick={() => setView('waterfall')}
          >
            Per-Prediction SHAP
          </button>
          <button
            id="shap-view-global"
            className={`tab ${view === 'global' ? 'active' : ''}`}
            onClick={() => setView('global')}
          >
            Global Importance
          </button>
        </div>

        {view === 'waterfall' && (
          <>
            <select
              id="shap-product-select"
              className="select"
              value={productId}
              onChange={e => { setProductId(parseInt(e.target.value)); setSelectedDate('') }}
            >
              {PRODUCTS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              id="shap-date-select"
              className="select"
              value={selectedDate || dateToShow}
              onChange={e => setSelectedDate(e.target.value)}
            >
              {availableDates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Prediction summary */}
      {view === 'waterfall' && explainData && (
        <div style={{
          display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap',
        }}>
          {[
            { label: 'Base Value', value: explainData.base_value?.toFixed(2), color: 'var(--text-secondary)' },
            { label: 'SHAP Sum', value: (explainData.predicted_value - explainData.base_value)?.toFixed(2), color: 'var(--accent-blue)' },
            { label: 'Predicted Demand', value: explainData.predicted_value?.toFixed(2), color: 'var(--accent-emerald)' },
          ].map(item => (
            <div key={item.label} style={{
              background: 'rgba(99,132,255,0.06)', borderRadius: 8,
              border: '1px solid var(--border)', padding: '10px 16px', minWidth: 130,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 20, color: item.color }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {view === 'waterfall' && (
        explainLoading
          ? <div className="loading-wrap"><div className="spinner" /><span className="loading-text">Computing SHAP…</span></div>
          : explainError
            ? <div className="error-box">Error: {explainError}</div>
            : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 60, left: 120, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    type="category" dataKey="feature"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    axisLine={false} tickLine={false} width={115}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,132,255,0.06)' }} />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" />
                  <Bar dataKey="shap_value" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.shap_value >= 0 ? '#0d9488' : '#e11d48'}
                        fillOpacity={0.8}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
      )}

      {/* Global importance */}
      {view === 'global' && (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={globalChartData}
            layout="vertical"
            margin={{ top: 0, right: 40, left: 120, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              type="category" dataKey="feature"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={false} tickLine={false} width={115}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
                    borderRadius: 8, padding: '10px 14px', fontSize: 12,
                  }}>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</p>
                    <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, color: 'var(--accent-purple)' }}>
                      {payload[0]?.value?.toFixed(4)}
                    </span>
                  </div>
                )
              }}
              cursor={{ fill: 'rgba(99,132,255,0.06)' }}
            />
            <Bar dataKey="mean_abs_shap" fill="#7c3aed" fillOpacity={0.75} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      <div style={{
        marginTop: 16, padding: '8px 14px',
        background: 'rgba(99,132,255,0.06)', borderRadius: 8,
        border: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text-secondary)',
      }}>
        <strong style={{ color: 'var(--text-primary)' }}>Note:</strong> SHAP values explain the XGBoost point-forecast model using
        a black-box permutation explainer (immune to XGBoost 2.x internals issues).
        Blue = pushes prediction <em>up</em>, Red = pushes prediction <em>down</em>.
      </div>
    </div>
  )
}
