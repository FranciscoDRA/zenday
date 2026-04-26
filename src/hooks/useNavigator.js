import { useState, useCallback } from 'react'

export function useNavigator() {
  const [stack, setStack] = useState(['dashboard'])
  const [params, setParams] = useState({})
  
  const navigate = useCallback((screenId, screenParams = {}) => {
    setStack(prev => [...prev, screenId])
    setParams(prev => ({ ...prev, [screenId]: screenParams }))
  }, [])
  
  const goBack = useCallback(() => {
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])
  
  const goToRoot = useCallback((screenId) => {
    setStack([screenId])
    setParams({ [screenId]: {} })
  }, [])
  
  const canGoBack = stack.length > 1
  return { stack, current: stack[stack.length - 1], canGoBack, navigate, goBack, goToRoot, params }
}