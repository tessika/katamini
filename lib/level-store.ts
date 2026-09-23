import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { parseLevelDoc, type LevelAsset, type LevelDoc } from "./level-doc"

const DB_NAME = "katamini"
const DB_VERSION = 1

interface DraftRecord {
  id: string
  name: string
  updatedAt: number
  doc: LevelDoc
}

interface FileRecord {
  id: string
  name: string
  data: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveDraft(doc: LevelDoc): Promise<void> {
  const db = await openDb()
  const record: DraftRecord = {
    id: doc.id,
    name: doc.name,
    updatedAt: Date.now(),
    doc,
  }
  await requestToPromise(db.transaction("drafts", "readwrite").objectStore("drafts").put(record))
  db.close()
}

export async function listDrafts(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const db = await openDb()
  const records = await requestToPromise(
    db.transaction("drafts").objectStore("drafts").getAll() as IDBRequest<DraftRecord[]>
  )
  db.close()
  return records
    .map((record) => ({ id: record.id, name: record.name, updatedAt: record.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadDraft(id: string): Promise<LevelDoc | null> {
  const db = await openDb()
  const record = await requestToPromise(
    db.transaction("drafts").objectStore("drafts").get(id) as IDBRequest<DraftRecord | undefined>
  )
  db.close()
  return record ? parseLevelDoc(record.doc) : null
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await openDb()
  await requestToPromise(db.transaction("drafts", "readwrite").objectStore("drafts").delete(id))
  db.close()
}

export async function saveFile(id: string, name: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb()
  const record: FileRecord = { id, name, data }
  await requestToPromise(db.transaction("files", "readwrite").objectStore("files").put(record))
  db.close()
}

export async function loadFile(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb()
  const record = await requestToPromise(
    db.transaction("files").objectStore("files").get(id) as IDBRequest<FileRecord | undefined>
  )
  db.close()
  return record?.data ?? null
}

const objectUrls = new Map<string, string>()

export async function fileObjectUrl(src: string): Promise<string> {
  const id = src.startsWith("idb:") ? src.slice(4) : src
  const cached = objectUrls.get(id)
  if (cached) return cached
  const data = await loadFile(id)
  if (!data) throw new Error(`Missing file ${id}`)
  const url = URL.createObjectURL(new Blob([data]))
  objectUrls.set(id, url)
  return url
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function usesCustomFiles(doc: LevelDoc): boolean {
  return doc.assets.some((asset) => asset.kind === "file")
}

export async function exportLevel(doc: LevelDoc): Promise<void> {
  if (!usesCustomFiles(doc)) {
    downloadBlob(
      `${doc.id}.json`,
      new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" })
    )
    return
  }

  const exported: LevelDoc = structuredClone(doc)
  const files: Record<string, Uint8Array> = {}
  for (const asset of exported.assets) {
    if (asset.kind !== "file") continue
    const data = await loadFile(asset.src.startsWith("idb:") ? asset.src.slice(4) : asset.src)
    if (!data) throw new Error(`Missing packed file for ${asset.id}`)
    const packedPath = `assets/${asset.id}.glb`
    files[packedPath] = new Uint8Array(data)
    asset.src = packedPath
  }
  files["level.json"] = strToU8(JSON.stringify(exported, null, 2))
  const zipped = zipSync(files)
  downloadBlob(`${doc.id}.katamini`, new Blob([zipped], { type: "application/zip" }))
}

async function importPacked(buffer: ArrayBuffer): Promise<LevelDoc> {
  const entries = unzipSync(new Uint8Array(buffer))
  const levelBytes = entries["level.json"]
  if (!levelBytes) throw new Error("Pack is missing level.json")
  const doc = parseLevelDoc(JSON.parse(strFromU8(levelBytes)))
  for (const asset of doc.assets) {
    if (!asset.src.startsWith("assets/")) continue
    const packed = entries[asset.src]
    if (!packed) throw new Error(`Pack is missing ${asset.src}`)
    const copy = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer
    await saveFile(asset.id, asset.src, copy)
    asset.kind = "file"
    asset.src = `idb:${asset.id}`
  }
  return doc
}

export async function importLevelFile(file: File): Promise<LevelDoc> {
  const buffer = await file.arrayBuffer()
  const isZip = file.name.endsWith(".katamini") || file.name.endsWith(".zip") || looksLikeZip(buffer)
  if (isZip) return importPacked(buffer)
  return parseLevelDoc(JSON.parse(new TextDecoder().decode(buffer)))
}

function looksLikeZip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 2))
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

export async function storeImportedModel(file: File, nativeExtent: number): Promise<LevelAsset> {
  const base = file.name.replace(/\.glb$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const id = `file-${base || "model"}-${Date.now().toString(36)}`
  await saveFile(id, file.name, await file.arrayBuffer())
  return {
    id,
    name: file.name.replace(/\.glb$/i, ""),
    kind: "file",
    src: `idb:${id}`,
    nativeExtent,
  }
}
