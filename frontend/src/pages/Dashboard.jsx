import { useState } from 'react'
import { ShoppingCart, PackageCheck, SearchCheck, Target, RefreshCw, CloudOff, Loader2 } from 'lucide-react'
import { useProducts, useInventory, useAnomalySummary, useModelComparison } from '../hooks/useData'
import ForecastChart from '../components/ForecastChart.jsx'
import InventoryTable from '../components/InventoryTable.jsx'
import AnomalyAlerts from '../components/AnomalyAlerts.jsx'
import ModelComparisonPanel from '../components/ModelComparisonPanel.jsx'
import WhatIfSimulator from '../components/WhatIfSimulator.jsx'
import ExplainPanel from '../components/ExplainPanel.jsx'

const MODEL_LABELS = { xgboost: 'XGBoost', prophet: 'Prophet', lstm: 'LSTM', stacked_ensemble: 'Stacked Ensemble' }

function Kpi({ tone, label, value, meta, icon: Icon }) {
  return (
    <div className={`kpi-card ${tone}`}>
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
        <div className="kpi-icon"><Icon size={18} /></div>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-meta">{meta}</div>
    </div>
  )
}

function CardHeader({ icon, tint, title, subtitle, children }) {
  return (
    <div className="card-header">
      <div>
        <div className="card-title">
          <span className="card-title-icon" style={{ background: tint }}>{icon}</span>
          {title}
        </div>
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────────────────────
function OverviewPage({ onNavigate }) {
  const { data: products } = useProducts()
  const { data: inventory } = useInventory()
  const { data: anomalySummary } = useAnomalySummary()
  const { data: comparison } = useModelComparison()

  const reorderNow = inventory?.filter(i => i.status === 'reorder_now').length ?? 0
  const reorderSoon = inventory?.filter(i => i.status === 'reorder_soon').length ?? 0
  const totalAnomalies = anomalySummary?.reduce((s, p) => s + p.total, 0) ?? 0
  const highAnomalies = anomalySummary?.reduce((s, p) => s + p.high, 0) ?? 0

  // Pick the genuinely best model by RMSE instead of assuming XGBoost
  const best = comparison
    ? Object.entries(comparison)
      .filter(([, v]) => v?.overall?.rmse != null)
      .reduce((a, b) => (b[1].overall.rmse < a[1].overall.rmse ? b : a))
    : null

  const dash = v => (inventory || anomalySummary || products ? v : '–')

  return (
    <div className="page-enter">
      <section className="hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="hero-eyebrow">AI Demand Forecasting · Walmart M5</div>
          <div className="hero-title">Predict demand, prevent stock-outs, and explain every forecast.</div>
          <div className="hero-text">
            A stacked ensemble of XGBoost, Prophet and LSTM forecasts daily demand, drives
            safety stock and reorder points, flags anomalies, and shows its reasoning with SHAP.
          </div>
        </div>
        <div className="hero-pills">
          <span className="hero-pill">3 ML models + stacking</span>
          <span className="hero-pill">Isolation Forest alerts</span>
          <span className="hero-pill">SHAP explainability</span>
          <span className="hero-pill">Groq AI assistant</span>
        </div>
      </section>

      <div className="kpi-grid">
        <Kpi tone="teal" icon={ShoppingCart} label="Products Tracked"
          value={dash(products?.length ?? 0)} meta="FOODS category · CA_1 store" />
        <Kpi tone="amber" icon={PackageCheck} label="Reorder Alerts"
          value={dash(reorderNow + reorderSoon)}
          meta={<><b>{reorderNow}</b> now · <b>{reorderSoon}</b> within lead time</>} />
        <Kpi tone="rose" icon={SearchCheck} label="Anomalies Flagged"
          value={dash(totalAnomalies)} meta={<><b>{highAnomalies}</b> high severity</>} />
        <Kpi tone="indigo" icon={Target} label="Best Model RMSE"
          value={best ? best[1].overall.rmse.toFixed(2) : '–'}
          meta={best ? <><b>{MODEL_LABELS[best[0]] ?? best[0]}</b> · 14-day holdout</> : 'loading…'} />
      </div>

      <div className="grid-2">
        <div className="card">
          <CardHeader icon="📈" tint="var(--teal-50)" title="Ensemble Forecast"
            subtitle="14-day meta-test window · average across products">
            <button className="btn btn-ghost" onClick={() => onNavigate('forecast')}>Explore</button>
          </CardHeader>
          <ForecastChart mini />
        </div>
        <div className="card">
          <CardHeader icon="🚨" tint="var(--rose-50)" title="Recent Anomalies"
            subtitle="5 most recent demand events">
            <button className="btn btn-ghost" onClick={() => onNavigate('anomalies')}>View all</button>
          </CardHeader>
          <AnomalyAlerts limit={5} compact />
        </div>
      </div>

      <div className="card">
        <CardHeader icon="🏆" tint="var(--indigo-50)" title="Model Performance Comparison"
          subtitle="XGBoost vs Prophet vs LSTM vs Stacked Ensemble · RMSE on the 14-day meta-test set">
          <button className="btn btn-ghost" onClick={() => onNavigate('comparison')}>Details</button>
        </CardHeader>
        <ModelComparisonPanel compact />
      </div>
    </div>
  )
}

// ── Page router ────────────────────────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: 'Overview', subtitle: 'System health and key metrics at a glance' },
  forecast: { title: 'Forecast Explorer', subtitle: 'Predictions with confidence intervals vs actual sales' },
  inventory: { title: 'Inventory Manager', subtitle: 'Safety stock, reorder points, and EOQ' },
  anomalies: { title: 'Anomaly Alerts', subtitle: 'AI-detected demand spikes and drops' },
  comparison: { title: 'Model Comparison', subtitle: 'XGBoost · Prophet · LSTM · Stacked Ensemble' },
  explain: { title: 'SHAP Explainer', subtitle: 'Why did the model predict this? Feature attribution' },
  simulator: { title: 'What-If Simulator', subtitle: 'Adjust inventory parameters and see the impact live' },
}

function StatusBanner({ health }) {
  if (health.status === 'waking') return (
    <div className="status-banner">
      <Loader2 size={16} className="spin" />
      <span><strong>Waking up the server…</strong> The free-tier backend sleeps when idle — the first load can take up to a minute.</span>
    </div>
  )
  if (health.status === 'offline') return (
    <div className="status-banner offline">
      <CloudOff size={16} />
      <span><strong>Can't reach the API.</strong> It may still be starting — try again in a moment.</span>
      <button className="btn btn-ghost" onClick={() => window.location.reload()}>
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  )
  return null
}

export default function Dashboard({ activeTab, health, onNavigate }) {
  const meta = PAGE_META[activeTab] || PAGE_META.dashboard

  return (
    <>
      <header className="top-header">
        <div>
          <div className="header-title">{meta.title}</div>
          <div className="header-subtitle">{meta.subtitle}</div>
        </div>
        <div className="header-controls">
          <span className="header-chip brand">M5 · CA_1 Store</span>
          <span className="header-chip hide-sm">5 FOODS SKUs</span>
        </div>
      </header>

      <div className="page-scroll">
        {health && <StatusBanner health={health} />}
        {activeTab === 'dashboard' && <OverviewPage onNavigate={onNavigate} />}
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
  const windowLabel = selectedModel === 'ensemble'
    ? '14-day meta-test window (ensemble is fit on base-model outputs)'
    : '28-day test holdout'

  return (
    <div className="page-enter">
      <div className="card">
        <CardHeader icon="📈" tint="var(--teal-50)" title="Demand Forecast with Confidence Intervals"
          subtitle={`${windowLabel} · predictions vs actual sales`}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select id="forecast-model-select" value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)} className="select" aria-label="Model">
              <option value="ensemble">Stacked Ensemble</option>
              <option value="xgboost">XGBoost</option>
              <option value="prophet">Prophet</option>
              <option value="lstm">LSTM</option>
            </select>
            <select id="forecast-product-select" value={selectedProduct || ''} aria-label="Product"
              onChange={e => setSelectedProduct(e.target.value ? parseInt(e.target.value) : null)}
              className="select">
              <option value="">All Products (avg)</option>
              {products?.map(p => (
                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <ForecastChart model={selectedModel} productId={selectedProduct} />
      </div>
    </div>
  )
}

function InventoryPage() {
  return (
    <div className="page-enter">
      <div className="card">
        <CardHeader icon="📦" tint="var(--teal-50)" title="Inventory Metrics"
          subtitle="Safety Stock · Reorder Point · Economic Order Quantity · Days until reorder" />
        <InventoryTable />
      </div>
    </div>
  )
}

function AnomaliesPage() {
  return (
    <div className="page-enter">
      <div className="card">
        <CardHeader icon="🔍" tint="var(--rose-50)" title="Demand Anomalies — Isolation Forest"
          subtitle="Spikes and drops detected across all product histories" />
        <AnomalyAlerts />
      </div>
    </div>
  )
}

function ComparisonPage() {
  return (
    <div className="page-enter">
      <div className="card">
        <CardHeader icon="🏆" tint="var(--indigo-50)" title="Model Comparison"
          subtitle="All models evaluated on the same 14-day meta-test window — no leakage" />
        <ModelComparisonPanel />
      </div>
    </div>
  )
}

function ExplainPage() {
  return (
    <div className="page-enter">
      <div className="card">
        <CardHeader icon="⚡" tint="var(--violet-50)" title="SHAP Feature Explainability"
          subtitle="Per-feature contributions to XGBoost predictions (permutation explainer)" />
        <ExplainPanel />
      </div>
    </div>
  )
}

function SimulatorPage() {
  return (
    <div className="page-enter">
      <div className="card">
        <CardHeader icon="🎛️" tint="var(--amber-50)" title="What-If Inventory Simulator"
          subtitle="Uses each product's real demand statistics — adjust assumptions and see the impact live" />
        <WhatIfSimulator />
      </div>
    </div>
  )
}
