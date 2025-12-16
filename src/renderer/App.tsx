import React from 'react'

type WidgetProps = {
  title: string
  className?: string
  children?: React.ReactNode
}

function Widget({ title, className, children }: WidgetProps) {
  const hasTitle = title.trim().length > 0
  const widgetRef = React.useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = React.useState({ rotateX: 0, rotateY: 0 })
  const targetTilt = React.useRef({ rotateX: 0, rotateY: 0 })
  const animationFrame = React.useRef<number>()

  React.useEffect(() => {
    const animate = () => {
      setTilt((current) => {
        const lerpFactor = 0.15 // Smoothing factor (lower = smoother)
        const newRotateX = current.rotateX + (targetTilt.current.rotateX - current.rotateX) * lerpFactor
        const newRotateY = current.rotateY + (targetTilt.current.rotateY - current.rotateY) * lerpFactor

        // Continue with interpolated values
        return { rotateX: newRotateX, rotateY: newRotateY }
      })
      
      animationFrame.current = requestAnimationFrame(animate)
    }

    animationFrame.current = requestAnimationFrame(animate)
    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current)
    }
  }, [])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!widgetRef.current) return

    const rect = widgetRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Calculate tilt based on mouse position (-1 to 1 range)
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const tiltX = ((y - centerY) / centerY) * -8 // Max 8 degrees
    const tiltY = ((x - centerX) / centerX) * 8

    targetTilt.current = { rotateX: tiltX, rotateY: tiltY }
  }

  const handleMouseLeave = () => {
    targetTilt.current = { rotateX: 0, rotateY: 0 }
    window.overlay?.setWidgetHovering(false)
  }

  return (
    <div
      ref={widgetRef}
      className={['widget', className].filter(Boolean).join(' ')}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) translateY(${tilt.rotateX !== 0 || tilt.rotateY !== 0 ? -4 : 0}px)`,
      }}
      // Critical: hover over a widget => tell main to allow mouse events.
      onMouseEnter={() => window.overlay?.setWidgetHovering(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {hasTitle && <h3 className="widgetTitle">{title}</h3>}
      <div className="widgetBody">{children}</div>
    </div>
  )
}

function LiveClock() {
  const [now, setNow] = React.useState(() => new Date())

  React.useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined

    const scheduleNextTick = () => {
      if (cancelled) return

      // Align updates to the next whole second to avoid cumulative drift.
      const msUntilNextSecond = 1000 - (Date.now() % 1000)
      timeoutId = window.setTimeout(() => {
        setNow(new Date())
        scheduleNextTick()
      }, msUntilNextSecond)
    }

    // Update immediately, then align.
    setNow(new Date())
    scheduleNextTick()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  const hours24 = now.getHours()
  const hours12 = hours24 % 12 || 12
  const ampm = hours24 >= 12 ? 'PM' : 'AM'
  const hh = String(hours12).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayOfWeek = dayNames[now.getDay()]
  const dayOfMonth = now.getDate()

  return (
    <div className="liveClockTime" aria-label={`Time ${hh}:${mm}:${ss} ${ampm}`}>
      <span className="liveClockMain">
        {hh}:{mm}
      </span>
      <span className="liveClockSide" aria-hidden="true">
        <span className="liveClockSeconds">{ss}</span>
        <span className="liveClockAmPm">{ampm}</span>
        <span className="liveClockDate">{dayOfWeek} {dayOfMonth}</span>
      </span>
    </div>
  )
}

type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

function Chatbox() {
  const [input, setInput] = React.useState('')

  const handleSend = () => {
    // Placeholder - no actual functionality yet
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chatbox">
      <div className="chatInputArea">
        <input
          type="text"
          className="chatInput"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="chatSendButton" onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  React.useEffect(() => {
    // Start click-through (main also does this, but keeping the renderer explicit helps during reloads)
    window.overlay?.requestClickThrough(true)

    const unsubscribe = window.overlay?.onOpenSettings(() => {
      setSettingsOpen(true)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return (
    <div
      className="overlayRoot"
      // When hovering empty space, explicitly return to click-through.
      // This is a safety-net in case pointer leaves a widget without firing leave.
      onMouseMove={(e) => {
        const target = e.target as HTMLElement | null
        const insideWidget = !!target?.closest?.('.widget, .settingsPanel')
        if (!insideWidget) window.overlay?.setWidgetHovering(false)
      }}
    >
      <div className="widgetStack" aria-label="Overlay widgets">
        <Widget title="" className="widgetLive">
          <LiveClock />
        </Widget>
        <Widget title="AI Agent">
          <Chatbox />
        </Widget>
        <Widget title="Custom Widgets (Small Informational Text)">Small informational text widgets placeholder.</Widget>
      </div>

      {settingsOpen && (
        <div
          className="settingsPanel"
          onMouseEnter={() => window.overlay?.setWidgetHovering(true)}
          onMouseLeave={() => window.overlay?.setWidgetHovering(false)}
        >
          <div className="settingsHeader">
            <h2>Settings</h2>
            <button
              className="settingsClose"
              onClick={() => {
                setSettingsOpen(false)
                window.overlay?.setWidgetHovering(false)
              }}
            >
              Close
            </button>
          </div>
          <div className="widgetBody">Placeholder settings panel opened from tray.</div>
        </div>
      )}
    </div>
  )
}
