"use client"

import { useEffect, useState } from "react"
import Game from "../game"
import StartMenu from "../StartMenu"
import Editor from "../editor/Editor"
import { blankLevel, type LevelDoc, type PlayReport } from "../lib/level-doc"
import { loadBuiltinLevel, loadLevelIndex, type LevelIndexEntry } from "../lib/level-loader"

type Screen =
  | { kind: "menu" }
  | { kind: "play"; doc: LevelDoc }
  | { kind: "edit"; doc: LevelDoc; report?: PlayReport }
  | { kind: "playtest"; doc: LevelDoc }

export default function KataminiApp() {
  const [index, setIndex] = useState<LevelIndexEntry[] | null>(null)
  const [screen, setScreen] = useState<Screen>({ kind: "menu" })
  const [error, setError] = useState("")

  useEffect(() => {
    loadLevelIndex().then(setIndex).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load levels")
    })
  }, [])

  if (error) {
    return <p className="p-8 text-white">{error}</p>
  }
  if (!index) return null

  if (screen.kind === "edit") {
    return (
      <Editor
        key={screen.doc.id}
        initial={screen.doc}
        lastRun={screen.report}
        onExit={() => setScreen({ kind: "menu" })}
        onPlaytest={(doc) => setScreen({ kind: "playtest", doc })}
      />
    )
  }

  if (screen.kind === "play" || screen.kind === "playtest") {
    const doc = screen.doc
    const playtest = screen.kind === "playtest"
    return (
      <Game
        key={`${doc.id}:${playtest ? "test" : "play"}`}
        level={doc}
        measure={playtest}
        onExit={(report) => setScreen(playtest ? { kind: "edit", doc, report } : { kind: "menu" })}
      />
    )
  }

  return (
    <StartMenu
      levels={index}
      onEdit={() => setScreen({ kind: "edit", doc: blankLevel() })}
      onSelectLevel={(id) => {
        loadBuiltinLevel(id)
          .then((doc) => setScreen({ kind: "play", doc }))
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Could not start level")
          })
      }}
    />
  )
}
