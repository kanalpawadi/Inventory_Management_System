/**
 * ExplainPanel.jsx
 * SHAP waterfall / bar chart — "why did the model predict X for this product on this date?"
 */
import { useState, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts'
import { useExplainDates, useExplanation, useGlobalImportance, useProducts } from '../hooks/useData'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const item = payload[0]
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      <div className="tt-row">
        <span style={{ color: '#cbd5e1' }}>SHAP contribution</span>
        <span className="tt-value" style={{ color: item.value >= 0 ? '#5eead4' : '#fda4af' }}>
          {item.value >= 0 ? '+' : ''}{item.value?.toFixed(4)}
        </span>
      </div>
      {item.payload?.feature_value != null && (
        <div className="tt-row">
          <span style={{ color: '#94a3b8', fontSize: 11 }}>Feature value</span>
          <span className="tt-value" style={{ fontSize: 11, fontWeight: 500 }}>{item.payload.feature_value}</span>
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
  const { data: globalImportance } = useGlobalImportance()

  // Auto-select first available date when product changes
  const availableDates = useMemo(() => {
    return dates?.map(d => String(d.date)).sort() ?? []
  }, [dates])

  // Default to the most recent explained date
  const dateToShow = selectedDate || availableDates[availableDates.length - 1] || ''
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

  const { data: products } = useProducts()
  const PRODUCTS = products?.map(p => ({ id: p.product_id, name: p.product_name })) ?? []

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
              {[...availableDates].reverse().map(d => (
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
            { label: 'Base value (avg prediction)', value: explainData.base_value?.toFixed(2), c: '#94a3b8' },
            { label: 'SHAP sum (this day)', value: `${explainData.predicted_value - explainData.base_value >= 0 ? '+' : ''}${(explainData.predicted_value - explainData.base_value)?.toFixed(2)}`, c: 'var(--violet-600)' },
            { label: 'Predicted demand', value: explainData.predicted_value?.toFixed(2), c: 'var(--teal-600)' },
          ].map(item => (
            <div key={item.label} className="sim-kpi" style={{ '--c': item.c, minWidth: 170, flex: 1 }}>
              <div className="sim-kpi-label">{item.label}</div>
              <div className="sim-kpi-value">{item.value}</div>
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
              <ResponsiveContainer width="100%" height={360}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 60, left: 120, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    type="category" dataKey="feature"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    axisLine={false} tickLine={false} width={115} interval={0}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                  <ReferenceLine x={0} stroke="#94a3b8" />
                  <Bar dataKey="shap_value" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.shap_value >= 0 ? '#0d9488' : '#e11d48'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
      )}

      {/* Global importance */}
      {view === 'global' && (
        <ResponsiveContainer width="100%" height={360}>
          <BarChart
            data={globalChartData}
            layout="vertical"
            margin={{ top: 0, right: 40, left: 120, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              type="category" dataKey="feature"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={false} tickLine={false} width={115} interval={0}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="chart-tooltip">
                    <div className="tt-label">{label}</div>
                    <div className="tt-row">
                      <span style={{ color: '#cbd5e1' }}>mean |SHAP|</span>
                      <span className="tt-value">{payload[0]?.value?.toFixed(4)}</span>
                    </div>
                  </div>
                )
              }}
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            />
            <Bar dataKey="mean_abs_shap" fill="#7c3aed" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="note">
        <strong>How to read this:</strong> each bar shows how much a feature moved this day's XGBoost prediction away from
        the average (base value). <span style={{ color: 'var(--teal-700)', fontWeight: 700 }}>Teal pushes demand up</span>,{' '}
        <span style={{ color: 'var(--rose-700)', fontWeight: 700 }}>red pushes it down</span>. Base value + all bars = predicted demand.
        Computed with a model-agnostic permutation explainer.
      </div>
    </div>
  )
}
