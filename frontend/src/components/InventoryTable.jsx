/**
 * InventoryTable.jsx
 * Table of safety stock, reorder point, EOQ with visual stock-level indicators.
 */
import { useState } from 'react'
import { useInventory } from '../hooks/useData'
import { recomputeInventory } from '../api/client'
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'

export default function InventoryTable() {
  const { data, loading, error, refetch } = useInventory()
  const [recomputing, setRecomputing] = useState(false)

  const handleRecompute = async () => {
    setRecomputing(true)
    try {
      await recomputeInventory()
      await refetch()
    } catch (e) {
      alert('Recompute failed: ' + (e?.response?.data?.detail || e.message))
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

  const reorderItems = data?.filter(i => i.needs_reorder) ?? []

  return (
    <div>
      {/* Reorder alerts */}
      {reorderItems.map(item => (
        <div key={item.product_id} className="reorder-alert">
          <div className="reorder-alert-dot" />
          <div className="reorder-alert-text">
            <span className="reorder-alert-bold">{item.product_name}</span>
            {' '}— Stock ({item.current_stock.toFixed(0)}) at or below reorder point ({item.reorder_point.toFixed(0)}).
            Suggested order: <span className="reorder-alert-bold">{item.reorder_quantity.toFixed(0)} units</span>.
          </div>
        </div>
      ))}

      {/* Recompute button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button
          id="recompute-inventory-btn"
          className="btn btn-ghost"
          onClick={handleRecompute}
          disabled={recomputing}
        >
          <RefreshCw size={13} className={recomputing ? 'spin' : ''} />
          {recomputing ? 'Recomputing…' : 'Recompute'}
        </button>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Current Stock</th>
              <th>Safety Stock</th>
              <th>Reorder Point</th>
              <th>EOQ (Order Qty)</th>
              <th>Stock Level</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(item => {
              const stockPct = Math.min(100, (item.current_stock / Math.max(item.reorder_point * 2, 1)) * 100)
              const levelColor = item.needs_reorder
                ? 'var(--accent-rose)'
                : stockPct < 60
                  ? 'var(--accent-amber)'
                  : 'var(--accent-emerald)'

              return (
                <tr key={item.product_id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.product_name}
                  </td>
                  <td className="td-mono">{item.current_stock.toFixed(1)}</td>
                  <td className="td-mono">{item.safety_stock.toFixed(1)}</td>
                  <td className="td-mono">{item.reorder_point.toFixed(1)}</td>
                  <td className="td-mono">{item.reorder_quantity.toFixed(0)}</td>
                  <td style={{ minWidth: 120 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="progress-track" style={{ flex: 1 }}>
                        <div
                          className="progress-fill"
                          style={{ width: `${stockPct}%`, background: levelColor }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: levelColor, fontWeight: 600, minWidth: 32 }}>
                        {stockPct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    {item.needs_reorder ? (
                      <span className="badge badge-warning">
                        <AlertTriangle size={10} /> Reorder
                      </span>
                    ) : (
                      <span className="badge badge-low">
                        <CheckCircle size={10} /> OK
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Assumptions */}
      <div style={{
        marginTop: 16, padding: '10px 14px',
        background: 'var(--violet-50)', borderRadius: 8,
        border: '1px solid var(--violet-border)', fontSize: 11.5,
        color: 'var(--violet-700)', lineHeight: 1.8,
      }}>
        <strong style={{ color: 'var(--violet-700)' }}>Assumptions:</strong>{' '}
        Lead time = 7 days · Service level = 95% · Ordering cost = $50 · Holding cost rate = 20%/yr.
        Current stock is simulated at reorder point (M5 has no real stock-on-hand data).
      </div>
    </div>
  )
}
