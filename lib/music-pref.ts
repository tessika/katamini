const EVENT = "katamini-music"

let muted = false

export function musicMuted(): boolean {
  return muted
}

export function setMusicMuted(next: boolean) {
  muted = next
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT))
}

export function subscribeMusicMuted(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}
