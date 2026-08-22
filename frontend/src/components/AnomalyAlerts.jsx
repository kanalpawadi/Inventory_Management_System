/**
 * AnomalyAlerts.jsx
 * Alert cards for demand spikes and drops from Isolation Forest.
 */
import { useState } from 'react'
import { useAnomalies, useAnomalySummary } from '../hooks/useData'
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import { format, parseISO } from 'date-fns'

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

export default function AnomalyAlerts({ limit = 200, compact = false }) {
  const [filterSeverity, setFilterSeverity] = useState('')
  const [filterProduct, setFilterProduct] = useState('')

  const { data: summary } = useAnomalySummary()
  const { data, loading, error } = useAnomalies({
    severity: filterSeverity || undefined,
    product_id: filterProduct ? parseInt(filterProduct) : undefined,
    limit,
  })

  if (loading) return (
    <div className="loading-wrap" style={{ minHeight: 140 }}>
      <div className="spinner" />
      <span className="loading-text">Loading anomalies…</span>
    </div>
  )
  if (error) return <div className="error-box">Error: {error}</div>
  if (!data?.length) return <div className="empty-state"><div className="empty-state-icon">✅</div>No anomalies detected.</div>

  const sorted = [...data].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
    new Date(b.date) - new Date(a.date)
  )

  if (compact) {
    // Compact mode: simple list for overview page
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.slice(0, limit).map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
          }}>
            <span className={`badge badge-${a.severity}`}>{a.severity}</span>
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{a.product_name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {format(parseISO(String(a.date)), 'MMM d, yyyy')}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              {a.reason === 'demand_spike'
                ? <TrendingUp size={14} color="var(--accent-orange)" />
                : <TrendingDown size={14} color="var(--accent-cyan)" />}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }}>
              {a.deviation_pct > 0 ? '+' : ''}{a.deviation_pct}%
            </span>
          </div>
        ))}
      </div>
    )
  }

  // Full mode with filters + summary pills
  return (
    <div>
      {/* Summary counts */}
      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {summary.map(p => (
            <div key={p.product_id} style={{
              background: 'var(--bg-surface)', borderRadius: 8,
              border: '1px solid var(--border)', padding: '6px 12px',
              fontSize: 12,
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.product_name}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                {p.high > 0 && <span style={{ color: 'var(--accent-rose)' }}>{p.high}H </span>}
                {p.medium > 0 && <span style={{ color: 'var(--accent-amber)' }}>{p.medium}M </span>}
                {p.low > 0 && <span style={{ color: 'var(--accent-emerald)' }}>{p.low}L</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select
          id="anomaly-severity-filter"
          className="select"
          value={filterSeverity}
          onChange={e => setFilterSeverity(e.target.value)}
        >
          <option value="">All Severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          id="anomaly-product-filter"
          className="select"
          value={filterProduct}
          onChange={e => setFilterProduct(e.target.value)}
        >
          <option value="">All Products</option>
          {summary?.map(p => (
            <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Type</th>
              <th>Actual</th>
              <th>Expected</th>
              <th>Deviation</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a, i) => (
              <tr key={i}>
                <td className="td-mono" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  {format(parseISO(String(a.date)), 'MMM d, yyyy')}
                </td>
                <td style={{ fontWeight: 600 }}>{a.product_name}</td>
                <td>
                  <span className={`badge ${a.reason === 'demand_spike' ? 'badge-spike' : 'badge-drop'}`}>
                    {a.reason === 'demand_spike'
                      ? <><TrendingUp size={10} /> Spike</>
                      : <><TrendingDown size={10} /> Drop</>}
                  </span>
                </td>
                <td className="td-mono">{a.actual_value.toFixed(1)}</td>
                <td className="td-mono">{a.expected_value.toFixed(1)}</td>
                <td className="td-mono" style={{
                  color: a.deviation_pct > 0 ? 'var(--amber-text)' : 'var(--teal-text)',
                  fontWeight: 600,
                }}>
                  {a.deviation_pct > 0 ? '+' : ''}{a.deviation_pct}%
                </td>
                <td>
                  <span className={`badge badge-${a.severity}`}>
                    {a.severity === 'high' && <AlertTriangle size={10} />}
                    {a.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
