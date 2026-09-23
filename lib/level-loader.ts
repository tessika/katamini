import { parseLevelDoc, type LevelDoc } from "./level-doc"

export interface LevelIndexEntry {
  id: string
  name: string
  file: string
}

export async function loadLevelIndex(): Promise<LevelIndexEntry[]> {
  const response = await fetch("levels/index.json")
  if (!response.ok) throw new Error("Could not load the level index")
  return response.json()
}

export async function loadLevelDoc(file: string): Promise<LevelDoc> {
  const response = await fetch(file)
  if (!response.ok) throw new Error(`Could not load ${file}`)
  return parseLevelDoc(await response.json())
}

export async function loadBuiltinLevel(id: string): Promise<LevelDoc> {
  const index = await loadLevelIndex()
  const entry = index.find((item) => item.id === id)
  if (!entry) throw new Error(`Level ${id} not found`)
  return loadLevelDoc(entry.file)
}
