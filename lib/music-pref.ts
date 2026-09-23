const KEY = "katamini-music-muted"
const EVENT = "katamini-music"

export function musicMuted(): boolean {
  if (typeof sessionStorage === "undefined") return false
  return sessionStorage.getItem(KEY) === "1"
}

export function setMusicMuted(muted: boolean) {
  sessionStorage.setItem(KEY, muted ? "1" : "0")
  window.dispatchEvent(new Event(EVENT))
}

export function subscribeMusicMuted(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}
