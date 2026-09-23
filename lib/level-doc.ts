export type Vec3 = [number, number, number]
export type LevelMode = "solo" | "p2p"
export type AssetKind = "builtin" | "primitive" | "file"
export type Placement = "stamp" | "cluster"
export type P2PSync = "ghost" | "pickups"

export interface LevelAsset {
  id: string
  kind: AssetKind
  src: string
  nativeExtent: number
  name?: string
}

export interface ClusterSpec {
  count: number
  radiusCm: number
  seed: number
}

export interface LevelProp {
  id: string
  assetId: string
  sizeCm: number
  position: Vec3
  yaw: number
  placement: Placement
  cluster?: ClusterSpec
  meshScale?: number
  sound?: string
  color?: string
}

export interface SizeTierDoc {
  minCm: number
  maxCm: number
  requiredCount: number
}

export interface HandlingDoc {
  wobble: number
  drag: number
}

export interface BatteryDoc {
  enabled: boolean
  charge: number
  moveDrain: number
  idleDrain: number
}

export interface PlayReport {
  seconds: number
  distance: number
  chargeSpent: number
}

export const DEFAULT_HANDLING: HandlingDoc = { wobble: 1, drag: 1 }

export const DEFAULT_BATTERY: BatteryDoc = {
  enabled: false,
  charge: 100,
  moveDrain: 0.08,
  idleDrain: 0.04,
}

export function handlingOf(rules: { handling?: HandlingDoc }): HandlingDoc {
  return {
    wobble: Number.isFinite(rules.handling?.wobble) ? Math.max(0, rules.handling!.wobble) : DEFAULT_HANDLING.wobble,
    drag: Number.isFinite(rules.handling?.drag) ? Math.max(0, rules.handling!.drag) : DEFAULT_HANDLING.drag,
  }
}

export function batteryOf(rules: { battery?: BatteryDoc }): BatteryDoc {
  const battery = rules.battery
  return {
    enabled: battery?.enabled ?? DEFAULT_BATTERY.enabled,
    charge: Number.isFinite(battery?.charge) ? Math.max(0, battery!.charge) : DEFAULT_BATTERY.charge,
    moveDrain: Number.isFinite(battery?.moveDrain) ? Math.max(0, battery!.moveDrain) : DEFAULT_BATTERY.moveDrain,
    idleDrain: Number.isFinite(battery?.idleDrain) ? Math.max(0, battery!.idleDrain) : DEFAULT_BATTERY.idleDrain,
  }
}

export interface LevelDoc {
  version: 1
  id: string
  name: string
  description?: string
  mode: LevelMode
  room: {
    sizeCm: number
    floor: string
    wall: string
    floorRepeat: [number, number]
    wallRepeat: [number, number]
    music: string[]
    ambientColor?: string
    minZoom?: number
    maxZoom?: number
    zoom?: number
    growth?: number
    zoomStep?: number
    pitch?: number
  }
  rules: {
    maxTime: number
    tiers: SizeTierDoc[]
    handling?: HandlingDoc
    battery?: BatteryDoc
  }
  p2p?: {
    roomId: string
    maxPlayers: number
    sync: P2PSync[]
  }
  assets: LevelAsset[]
  props: LevelProp[]
}

export interface SpawnedProp {
  id: string
  propId: string
  assetId: string
  sizeCm: number
  position: Vec3
  yaw: number
  meshScale?: number
  sound?: string
  color?: string
}

export interface PlayLevel {
  id: string
  name: string
  mode: LevelMode
  p2p?: LevelDoc["p2p"]
  roomSize: number
  wallTexture: string
  floorTexture: string
  wallRepeat: [number, number]
  floorRepeat: [number, number]
  backgroundMusic: string[]
  ambientColor?: string
  minZoom?: number
  maxZoom?: number
  zoom?: number
  growth: number
  zoomStep: number
  pitch: number
  maxTime: number
  handling: HandlingDoc
  battery: BatteryDoc
  sizeTiers: { min: number; max: number; requiredCount: number }[]
  spawns: SpawnedProp[]
  assets: LevelAsset[]
}

export function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function clusterLayout(sizeCm: number): { count: number; radiusCm: number } {
  const count = sizeCm < 5 ? 20 : sizeCm < 10 ? 12 : sizeCm < 20 ? 4 : 2
  const radiusCm = Number((Math.pow(sizeCm, 1.05) * 0.6).toFixed(2))
  return { count, radiusCm }
}

export function expandProps(doc: LevelDoc): SpawnedProp[] {
  const half = doc.room.sizeCm / 2
  const spawned: SpawnedProp[] = []

  for (const prop of doc.props) {
    if (prop.placement !== "cluster" || !prop.cluster) {
      spawned.push({
        id: prop.id,
        propId: prop.id,
        assetId: prop.assetId,
        sizeCm: prop.sizeCm,
        position: prop.position,
        yaw: prop.yaw,
        meshScale: prop.meshScale,
        sound: prop.sound,
        color: prop.color,
      })
      continue
    }

    const rand = mulberry32(prop.cluster.seed)
    const limit = Math.max(0, half - 0.5)
    for (let i = 0; i < prop.cluster.count; i++) {
      const angle = rand() * Math.PI * 2
      let x = prop.position[0] + Math.cos(angle) * prop.cluster.radiusCm
      let z = prop.position[2] + Math.sin(angle) * prop.cluster.radiusCm
      const centered = prop.position[0] === 0 && prop.position[2] === 0
      const dist = Math.hypot(x, z)
      if (centered && limit >= 0 && dist > limit && dist > 0) {
        x = (x / dist) * limit
        z = (z / dist) * limit
      } else if (limit >= 0) {
        x = Math.max(-limit, Math.min(limit, x))
        z = Math.max(-limit, Math.min(limit, z))
      }
      spawned.push({
        id: `${prop.id}:${i}`,
        propId: prop.id,
        assetId: prop.assetId,
        sizeCm: prop.sizeCm,
        position: [x, 0, z],
        yaw: prop.yaw + rand() * Math.PI * 2,
        meshScale: prop.meshScale,
        sound: prop.sound,
        color: prop.color,
      })
    }
  }

  return spawned
}

export function toPlayLevel(doc: LevelDoc): PlayLevel {
  return {
    id: doc.id,
    name: doc.name,
    mode: doc.mode,
    p2p: doc.p2p,
    roomSize: doc.room.sizeCm,
    wallTexture: doc.room.wall,
    floorTexture: doc.room.floor,
    wallRepeat: doc.room.wallRepeat,
    floorRepeat: doc.room.floorRepeat,
    backgroundMusic: doc.room.music,
    ambientColor: doc.room.ambientColor,
    minZoom: doc.room.minZoom,
    maxZoom: doc.room.maxZoom,
    zoom: doc.room.zoom,
    growth: Number.isFinite(doc.room.growth) ? Math.max(1.05, doc.room.growth!) : 1.55,
    zoomStep: Number.isFinite(doc.room.zoomStep) ? Math.max(0, doc.room.zoomStep!) : 0.18,
    pitch: Number.isFinite(doc.room.pitch) ? Math.max(0, Math.min(1, doc.room.pitch!)) : 0.5,
    maxTime: doc.rules.maxTime,
    handling: handlingOf(doc.rules),
    battery: batteryOf(doc.rules),
    sizeTiers: doc.rules.tiers.map((tier) => ({
      min: tier.minCm,
      max: tier.maxCm,
      requiredCount: tier.requiredCount,
    })),
    spawns: expandProps(doc),
    assets: doc.assets,
  }
}

export function assetMap(doc: LevelDoc): Map<string, LevelAsset> {
  return new Map(doc.assets.map((asset) => [asset.id, asset]))
}

export function blankLevel(): LevelDoc {
  const id = `level-${Date.now().toString(36)}`
  return {
    version: 1,
    id,
    name: "New level",
    description: "",
    mode: "solo",
    room: {
      sizeCm: 40,
      floor: "textures/floor_carpet.jpg",
      wall: "textures/wall_shoji.png",
      floorRepeat: [20, 20],
      wallRepeat: [2.5, 1],
      music: ["music/katamini_01.mp3", "music/katamini_02.mp3"],
      minZoom: 2.5,
      maxZoom: 80,
      zoom: 2.6,
      growth: 1.55,
      zoomStep: 0.18,
      pitch: 0.5,
    },
    rules: {
      maxTime: 300,
      handling: { ...DEFAULT_HANDLING },
      battery: { ...DEFAULT_BATTERY },
      tiers: [
        { minCm: 0, maxCm: 2, requiredCount: 8 },
        { minCm: 2, maxCm: 8, requiredCount: 6 },
        { minCm: 8, maxCm: 100, requiredCount: 1 },
      ],
    },
    assets: [],
    props: [],
  }
}

export function cloneLevel(doc: LevelDoc): LevelDoc {
  const copy = structuredClone(doc)
  copy.id = `${doc.id}-${Date.now().toString(36)}`
  copy.name = `${doc.name} copy`
  return copy
}

export function parseLevelDoc(data: unknown): LevelDoc {
  if (!data || typeof data !== "object") {
    throw new Error("Level file is not an object")
  }
  const doc = data as LevelDoc
  if (doc.version !== 1) throw new Error("Unsupported level version")
  if (!doc.id || !doc.name) throw new Error("Level needs an id and a name")
  if (!doc.room || !doc.rules) throw new Error("Level needs a room and rules")
  if (!Array.isArray(doc.assets) || !Array.isArray(doc.props)) {
    throw new Error("Level needs assets and props")
  }
  if (doc.mode !== "solo" && doc.mode !== "p2p") {
    throw new Error("Level mode must be solo or p2p")
  }
  const ids = new Set(doc.assets.map((asset) => asset.id))
  for (const prop of doc.props) {
    if (!ids.has(prop.assetId)) {
      throw new Error(`Missing asset ${prop.assetId}`)
    }
    if (prop.sizeCm <= 0) throw new Error(`Prop ${prop.id} needs a size`)
  }
  return doc
}

export function upsertAsset(doc: LevelDoc, asset: LevelAsset): LevelDoc {
  if (doc.assets.some((item) => item.id === asset.id)) return doc
  return { ...doc, assets: [...doc.assets, asset] }
}

export function bakeProp(doc: LevelDoc, propId: string): LevelDoc {
  const prop = doc.props.find((item) => item.id === propId)
  if (!prop || prop.placement !== "cluster" || !prop.cluster) return doc
  const spawned = expandProps({ ...doc, props: [prop] })
  const stamps: LevelProp[] = spawned.map((item) => ({
    id: item.id,
    assetId: item.assetId,
    sizeCm: item.sizeCm,
    position: item.position,
    yaw: item.yaw,
    placement: "stamp",
    meshScale: item.meshScale,
    sound: item.sound,
    color: item.color,
  }))
  return {
    ...doc,
    props: [...doc.props.filter((item) => item.id !== propId), ...stamps],
  }
}
