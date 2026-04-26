import { useRef, useEffect } from 'react'

export function useScreenFocus() {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) {
      const timer = setTimeout(() => ref.current.focus({ preventScroll: true }), 200)
      return () => clearTimeout(timer)
    }
  }, [])
  return ref
}