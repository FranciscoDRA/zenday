import { useState, useCallback } from 'react'

export function useHistory(initialState) {
  const [history, setHistory] = useState([initialState])
  const [currentIndex, setCurrentIndex] = useState(0)
  
  const setState = useCallback((newState, shouldAddToHistory = true) => {
    if (shouldAddToHistory) {
      const newHistory = history.slice(0, currentIndex + 1)
      newHistory.push(newState)
      setHistory(newHistory)
      setCurrentIndex(newHistory.length - 1)
    }
    return newState
  }, [history, currentIndex])
  
  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      return history[currentIndex - 1]
    }
    return null
  }, [currentIndex, history])
  
  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex(currentIndex + 1)
      return history[currentIndex + 1]
    }
    return null
  }, [currentIndex, history])
  
  return { state: history[currentIndex], setState, undo, redo, canUndo: currentIndex > 0, canRedo: currentIndex < history.length - 1 }
}