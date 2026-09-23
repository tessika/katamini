"use client"

import { useEffect, useState } from "react"
import { musicMuted, setMusicMuted, subscribeMusicMuted } from "../lib/music-pref"

export function MusicControls({ onSkip }: { onSkip: () => void }) {
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    setMuted(musicMuted())
    return subscribeMusicMuted(() => setMuted(musicMuted()))
  }, [])

  return (
    <div className="fixed top-4 right-4 z-50 flex gap-1 text-xs font-bold">
      <button
        type="button"
        className="rounded-full bg-black/70 px-3 py-1 text-white"
        onClick={() => setMusicMuted(!muted)}
      >
        {muted ? "unmute" : "mute"}
      </button>
      <button
        type="button"
        className="rounded-full bg-black/70 px-3 py-1 text-white"
        onClick={onSkip}
      >
        skip
      </button>
    </div>
  )
}
