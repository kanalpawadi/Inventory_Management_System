import { useState } from 'react'
import {
  BarChart2, Package, AlertTriangle, Activity, TrendingUp, Zap, Home, Boxes
} from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import AIChatPanel from './components/AIChatPanel.jsx'
import useApiHealth from './hooks/useApiHealth'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Overview', icon: Home },
  { id: 'forecast', label: 'Forecast Chart', icon: TrendingUp },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'anomalies', label: 'Anomaly Alerts', icon: AlertTriangle },
  { id: 'comparison', label: 'Model Comparison', icon: BarChart2 },
  { id: 'explain', label: 'SHAP Explainer', icon: Zap },
  { id: 'simulator', label: 'What-If Simulator', icon: Activity },
]

const STATUS_TEXT = {
  checking: { title: 'Connecting…', sub: 'Reaching the API' },
  waking: { title: 'Waking server…', sub: 'Free tier cold start' },
  online: { title: 'API Connected', sub: 'XGB + LSTM + Prophet' },
  offline: { title: 'API Offline', sub: 'Check the backend' },
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const health = useApiHealth()
  const st = STATUS_TEXT[health.status]

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><Boxes size={21} strokeWidth={2.2} /></div>
          <div className="logo-text-wrap">
            <div className="logo-title">Demand IQ</div>
            <div className="logo-subtitle">Forecasting Platform</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          <div className="nav-section-label">Navigation</div>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`nav-${id}`}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={17} className="nav-icon" />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="model-badge" title={`Backend status: ${health.status}`}>
            <div className={`model-badge-dot ${health.status === 'online' ? '' : health.status === 'offline' ? 'offline' : 'waking'}`} />
            <div>
              <div className="model-badge-text">{st.title}</div>
              <div className="model-badge-sub">{st.sub}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        <Dashboard activeTab={activeTab} health={health} onNavigate={setActiveTab} />
      </main>

      {/* ── AI Chat (Groq) — floats on every page ── */}
      <AIChatPanel apiStatus={health.status} />
    </div>
  )
}
