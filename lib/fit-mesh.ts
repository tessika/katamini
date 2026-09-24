import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import type { SpawnedProp } from "./level-doc"

// Gameplay sizes are centimeters. The room and the roomba already treat one
// centimeter as 0.25 playfield units (the roomba's scale factor). Props use
// that same length, so a 1cm clip and a 1cm roomba are the same size.
export const WORLD_PER_CM = 0.25

export function visualScale(sizeCm: number, nativeExtent: number): number {
  const extent = nativeExtent > 0 ? nativeExtent : 1
  return (sizeCm * WORLD_PER_CM) / extent
}

export function pickupRadius(sizeCm: number): number {
  return (sizeCm * WORLD_PER_CM) / 2
}

export function measureExtent(root: THREE.Object3D): number {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  return Math.max(size.x, size.y, size.z, 0.0001)
}

export function placeMesh(mesh: THREE.Object3D, sizeCm: number, nativeExtent: number) {
  mesh.scale.setScalar(visualScale(sizeCm, nativeExtent))
  mesh.position.set(0, 0, 0)
  mesh.rotation.set(0, 0, 0)
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(mesh)
  const center = box.getCenter(new THREE.Vector3())
  mesh.position.x -= center.x
  mesh.position.z -= center.z
  mesh.position.y -= box.min.y
}

const cheapMaterials = new WeakMap<THREE.Material, THREE.Material>()

function asLambert(source: THREE.Material): THREE.Material {
  const cached = cheapMaterials.get(source)
  if (cached) return cached
  const colored = source as THREE.MeshStandardMaterial
  const map = colored.map ?? null
  const alphaMap = colored.alphaMap ?? null
  for (const texture of [map, alphaMap]) {
    if (!texture) continue
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.anisotropy = 1
    texture.needsUpdate = true
  }
  const next = new THREE.MeshLambertMaterial({
    map,
    alphaMap,
    color: colored.color?.clone() ?? new THREE.Color(0xffffff),
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    alphaTest: colored.alphaTest ?? 0,
  })
  cheapMaterials.set(source, next)
  return next
}

function cheapen(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  return Array.isArray(material) ? material.map(asLambert) : asLambert(material)
}

export function createPrimitive(name: string, color = "#ffcc66"): THREE.Mesh {
  let geometry: THREE.BufferGeometry
  switch (name) {
    case "cylinder":
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 10)
      break
    case "sphere":
      geometry = new THREE.SphereGeometry(0.5, 12, 8)
      break
    case "disc":
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12)
      break
    case "wedge":
      geometry = new THREE.ConeGeometry(0.5, 1, 4)
      break
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1)
  }

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color })
  )
  const extent = measureExtent(mesh)
  mesh.updateMatrix()
  mesh.geometry.applyMatrix4(new THREE.Matrix4().makeScale(1 / extent, 1 / extent, 1 / extent))
  mesh.scale.set(1, 1, 1)
  mesh.position.set(0, 0, 0)
  mesh.geometry.computeBoundingBox()
  return mesh
}

export function parseGltf(data: ArrayBuffer): Promise<THREE.Group> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.parse(data, "", (gltf) => resolve(gltf.scene), reject)
  })
}

export function wrapProp(
  model: THREE.Object3D,
  spawn: SpawnedProp,
  nativeExtent: number,
  auraMaterial: THREE.Material
): THREE.Group {
  const group = new THREE.Group()
  group.position.set(spawn.position[0], spawn.position[1] || 0, spawn.position[2])
  group.rotation.y = spawn.yaw
  if (spawn.meshScale != null) {
    model.scale.setScalar(spawn.meshScale)
    model.position.y = 0.05
  } else {
    placeMesh(model, spawn.sizeCm, nativeExtent)
  }

  model.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.material = cheapen(mesh.material)
    if (!spawn.color) return
    const material = mesh.material
    if (!Array.isArray(material) && material && "color" in material) {
      ;(material as THREE.MeshLambertMaterial).color.set(spawn.color)
    }
  })

  group.add(model)
  const radius = spawn.meshScale != null ? spawn.sizeCm * 0.05 : pickupRadius(spawn.sizeCm)
  const extent = spawn.meshScale != null ? Math.abs(spawn.meshScale) * nativeExtent : spawn.sizeCm * WORLD_PER_CM
  const aura = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), auraMaterial)
  aura.position.y = radius
  aura.visible = false
  group.add(aura)
  group.userData = {
    size: spawn.sizeCm,
    radius,
    extent,
    propId: spawn.id,
    sound: spawn.sound ?? "",
    type: spawn.assetId,
    aura,
  }
  return group
}

export async function measureGltf(data: ArrayBuffer): Promise<number> {
  const scene = await parseGltf(data)
  return measureExtent(scene)
}
