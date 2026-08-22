/**
 * AIChatPanel.jsx
 * Floating AI assistant powered by Groq (openai/gpt-oss-20b).
 * Connected to POST /chat/explain via explainWithAI() from api/client.js
 */
import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Bot, User, Loader2, Sparkles, ChevronDown } from 'lucide-react'
import { explainWithAI, getChatStatus } from '../api/client'

/* ── Quick-prompt chips shown at the start ─────────────────────────────────── */
const QUICK_PROMPTS = [
  { label: '📦 Safety Stock?', context: 'inventory', q: 'What is safety stock and why does it matter for inventory management?' },
  { label: '📈 How is forecast made?', context: 'forecast', q: 'How does the stacked ensemble model generate demand forecasts?' },
  { label: '🚨 What triggers an anomaly?', context: 'anomaly', q: 'What conditions trigger an anomaly alert in the system?' },
  { label: '🧠 What is SHAP?', context: 'explain', q: 'Explain what SHAP values mean and how to read the SHAP chart.' },
  { label: '🔄 Reorder Point?', context: 'inventory', q: 'How is the reorder point calculated and when should I reorder stock?' },
  { label: '⚙️ What-If Simulator?', context: 'simulator', q: 'How does the What-If simulator work and what parameters can I change?' },
]

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--cyan-400)',
          animation: `typing-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  )
}

function Message({ msg }) {
  const isAI = msg.role === 'assistant'
  return (
    <div style={{
      display: 'flex', gap: 10, flexDirection: isAI ? 'row' : 'row-reverse',
      alignItems: 'flex-start', marginBottom: 14,
    }}>
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isAI
          ? 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)'
          : 'linear-gradient(135deg, var(--cyan-500), var(--cyan-700))',
        border: isAI ? '1px solid rgba(6,182,212,0.3)' : '1px solid rgba(6,182,212,0.5)',
        boxShadow: isAI ? '0 0 8px rgba(6,182,212,0.2)' : 'none',
      }}>
        {isAI
          ? <Bot size={15} color="#22d3ee" />
          : <User size={14} color="#fff" />}
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: '78%',
        background: isAI ? '#f8fafc' : 'linear-gradient(135deg, var(--cyan-600), var(--cyan-700))',
        color: isAI ? 'var(--text-primary)' : '#fff',
        border: isAI ? '1px solid var(--border)' : 'none',
        borderRadius: isAI ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
        padding: '10px 14px', fontSize: 13, lineHeight: 1.65,
        boxShadow: isAI ? '0 1px 4px rgba(0,0,0,0.06)' : '0 2px 10px rgba(6,182,212,0.25)',
        whiteSpace: 'pre-wrap',
      }}>
        {msg.content}
        {msg.timestamp && (
          <div style={{
            fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: isAI ? 'left' : 'right',
          }}>
            {msg.timestamp}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AIChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(null) // null=unknown, true/false
  const [unread, setUnread] = useState(0)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  /* Check backend Groq status on first open */
  useEffect(() => {
    if (open && configured === null) {
      getChatStatus()
        .then(s => {
          setConfigured(s.groq_configured)
          if (!s.groq_configured) {
            push('assistant', '⚠️ Groq API key is not configured. Add GROQ_API_KEY to backend/.env to enable AI answers.')
          } else {
            push('assistant', '👋 Hi! I\'m your AI inventory assistant powered by **Groq**.\n\nAsk me anything about your forecasts, anomalies, inventory levels, or SHAP explanations. You can also pick a quick question below.')
          }
        })
        .catch(() => {
          setConfigured(false)
          push('assistant', '⚠️ Could not reach the backend. Make sure the FastAPI server is running on port 8000.')
        })
    }
    if (open) {
      setUnread(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  /* Auto-scroll to bottom on new message */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function push(role, content) {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setMessages(prev => [...prev, { role, content, timestamp: now }])
    if (role === 'assistant' && !open) setUnread(n => n + 1)
  }

  async function send(question, context = 'general') {
    const q = (question || input).trim()
    if (!q || loading) return
    setInput('')
    push('user', q)
    setLoading(true)
    try {
      const res = await explainWithAI({ context, data: {}, question: q })
      push('assistant', res.reply || res.explanation || res.answer || JSON.stringify(res))
    } catch (err) {
      const detail = err?.response?.data?.detail
      push('assistant', `❌ ${detail || 'Something went wrong. Please try again.'}`)
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const noMessages = messages.length === 0

  return (
    <>
      {/* ── Keyframes ─────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes typing-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes chat-slide-up {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fab-pop {
          0%  { transform: scale(0.8); }
          70% { transform: scale(1.08); }
          100%{ transform: scale(1); }
        }
        .chat-fab:hover { transform: scale(1.08) !important; box-shadow: 0 8px 28px rgba(6,182,212,0.55) !important; }
        .chat-send-btn:hover:not(:disabled) { background: var(--cyan-500) !important; }
        .quick-chip:hover { background: rgba(6,182,212,0.15) !important; border-color: var(--cyan-400) !important; color: var(--cyan-600) !important; }
      `}</style>

      {/* ── Floating Action Button ─────────────────────────────────────────── */}
      <button
        className="chat-fab"
        onClick={() => setOpen(o => !o)}
        title="Ask AI Assistant"
        style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 1000,
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
          color: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(6,182,212,0.45), 0 2px 8px rgba(0,0,0,0.3)',
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
          animation: 'fab-pop 0.35s ease',
        }}
      >
        {open
          ? <ChevronDown size={22} />
          : <MessageCircle size={22} />}
        {unread > 0 && !open && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            background: '#f43f5e', color: '#fff',
            borderRadius: '50%', width: 18, height: 18,
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #fff',
          }}>{unread}</span>
        )}
      </button>

      {/* ── Chat Panel ────────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 96, right: 28, zIndex: 999,
          width: 380, height: 560, maxHeight: 'calc(100vh - 120px)',
          background: '#ffffff',
          borderRadius: 20,
          boxShadow: '0 24px 64px rgba(0,0,0,0.18), 0 0 0 1px rgba(6,182,212,0.15)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'chat-slide-up 0.25s ease',
        }}>

          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 100%)',
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '1px solid rgba(6,182,212,0.2)',
            flexShrink: 0,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'rgba(6,182,212,0.12)',
              border: '1px solid rgba(6,182,212,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 10px rgba(6,182,212,0.3)',
            }}>
              <Bot size={18} color="#22d3ee" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>
                AI Assistant
              </div>
              <div style={{ color: '#67e8f9', fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: configured === false ? '#f43f5e' : '#22d3ee', display: 'inline-block', boxShadow: configured === false ? 'none' : '0 0 6px #22d3ee' }} />
                {configured === false ? 'Offline' : configured === true ? 'Groq · online' : 'Connecting…'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Sparkles size={14} color="rgba(6,182,212,0.5)" />
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 28, height: 28, color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 14px 8px',
            background: '#fafafa',
          }}>
            {noMessages && (
              <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)', fontSize: 12.5 }}>
                <Bot size={32} color="var(--cyan-border)" style={{ marginBottom: 8, opacity: 0.5 }} />
                <p>Initializing AI assistant…</p>
              </div>
            )}

            {messages.map((msg, i) => <Message key={i} msg={msg} />)}

            {loading && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', border: '1px solid rgba(6,182,212,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={15} color="#22d3ee" />
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '4px 14px 14px 14px', padding: '10px 14px' }}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts (shown only until the user sends their first message) */}
          {messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !loading && (
            <div style={{
              padding: '8px 14px', borderTop: '1px solid var(--border)',
              background: '#fff', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            }}>
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p.label}
                  className="quick-chip"
                  onClick={() => send(p.q, p.context)}
                  disabled={loading || configured === false}
                  style={{
                    background: 'var(--cyan-50)', border: '1px solid var(--cyan-border)',
                    borderRadius: 99, padding: '4px 10px', fontSize: 11,
                    color: 'var(--cyan-700)', cursor: 'pointer',
                    transition: 'all 0.15s', fontFamily: 'Inter, sans-serif', fontWeight: 500,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid var(--border)',
            background: '#fff', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about forecasts, inventory, anomalies…"
              disabled={loading || configured === false}
              rows={1}
              style={{
                flex: 1, resize: 'none', border: '1px solid var(--border-strong)',
                borderRadius: 10, padding: '9px 12px', fontSize: 13,
                fontFamily: 'Inter, sans-serif', outline: 'none',
                lineHeight: 1.5, background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                transition: 'border-color 0.15s',
                overflowY: 'hidden',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--cyan-500)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-strong)'}
            />
            <button
              className="chat-send-btn"
              onClick={() => send()}
              disabled={!input.trim() || loading || configured === false}
              style={{
                width: 38, height: 38, borderRadius: 10, border: 'none',
                background: !input.trim() || loading ? '#e2e8f0' : 'var(--cyan-600)',
                color: !input.trim() || loading ? '#94a3b8' : '#fff',
                cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              {loading
                ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}