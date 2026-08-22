import { useState } from 'react'
import {
  BarChart2, Package, AlertTriangle, Cpu, Activity, TrendingUp,
  Zap, RefreshCw, Home
} from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import AIChatPanel from './components/AIChatPanel.jsx'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Overview', icon: Home },
  { id: 'forecast', label: 'Forecast Chart', icon: TrendingUp },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'anomalies', label: 'Anomaly Alerts', icon: AlertTriangle },
  { id: 'comparison', label: 'Model Comparison', icon: BarChart2 },
  { id: 'explain', label: 'SHAP Explainer', icon: Zap },
  { id: 'simulator', label: 'What-If Simulator', icon: Activity },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">📦</div>
          <div className="logo-title">Demand IQ</div>
          <div className="logo-subtitle">Forecasting Platform</div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Navigation</div>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <div
              key={id}
              id={`nav-${id}`}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={16} className="nav-icon" />
              {label}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="model-badge">
            <div className="model-badge-dot" />
            <div>
              <div className="model-badge-text">API Connected</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                XGB + LSTM + Prophet
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        <Dashboard activeTab={activeTab} />
      </main>

      {/* ── AI Chat (Groq) — floats on every page ── */}
      <AIChatPanel />
    </div>
  )
}
