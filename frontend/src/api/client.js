/**
 * src/api/client.js
 * Axios instance + typed API helpers for every backend endpoint.
 */
import axios from 'axios'

const api = axios.create({
  // Dev:  VITE_API_URL is empty → Vite proxy routes all paths → http://localhost:8000
  // Prod: VITE_API_URL=https://inventory-demand-api-571038545354.us-central1.run.app (set in .env.production)
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
})

// ── AI Chat / Groq ─────────────────────────────────────────────────────────────
export const explainWithAI = ({ context, data, question }) =>
  api.post('/chat/explain', { context, data: data || {}, question: question || '' }).then(r => r.data)

export const getChatStatus = () =>
  api.get('/chat/status').then(r => r.data)

// ── Forecast ──────────────────────────────────────────────────────────────────
export const getProducts = () =>
  api.get('/forecast/products').then(r => r.data)

export const getForecasts = ({ model = 'ensemble', product_id, start_date, end_date } = {}) => {
  const params = { model }
  if (product_id) params.product_id = product_id
  if (start_date) params.start_date = start_date
  if (end_date)   params.end_date   = end_date
  return api.get('/forecast', { params }).then(r => r.data)
}

export const getModelComparison = () =>
  api.get('/forecast/comparison').then(r => r.data)

export const getEnsembleWeights = () =>
  api.get('/forecast/ensemble-weights').then(r => r.data)

// ── Inventory ─────────────────────────────────────────────────────────────────
export const getInventory = () =>
  api.get('/inventory').then(r => r.data)

export const getSingleInventory = (product_id) =>
  api.get(`/inventory/${product_id}`).then(r => r.data)

export const recomputeInventory = () =>
  api.post('/inventory/recompute').then(r => r.data)

// ── Anomalies ─────────────────────────────────────────────────────────────────
export const getAnomalies = ({ product_id, severity, reason, limit = 200 } = {}) => {
  const params = { limit }
  if (product_id) params.product_id = product_id
  if (severity)   params.severity   = severity
  if (reason)     params.reason     = reason
  return api.get('/anomalies', { params }).then(r => r.data)
}

export const getAnomalySummary = () =>
  api.get('/anomalies/summary').then(r => r.data)

// ── Explainability ────────────────────────────────────────────────────────────
export const getExplanation = (product_id, date) =>
  api.get('/explain', { params: { product_id, date } }).then(r => r.data)

export const getGlobalImportance = () =>
  api.get('/explain/global-importance').then(r => r.data)

export const getExplainDates = (product_id) => {
  const params = {}
  if (product_id) params.product_id = product_id
  return api.get('/explain/dates', { params }).then(r => r.data)
}

export default api
