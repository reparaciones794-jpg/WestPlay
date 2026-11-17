import { useEffect, useState } from 'react'
import { SAID_MS, useNamy } from './namyStore'
import './namyHud.css'

const LINK_TEXT: Record<string, string> = {
  pairing: 'Namy: permitilo en la ventana de Namy',
  denied: 'Namy: conexión rechazada',
}

const STATE_TEXT: Record<string, string> = {
  listening: 'escuchando',
  thinking: 'pensando…',
  speaking: 'hablando',
}

/**
 * Namy on the cab's screen (namy/protocol.ts): a small glass card at the bottom right with what she is doing and
 * what she last said, for a few seconds. It shows nothing at all while Namy isn't connected, unless the player
 * has to allow it in her window.
 */
export function NamyHud() {
  const link = useNamy((s) => s.link)
  const state = useNamy((s) => s.status.state)
  const said = useNamy((s) => s.said)
  const [now, setNow] = useState(() => Date.now())

  // Hides the words when their time is up.
  useEffect(() => {
    if (!said) return
    const left = said.at + SAID_MS - Date.now()
    if (left <= 0) return
    setNow(Date.now())
    const timer = setTimeout(() => setNow(Date.now()), left + 50)
    return () => clearTimeout(timer)
  }, [said])

  const words = said && now < said.at + SAID_MS ? said : null
  const note = link === 'connected' ? (state !== 'idle' ? `Namy · ${STATE_TEXT[state]}` : null) : (LINK_TEXT[link] ?? null)
  const shown = words !== null || note !== null

  return (
    <div className={shown ? 'namy-hud shown' : 'namy-hud'} aria-hidden={!shown}>
      <div className={words?.kind === 'alert' ? 'namy-hud-card alert' : 'namy-hud-card'}>
        {note && (
          <div className="namy-hud-note">
            <i className={`namy-hud-dot ${link === 'connected' ? state : link}`} />
            {note}
          </div>
        )}
        {words && <p className="namy-hud-text">{words.text}</p>}
      </div>
    </div>
  )
}
