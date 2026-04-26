import { useEffect, useState } from 'react'

export default function Splash({ onFinish }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 300)
    const t2 = setTimeout(() => setPhase(2), 900)
    const t3 = setTimeout(() => setPhase(3), 1600)
    const t4 = setTimeout(() => onFinish(), 2400)
    return () => [t1, t2, t3, t4].forEach(clearTimeout)
  }, [])

  return (
    <div className={`splash ${phase >= 1 ? 'splash-in' : ''} ${phase >= 3 ? 'splash-out' : ''}`}>
      <div className="splash-bg" />

      <div className={`splash-content ${phase >= 1 ? 'visible' : ''}`}>
        <div className={`splash-icon ${phase >= 2 ? 'icon-in' : ''}`}>
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="80" height="80" rx="20" fill="url(#grad)" />
            <circle cx="40" cy="38" r="18" stroke="white" strokeWidth="3.5" />
            <path d="M30 38L37 45L52 30" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className={`splash-text ${phase >= 2 ? 'text-in' : ''}`}>
          <h1 className="splash-title">ZenDay</h1>
          <p className="splash-subtitle">Encuentra tu flow</p>
        </div>

        <div className={`splash-loader ${phase >= 2 ? 'loader-in' : ''}`}>
          <div className="splash-bar">
            <div className={`splash-bar-fill ${phase >= 2 ? 'fill-animate' : ''}`} />
          </div>
        </div>
      </div>
    </div>
  )
}
