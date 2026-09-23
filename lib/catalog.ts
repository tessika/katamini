import type { LevelAsset } from "./level-doc"

export const BUILTIN_MODELS: LevelAsset[] = [
  { id: "paperclip", name: "Paperclip", kind: "builtin", src: "models/paperclip.glb", nativeExtent: 0.1596 },
  { id: "coin", name: "Coin", kind: "builtin", src: "models/coin.glb", nativeExtent: 0.4988 },
  { id: "cookie", name: "Cookie", kind: "builtin", src: "models/cookie.glb", nativeExtent: 0.6848 },
  { id: "eraser", name: "Eraser", kind: "builtin", src: "models/eraser.glb", nativeExtent: 1.9564 },
  { id: "pencil", name: "Pencil", kind: "builtin", src: "models/pencil.glb", nativeExtent: 0.5974 },
  { id: "spoon", name: "Spoon", kind: "builtin", src: "models/spoon.glb", nativeExtent: 1.5497 },
  { id: "books", name: "Books", kind: "builtin", src: "models/books.glb", nativeExtent: 2.1729 },
  { id: "duck", name: "Duck", kind: "builtin", src: "models/duck.glb", nativeExtent: 2.2733 },
  { id: "toy-car", name: "Toy car", kind: "builtin", src: "models/toy_car.glb", nativeExtent: 2.0016 },
  { id: "flowerpot", name: "Flowerpot", kind: "builtin", src: "models/flowerpot.glb", nativeExtent: 4.9241 },
  { id: "trashcan", name: "Trash can", kind: "builtin", src: "models/trashcan.glb", nativeExtent: 1.6574 },
  { id: "bench", name: "Bench", kind: "builtin", src: "models/bench.glb", nativeExtent: 2.3125 },
  { id: "chair", name: "Chair", kind: "builtin", src: "models/chair.glb", nativeExtent: 26.5187 },
  { id: "sofa", name: "Sofa", kind: "builtin", src: "models/sofa.glb", nativeExtent: 32 },
  { id: "piano", name: "Piano", kind: "builtin", src: "models/piano.glb", nativeExtent: 48 },
]

export const PRIMITIVES: LevelAsset[] = [
  { id: "box", name: "Box", kind: "primitive", src: "box", nativeExtent: 1 },
  { id: "cylinder", name: "Cylinder", kind: "primitive", src: "cylinder", nativeExtent: 1 },
  { id: "sphere", name: "Sphere", kind: "primitive", src: "sphere", nativeExtent: 1 },
  { id: "disc", name: "Disc", kind: "primitive", src: "disc", nativeExtent: 1 },
  { id: "wedge", name: "Wedge", kind: "primitive", src: "wedge", nativeExtent: 1 },
]

export const CATALOG: LevelAsset[] = [...PRIMITIVES, ...BUILTIN_MODELS]

export const FLOORS = [
  "textures/floor_carpet.jpg",
  "textures/floor_parquet.jpg",
  "textures/floor_dirt.png",
]

export const WALLS = [
  "textures/wall_shoji.png",
  "textures/wall_stars.png",
  "textures/wall_stars.mp4",
]

export const TRACKS = [
  "music/katamini_01.mp3",
  "music/katamini_02.mp3",
  "music/katamini_03.mp3",
  "music/katamini_04.mp3",
]

export function findCatalogAsset(id: string): LevelAsset | undefined {
  return CATALOG.find((asset) => asset.id === id)
}
