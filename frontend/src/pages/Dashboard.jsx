import { useState } from 'react'
import { TrendingUp, Package, AlertTriangle, BarChart2, Zap, Activity, Home } from 'lucide-react'
import { useProducts, useInventory, useAnomalySummary, useModelComparison } from '../hooks/useData'
import ForecastChart from '../components/ForecastChart.jsx'
import InventoryTable from '../components/InventoryTable.jsx'
import AnomalyAlerts from '../components/AnomalyAlerts.jsx'
import ModelComparisonPanel from '../components/ModelComparisonPanel.jsx'
import WhatIfSimulator from '../components/WhatIfSimulator.jsx'
import ExplainPanel from '../components/ExplainPanel.jsx'

// ── Overview KPI ───────────────────────────────────────────────────────────────
function OverviewPage() {
  const { data: products } = useProducts()
  const { data: inventory } = useInventory()
  const { data: anomalySummary } = useAnomalySummary()
  const { data: comparison } = useModelComparison()

  const totalProducts = products?.length ?? 0
  const needsReorder = inventory?.filter(i => i.needs_reorder).length ?? 0
  const totalAnomalies = anomalySummary?.reduce((s, p) => s + p.total, 0) ?? 0
  const highAnomalies = anomalySummary?.reduce((s, p) => s + p.high, 0) ?? 0
  const bestRmse = comparison?.xgboost?.overall?.rmse?.toFixed(2) ?? '–'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI Strip */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Products Tracked</div>
          <div className="kpi-value">{totalProducts}</div>
          <div className="kpi-meta">FOODS category · M5 dataset</div>
          <div className="kpi-icon">🛒</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Reorder Alerts</div>
          <div className="kpi-value" style={{ color: needsReorder > 0 ? 'var(--accent-amber)' : undefined }}>
            {needsReorder}
          </div>
          <div className="kpi-meta">products below reorder point</div>
          <div className="kpi-icon">⚠️</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Anomalies Flagged</div>
          <div className="kpi-value">{totalAnomalies}</div>
          <div className="kpi-meta">{highAnomalies} high severity</div>
          <div className="kpi-icon">🔍</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Best Model RMSE</div>
          <div className="kpi-value">{bestRmse}</div>
          <div className="kpi-meta">XGBoost on 28-day holdout</div>
          <div className="kpi-icon">🎯</div>
        </div>
      </div>

      {/* Mini charts row */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                <span className="card-title-icon" style={{ background: 'rgba(99,132,255,0.15)' }}>📈</span>
                Ensemble Forecast
              </div>
              <div className="card-subtitle">Last 28-day test window — all products</div>
            </div>
          </div>
          <ForecastChart mini />
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                <span className="card-title-icon" style={{ background: 'rgba(244,63,94,0.12)' }}>🚨</span>
                Recent Anomalies
              </div>
              <div className="card-subtitle">Top 5 most recent demand events</div>
            </div>
          </div>
          <AnomalyAlerts limit={5} compact />
        </div>
      </div>

      {/* Model comparison summary */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <span className="card-title-icon" style={{ background: 'rgba(168,85,247,0.12)' }}>🏆</span>
              Model Performance Comparison
            </div>
            <div className="card-subtitle">XGBoost vs Prophet vs LSTM vs Stacked Ensemble on meta-test set</div>
          </div>
        </div>
        <ModelComparisonPanel compact />
      </div>
    </div>
  )
}

// ── Page router ────────────────────────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: 'Overview', subtitle: 'System health and key metrics at a glance' },
  forecast: { title: 'Forecast Explorer', subtitle: 'Visualize predictions with confidence intervals' },
  inventory: { title: 'Inventory Manager', subtitle: 'Safety stock, reorder points, and EOQ' },
  anomalies: { title: 'Anomaly Alerts', subtitle: 'AI-detected demand spikes and drops' },
  comparison: { title: 'Model Comparison', subtitle: 'XGBoost · Prophet · LSTM · Stacked Ensemble' },
  explain: { title: 'SHAP Explainer', subtitle: 'Why did the model predict this? Feature attribution' },
  simulator: { title: 'What-If Simulator', subtitle: 'Adjust inventory parameters and see impact' },
}

export default function Dashboard({ activeTab }) {
  const meta = PAGE_META[activeTab] || PAGE_META.dashboard

  return (
    <>
      {/* Top header */}
      <header className="top-header">
        <div>
          <div className="header-title">{meta.title}</div>
          <div className="header-subtitle">{meta.subtitle}</div>
        </div>
        <div className="header-controls">
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            M5 · CA_1 Store · 5 FOODS SKUs
          </span>
        </div>
      </header>

      {/* Page content */}
      <div className="page-scroll">
        {activeTab === 'dashboard' && <OverviewPage />}
        {activeTab === 'forecast' && <ForecastPage />}
        {activeTab === 'inventory' && <InventoryPage />}
        {activeTab === 'anomalies' && <AnomaliesPage />}
        {activeTab === 'comparison' && <ComparisonPage />}
        {activeTab === 'explain' && <ExplainPage />}
        {activeTab === 'simulator' && <SimulatorPage />}
      </div>
    </>
  )
}

// ── Dedicated full pages ───────────────────────────────────────────────────────
function ForecastPage() {
  const { data: products } = useProducts()
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedModel, setSelectedModel] = useState('ensemble')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <span className="card-title-icon" style={{ background: 'rgba(99,132,255,0.15)' }}>📈</span>
              Demand Forecast with Confidence Intervals
            </div>
            <div className="card-subtitle">28-day test holdout predictions vs actual sales</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              id="forecast-model-select"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="select"
            >
              <option value="ensemble">Stacked Ensemble</option>
              <option value="xgboost">XGBoost</option>
              <option value="prophet">Prophet</option>
              <option value="lstm">LSTM</option>
            </select>
            <select
              id="forecast-product-select"
              value={selectedProduct || ''}
              onChange={e => setSelectedProduct(e.target.value ? parseInt(e.target.value) : null)}
              className="select"
            >
              <option value="">All Products</option>
              {products?.map(p => (
                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
              ))}
            </select>
          </div>
        </div>
        <ForecastChart model={selectedModel} productId={selectedProduct} />
      </div>
    </div>
  )
}

function InventoryPage() {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">
            <span className="card-title-icon" style={{ background: 'rgba(16,185,129,0.12)' }}>📦</span>
            Inventory Metrics
          </div>
          <div className="card-subtitle">Safety Stock · Reorder Point · Economic Order Quantity</div>
        </div>
      </div>
      <InventoryTable />
    </div>
  )
}

function AnomaliesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <span className="card-title-icon" style={{ background: 'rgba(244,63,94,0.12)' }}>🔍</span>
              Demand Anomalies — Isolation Forest
            </div>
            <div className="card-subtitle">Spikes and drops detected across all product histories</div>
          </div>
        </div>
        <AnomalyAlerts />
      </div>
    </div>
  )
}

function ComparisonPage() {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">
            <span className="card-title-icon" style={{ background: 'rgba(168,85,247,0.12)' }}>🏆</span>
            Model Comparison
          </div>
          <div className="card-subtitle">Evaluated on the same 14-day meta-test window — no leakage</div>
        </div>
      </div>
      <ModelComparisonPanel />
    </div>
  )
}

function ExplainPage() {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">
            <span className="card-title-icon" style={{ background: 'rgba(34,211,238,0.12)' }}>⚡</span>
            SHAP Feature Explainability
          </div>
          <div className="card-subtitle">Per-feature contributions to XGBoost predictions (permutation explainer)</div>
        </div>
      </div>
      <ExplainPanel />
    </div>
  )
}

function SimulatorPage() {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">
            <span className="card-title-icon" style={{ background: 'rgba(249,115,22,0.12)' }}>🎛️</span>
            What-If Inventory Simulator
          </div>
          <div className="card-subtitle">Adjust assumptions and see live impact on safety stock and reorder point</div>
        </div>
      </div>
      <WhatIfSimulator />
    </div>
  )
}
