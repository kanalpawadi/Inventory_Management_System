/**
 * src/hooks/useApiHealth.js
 * Real backend status for the sidebar badge + cold-start banner.
 *   checking → online            (normal)
 *   checking → waking → online   (free-tier instance was asleep)
 *   … → offline                  (unreachable after the long timeout)
 */
import { useCallback, useEffect, useState } from 'react'
import { getHealth } from '../api/client'

export default function useApiHealth() {
  const [status, setStatus] = useState('checking')

  const check = useCallback(() => {
    let settled = false
    setStatus('checking')
    // If /health hasn't answered in 3s, the server is most likely waking up
    const t = setTimeout(() => { if (!settled) setStatus('waking') }, 3000)
    getHealth()
      .then(() => setStatus('online'))
      .catch(() => setStatus('offline'))
      .finally(() => { settled = true; clearTimeout(t) })
  }, [])

  useEffect(() => { check() }, [check])

  return { status, retry: check }
}
