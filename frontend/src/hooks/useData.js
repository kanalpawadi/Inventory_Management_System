/**
 * src/hooks/useData.js
 * Reusable async data-fetching hooks for all API endpoints.
 */
import { useState, useEffect, useCallback } from 'react'

/** Generic fetch hook */
function useFetch(fetchFn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchFn()
      setData(result)
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { load() }, [load])

  return { data, loading, error, refetch: load }
}

// ── Specific hooks ─────────────────────────────────────────────────────────────
import {
  getProducts, getForecasts, getModelComparison, getEnsembleWeights,
  getInventory, getAnomalies, getAnomalySummary,
  getExplanation, getGlobalImportance, getExplainDates,
} from '../api/client'

export const useProducts = () =>
  useFetch(getProducts, [])

export const useForecasts = (params) =>
  useFetch(() => getForecasts(params), [
    params?.model, params?.product_id, params?.start_date, params?.end_date
  ])

export const useModelComparison = () =>
  useFetch(getModelComparison, [])

export const useEnsembleWeights = () =>
  useFetch(getEnsembleWeights, [])

export const useInventory = () =>
  useFetch(getInventory, [])

export const useAnomalies = (params) =>
  useFetch(() => getAnomalies(params), [
    params?.product_id, params?.severity, params?.reason
  ])

export const useAnomalySummary = () =>
  useFetch(getAnomalySummary, [])

export const useExplanation = (product_id, date) =>
  useFetch(
    () => (product_id && date ? getExplanation(product_id, date) : Promise.resolve(null)),
    [product_id, date]
  )

export const useGlobalImportance = () =>
  useFetch(getGlobalImportance, [])

export const useExplainDates = (product_id) =>
  useFetch(() => getExplainDates(product_id), [product_id])
