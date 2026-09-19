/**
 * InventoryTable.jsx
 * Safety stock, reorder point, EOQ and urgency per product, with stock-level bars.
 */
import { useState } from 'react'
import { useInventory } from '../hooks/useData'
import { recomputeInventory } from '../api/client'
import { RefreshCw, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

export const PRODUCT_EMOJI = { Milk: '🥛', Yogurt: '🍶', Cheese: '🧀', Eggs: '🥚', Bread: '🍞' }

const STATUS = {
  reorder_now: { cls: 'badge-danger', label: 'Reorder now', icon: AlertTriangle, color: 'var(--rose-600)' },
  reorder_soon: { cls: 'badge-warning', label: 'Reorder soon', icon: Clock, color: 'var(--amber-500)' },
  healthy: { cls: 'badge-ok', label: 'Healthy', icon: CheckCircle, color: 'var(--teal-500)' },
}

export default function InventoryTable() {
  const { data, loading, error, refetch } = useInventory()
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeError, setRecomputeError] = useState(null)

  const handleRecompute = async () => {
    setRecomputing(true)
    setRecomputeError(null)
    try {
      await recomputeInventory()
      await refetch()
    } catch (e) {
      setRecomputeError(e?.response?.data?.detail || e.message)
    } finally {
      setRecomputing(false)
    }
  }

  if (loading) return (
    <div className="loading-wrap">
      <div className="spinner" />
      <span className="loading-text">Loading inventory…</span>
    </div>
  )
  if (error) return <div className="error-box">Error: {error}</div>

  const urgent = (data ?? []).filter(i => i.status !== 'healthy')

  return (
    <div>
      {urgent.map(item => (
        <div key={item.product_id} className={`reorder-alert ${item.status === 'reorder_now' ? 'danger' : ''}`}>
          <div className="reorder-alert-dot" />
          <div className="reorder-alert-text">
            <span className="reorder-alert-bold">{item.product_name}</span>
            {item.status === 'reorder_now'
              ? <> — stock ({item.current_stock.toFixed(0)}) is at or below the reorder point ({item.reorder_point.toFixed(0)}). </>
              : <> — hits its reorder point in <b>~{item.days_until_reorder} days</b>, inside the 7-day supplier lead time. </>}
            Suggested order: <span className="reorder-alert-bold">{item.reorder_quantity.toFixed(0)} units</span>.
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '4px 0 14px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {urgent.length === 0 ? 'All products are above their reorder points.' : `${urgent.length} product${urgent.length > 1 ? 's need' : ' needs'} attention.`}
        </div>
        <button id="recompute-inventory-btn" className="btn btn-ghost" onClick={handleRecompute} disabled={recomputing}>
          <RefreshCw size={13} className={recomputing ? 'spin' : ''} />
          {recomputing ? 'Recomputing…' : 'Recompute'}
        </button>
      </div>
      {recomputeError && <div className="error-box" style={{ marginBottom: 14 }}>Recompute failed: {recomputeError}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Current Stock</th>
              <th>Safety Stock</th>
              <th>Reorder Point</th>
              <th>EOQ (Order Qty)</th>
              <th>Avg Demand / day</th>
              <th>Stock vs Reorder Point</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(item => {
              const s = STATUS[item.status] ?? STATUS.healthy
              const Icon = s.icon
              // Bar scale: 0 → 2×ROP, so the reorder point sits at the midpoint marker
              const stockPct = Math.min(100, (item.current_stock / Math.max(item.reorder_point * 2, 1)) * 100)
              return (
                <tr key={item.product_id}>
                  <td>
                    <div className="product-cell">
                      <span className="product-avatar">{PRODUCT_EMOJI[item.product_name] ?? '📦'}</span>
                      {item.product_name}
                    </div>
                  </td>
                  <td className="td-mono" style={{ fontWeight: 700 }}>{item.current_stock.toFixed(0)}</td>
                  <td className="td-mono">{item.safety_stock.toFixed(1)}</td>
                  <td className="td-mono">{item.reorder_point.toFixed(1)}</td>
                  <td className="td-mono">{item.reorder_quantity.toFixed(0)}</td>
                  <td className="td-mono">{item.avg_daily_demand?.toFixed(1)}</td>
                  <td style={{ minWidth: 170 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="progress-track" style={{ flex: 1 }}>
                        <div className="progress-fill" style={{ width: `${stockPct}%`, background: s.color }} />
                        <div title="Reorder point" style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'var(--text-primary)', opacity: 0.35 }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, minWidth: 48, textAlign: 'right' }}>
                        {item.days_until_reorder != null && item.status !== 'reorder_now' ? `${item.days_until_reorder}d left` : 'now'}
                      </span>
                    </div>
                  </td>
                  <td><span className={`badge ${s.cls}`}><Icon size={11} /> {s.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="note">
        <strong>Assumptions:</strong> Lead time = 7 days · Service level = 95% · Ordering cost = $50 · Holding cost = 20%/yr.
        M5 has no stock-on-hand data, so current stock is simulated by replaying each product's real sales history
        through this (reorder point, EOQ) policy. The bar marker shows the reorder point.
      </div>
    </div>
  )
}
