"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { CATALOG, FLOORS, TRACKS, WALLS } from "../lib/catalog"
import {
  bakeProp,
  batteryOf,
  blankLevel,
  cloneLevel,
  clusterLayout,
  expandProps,
  handlingOf,
  hashSeed,
  planProgression,
  usesAutoProgression,
  scaleForSize,
  upsertAsset,
  withTypeScale,
  type LevelAsset,
  type LevelDoc,
  type LevelProp,
  type PlayReport,
} from "../lib/level-doc"
import { createPrimitive, measureGltf, pickupRadius } from "../lib/fit-mesh"
import {
  deleteDraft,
  deleteLevelLocal,
  exportLevel,
  fileObjectUrl,
  importLevelFile,
  listDrafts,
  listSavedLevels,
  loadDraft,
  loadLevelLocal,
  saveDraft,
  saveLevelLocal,
  storeImportedModel,
  type SavedLevel,
} from "../lib/level-store"
import { loadBuiltinLevel, loadLevelIndex, type LevelIndexEntry } from "../lib/level-loader"

const SNAP = 0.5

function snap(value: number) {
  return Math.round(value / SNAP) * SNAP
}

function cloneTemplate(source: THREE.Object3D) {
  const clone = source.clone(true)
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone()
  })
  return clone
}

export default function Editor({
  initial,
  lastRun,
  onExit,
  onPlaytest,
}: {
  initial: LevelDoc
  lastRun?: PlayReport
  onExit: () => void
  onPlaytest: (doc: LevelDoc) => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState(initial)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [clusterPlace, setClusterPlace] = useState(false)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<{ id: string; name: string }[]>([])
  const [saved, setSaved] = useState<SavedLevel[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [builtins, setBuiltins] = useState<LevelIndexEntry[]>([])
  const [status, setStatus] = useState("")
  const docRef = useRef(doc)
  const selectedRef = useRef(selectedId)
  const armedRef = useRef(armedId)
  const clusterRef = useRef(clusterPlace)
  const onExitRef = useRef(onExit)
  const importRef = useRef<(file: File) => void>(() => {})
  docRef.current = doc
  selectedRef.current = selectedId
  armedRef.current = armedId
  clusterRef.current = clusterPlace
  onExitRef.current = onExit

  useEffect(() => {
    listDrafts().then((rows) => setDrafts(rows)).catch(() => {})
    setSaved(listSavedLevels())
    loadLevelIndex().then(setBuiltins).catch(() => {})
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDraft(doc).catch(() => {})
    }, 400)
    return () => window.clearTimeout(timer)
  }, [doc])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color("#141414")
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 500)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(8, 18, 10)
    scene.add(sun)

    const propsRoot = new THREE.Group()
    scene.add(propsRoot)
    const startMarker = new THREE.Group()
    startMarker.name = "start"
    const startBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12),
      new THREE.MeshBasicMaterial({ color: 0x44ff88 })
    )
    startBody.name = "start-body"
    startBody.position.y = 0.12
    const startAim = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.55, 8),
      new THREE.MeshBasicMaterial({ color: 0xffee44 })
    )
    startAim.name = "start-aim"
    startAim.rotation.x = Math.PI / 2
    startAim.position.set(0, 0.2, 0.75)
    startMarker.add(startBody, startAim)
    scene.add(startMarker)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: "#666666", roughness: 1 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.name = "floor"
    scene.add(floor)
    let grid: THREE.GridHelper | null = null
    let gridSize = -1

    const templates = new Map<string, Promise<THREE.Object3D>>()
    const groups = new Map<string, THREE.Group>()
    const loader = new GLTFLoader()
    const target = new THREE.Vector3()
    const view = { theta: 0.8, dist: 18, height: 12 }
    const keys = { w: false, a: false, s: false, d: false }
    const pointer = {
      dragging: null as string | null,
      mode: "move" as "move" | "spin" | "scale",
      panning: false,
      orbiting: false,
      lastX: 0,
      lastY: 0,
      startScale: 1,
      startDist: 1,
    }
    const raycaster = new THREE.Raycaster()
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let frame = 0
    let stopped = false

    const loadTemplate = (asset: LevelAsset) => {
      const cached = templates.get(asset.id)
      if (cached) return cached
      const pending = new Promise<THREE.Object3D>((resolve, reject) => {
        if (asset.kind === "primitive") {
          resolve(createPrimitive(asset.src))
          return
        }
        const start = (url: string) => {
          loader.load(url, (gltf) => resolve(gltf.scene), undefined, () => reject(new Error("load failed")))
        }
        if (asset.kind === "file") {
          fileObjectUrl(asset.src).then(start).catch(reject)
          return
        }
        start(asset.src)
      }).catch(() => createPrimitive("box", "#cccccc"))
      templates.set(asset.id, pending)
      return pending
    }

    const floorPoint = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = new THREE.Vector3()
      return raycaster.ray.intersectPlane(floorPlane, hit) ? hit : null
    }

    const propHit = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(propsRoot.children, true)
      const handle = hits.find((hit) => {
        let node: THREE.Object3D | null = hit.object
        while (node) {
          if (node.name === "spin" || node.name === "scale") return true
          node = node.parent
        }
        return false
      })
      const ordered = handle ? [handle, ...hits] : hits
      for (const hit of ordered) {
        let part = ""
        let node: THREE.Object3D | null = hit.object
        while (node && node.parent !== propsRoot) {
          if (node.name === "spin" || node.name === "scale") part = node.name
          node = node.parent
        }
        if (node?.userData.propId) return { group: node, part, distance: hit.distance }
      }
      return null
    }

    const placeArmed = (point: THREE.Vector3) => {
      const assetId = armedRef.current
      if (!assetId) return
      const stored = docRef.current.assets.find((item) => item.id === assetId)
      const catalog = CATALOG.find((item) => item.id === assetId)
      const asset = stored || catalog
      if (!asset) return
      const id = `p-${Math.random().toString(36).slice(2, 8)}`
      const sizeCm = asset.sizeCm ?? catalog?.sizeCm ?? 2
      const meshScale = asset.meshScale ?? catalog?.meshScale ?? 1
      const position: [number, number, number] = [snap(point.x), 0, snap(point.z)]
      const prop: LevelProp = clusterRef.current
        ? {
            id,
            assetId,
            sizeCm,
            meshScale,
            position,
            yaw: 0,
            placement: "cluster",
            cluster: { ...clusterLayout(sizeCm), seed: hashSeed(id) },
          }
        : { id, assetId, sizeCm, meshScale, position, yaw: 0, placement: "stamp" }
      setDoc((current) => upsertAsset({ ...current, props: [...current.props, prop] }, asset))
      setSelectedId(id)
      setArmedId(null)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) {
        pointer.orbiting = true
        pointer.lastX = event.clientX
        pointer.lastY = event.clientY
        return
      }
      if (event.button !== 0) return
      const point = floorPoint(event)
      const startHits = raycaster.intersectObject(startMarker, true)
      const propFirst = propHit(event)
      const startCloser = startHits.length > 0 && (!propFirst || startHits[0].distance <= propFirst.distance)
      if (startCloser && point && !armedRef.current) {
        pointer.dragging = "start"
        pointer.mode = startHits[0].object.name === "start-aim" ? "aim" : "move"
        pointer.lastX = snap(point.x)
        pointer.lastY = snap(point.z)
        return
      }
      if (armedRef.current && point) {
        placeArmed(point)
        return
      }
      const hit = propHit(event)
      if (hit) {
        const propId = hit.group.userData.propId as string
        setSelectedId(propId)
        pointer.dragging = propId
        pointer.mode = hit.part === "spin" || event.shiftKey ? "spin" : hit.part === "scale" ? "scale" : "move"
        pointer.lastX = point?.x ?? 0
        pointer.lastY = point?.z ?? 0
        const prop = docRef.current.props.find((item) => item.id === propId)
        pointer.startScale = prop?.meshScale ?? 1
        const dx = (point?.x ?? 0) - hit.group.position.x
        const dz = (point?.z ?? 0) - hit.group.position.z
        pointer.startDist = Math.max(0.2, Math.hypot(dx, dz))
        return
      }
      setSelectedId(null)
      pointer.panning = true
      pointer.lastX = event.clientX
      pointer.lastY = event.clientY
    }

    const onPointerMove = (event: PointerEvent) => {
      if (pointer.orbiting) {
        view.theta -= (event.clientX - pointer.lastX) * 0.01
        view.height = Math.max(2, view.height - (event.clientY - pointer.lastY) * 0.05)
        pointer.lastX = event.clientX
        pointer.lastY = event.clientY
        return
      }
      if (pointer.panning) {
        const pan = view.dist * 0.002
        target.x -= (event.clientX - pointer.lastX) * pan
        target.z -= (event.clientY - pointer.lastY) * pan
        pointer.lastX = event.clientX
        pointer.lastY = event.clientY
        return
      }
      if (!pointer.dragging) return
      const point = floorPoint(event)
      if (!point) return
      const propId = pointer.dragging
      if (propId === "start") {
        const start = docRef.current.room.start ?? { x: 0, z: 0, yaw: 0 }
        if (pointer.mode === "aim") {
          const yaw = Math.atan2(point.x - start.x, point.z - start.z)
          setDoc((current) => ({ ...current, room: { ...current.room, start: { x: start.x, z: start.z, yaw } } }))
          return
        }
        const x = snap(point.x)
        const z = snap(point.z)
        if (x === pointer.lastX && z === pointer.lastY) return
        pointer.lastX = x
        pointer.lastY = z
        setDoc((current) => ({ ...current, room: { ...current.room, start: { x, z, yaw: start.yaw } } }))
        return
      }
      if (pointer.mode === "spin") {
        const prop = docRef.current.props.find((item) => item.id === propId)
        if (!prop) return
        const angle = Math.atan2(point.x - prop.position[0], point.z - prop.position[2])
        setDoc((current) => ({
          ...current,
          props: current.props.map((item) => item.id === propId ? { ...item, yaw: angle } : item),
        }))
        return
      }
      if (pointer.mode === "scale") {
        const prop = docRef.current.props.find((item) => item.id === propId)
        if (!prop) return
        const dist = Math.max(0.2, Math.hypot(point.x - prop.position[0], point.z - prop.position[2]))
        const factor = dist / pointer.startDist
        const asset = docRef.current.assets.find((item) => item.id === prop.assetId) || CATALOG.find((item) => item.id === prop.assetId)
        if (!asset) return
        setDoc((current) => withTypeScale(current, asset, pointer.startScale * factor))
        return
      }
      const x = snap(point.x)
      const z = snap(point.z)
      const dx = x - pointer.lastX
      const dz = z - pointer.lastY
      if (dx === 0 && dz === 0) return
      pointer.lastX = x
      pointer.lastY = z
      setDoc((current) => ({
        ...current,
        props: current.props.map((prop) =>
          prop.id === propId
            ? { ...prop, position: [snap(prop.position[0] + dx), 0, snap(prop.position[2] + dz)] }
            : prop
        ),
      }))
    }

    const onPointerUp = () => {
      pointer.dragging = null
      pointer.mode = "move"
      pointer.panning = false
      pointer.orbiting = false
    }

    const scaleSelection = (event: WheelEvent) => {
      const propId = selectedRef.current
      const assetId = propId
        ? docRef.current.props.find((prop) => prop.id === propId)?.assetId
        : armedRef.current
      if (!assetId) return false
      const asset = docRef.current.assets.find((item) => item.id === assetId) || CATALOG.find((item) => item.id === assetId)
      if (!asset) return false
      event.preventDefault()
      const currentScale = docRef.current.props.find((prop) => prop.assetId === assetId)?.meshScale ?? asset.meshScale ?? 1
      const factor = event.deltaY > 0 ? 0.92 : 1.08
      setDoc((current) => withTypeScale(current, asset, currentScale * factor))
      return true
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
        return
      }
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault()
      }
      if (event.key === "Escape") {
        onExitRef.current()
        return
      }
      if (event.key === "w") keys.w = true
      if (event.key === "a") keys.a = true
      if (event.key === "s") keys.s = true
      if (event.key === "d") keys.d = true
      const propId = selectedRef.current
      if (!propId) {
        if (event.key === "Backspace") onExitRef.current()
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        setDoc((current) => ({ ...current, props: current.props.filter((prop) => prop.id !== propId) }))
        setSelectedId(null)
      }
      if (event.key === "[") nudgeYaw(propId, -1)
      if (event.key === "]") nudgeYaw(propId, 1)
      if (event.key === "-" || event.key === "_") nudgeSize(propId, 0.9)
      if (event.key === "=" || event.key === "+") nudgeSize(propId, 1.1)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "w") keys.w = false
      if (event.key === "a") keys.a = false
      if (event.key === "s") keys.s = false
      if (event.key === "d") keys.d = false
    }

    const nudgeYaw = (propId: string, direction: number) => {
      setDoc((current) => ({
        ...current,
        props: current.props.map((prop) =>
          prop.id === propId ? { ...prop, yaw: prop.yaw + direction * (Math.PI / 12) } : prop
        ),
      }))
    }
      const nudgeSize = (propId: string, factor: number) => {
      setDoc((current) => {
        const target = current.props.find((prop) => prop.id === propId)
        if (!target) return current
        const known = current.assets.find((asset) => asset.id === target.assetId) || CATALOG.find((asset) => asset.id === target.assetId)
        if (!known) return current
        const base = target.meshScale ?? known.meshScale ?? 1
        return withTypeScale(current, known, base * factor)
      })
    }

    const sync = () => {
      const current = docRef.current
      const start = current.room.start ?? { x: 0, z: 0, yaw: 0 }
      startMarker.position.set(start.x, 0, start.z)
      startMarker.rotation.y = start.yaw
      const room = current.room.sizeCm
      floor.scale.set(room, room, 1)
      if (!grid || gridSize !== room) {
        if (grid) {
          scene.remove(grid)
          grid.geometry.dispose()
          const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
          materials.forEach((material) => material.dispose())
        }
        grid = new THREE.GridHelper(room, Math.max(2, Math.round(room / SNAP)), 0xffffff, 0x444444)
        grid.position.y = 0.02
        scene.add(grid)
        gridSize = room
      }
      const floorMaterial = floor.material as THREE.MeshStandardMaterial
      const floorKey = `${current.room.floor}:${current.room.floorRepeat.join(",")}`
      if (floor.userData.floor !== floorKey) {
        floor.userData.floor = floorKey
        floorMaterial.map = new THREE.TextureLoader().load(current.room.floor)
        floorMaterial.map.wrapS = THREE.RepeatWrapping
        floorMaterial.map.wrapT = THREE.RepeatWrapping
        floorMaterial.map.repeat.set(current.room.floorRepeat[0], current.room.floorRepeat[1])
        floorMaterial.needsUpdate = true
      }

      const spawned = expandProps(current)
      const live = new Set(spawned.map((item) => item.id))
      for (const [id, group] of groups) {
        if (live.has(id)) continue
        propsRoot.remove(group)
        groups.delete(id)
      }

      for (const spawn of spawned) {
        const asset = current.assets.find((item) => item.id === spawn.assetId)
        if (!asset) continue
        let group = groups.get(spawn.id)
        if (!group) {
          group = new THREE.Group()
          group.userData.propId = spawn.propId
          groups.set(spawn.id, group)
          propsRoot.add(group)
          const gizmo = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
          )
          gizmo.name = "gizmo"
          group.add(gizmo)
          const holding = group
          holding.userData.extent = asset.nativeExtent
          loadTemplate(asset).then((template) => {
            if (!holding.parent) return
            const model = cloneTemplate(template)
            model.name = "model"
            const scale = (holding.userData.meshScale as number) ?? 1
            model.scale.setScalar(scale)
            model.position.y = 0.05
            holding.userData.appliedScale = scale
            holding.add(model)
          })
        }
        group.position.set(spawn.position[0], 0, spawn.position[2])
        group.rotation.y = spawn.yaw
        group.userData.propId = spawn.propId
        group.userData.sizeCm = spawn.sizeCm
        const catalogScale = CATALOG.find((item) => item.id === spawn.assetId)?.meshScale
        group.userData.meshScale = spawn.meshScale ?? asset.meshScale ?? catalogScale ?? 1
        group.userData.extent = asset.nativeExtent
        const model = group.getObjectByName("model")
        const scale = group.userData.meshScale as number
        if (model && group.userData.appliedScale !== scale) {
          model.scale.setScalar(scale)
          model.position.y = 0.05
          group.userData.appliedScale = scale
        }
        const radius = pickupRadius(spawn.sizeCm)
        const gizmo = group.getObjectByName("gizmo")
        const selected = spawn.propId === selectedRef.current
        if (gizmo) {
          gizmo.scale.setScalar(radius)
          gizmo.position.y = radius
          gizmo.visible = selected
        }
        let spin = group.getObjectByName("spin")
        let knob = group.getObjectByName("scale")
        if (selected) {
          if (!spin) {
            spin = new THREE.Mesh(
              new THREE.TorusGeometry(1, 0.08, 6, 20),
              new THREE.MeshBasicMaterial({ color: 0xff66aa })
            )
            spin.name = "spin"
            spin.rotation.x = Math.PI / 2
            group.add(spin)
          }
          if (!knob) {
            knob = new THREE.Mesh(
              new THREE.SphereGeometry(0.18, 8, 6),
              new THREE.MeshBasicMaterial({ color: 0x66ccff })
            )
            knob.name = "scale"
            group.add(knob)
          }
          const ring = Math.max(radius * 1.4, 0.45)
          spin.scale.setScalar(ring)
          spin.position.y = 0.05
          spin.visible = true
          knob.position.set(ring, 0.2, 0)
          knob.visible = true
        } else {
          if (spin) spin.visible = false
          if (knob) knob.visible = false
        }
      }
    }

    const animate = () => {
      if (stopped) return
      frame = requestAnimationFrame(animate)
      const step = view.dist * 0.015
      if (keys.w) target.z -= step
      if (keys.s) target.z += step
      if (keys.a) target.x -= step
      if (keys.d) target.x += step
      camera.position.set(
        target.x + Math.sin(view.theta) * view.dist,
        view.height,
        target.z + Math.cos(view.theta) * view.dist
      )
      camera.lookAt(target)
      sync()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    const onWheel = (event: WheelEvent) => {
      if (scaleSelection(event)) return
      view.dist = Math.min(80, Math.max(3, view.dist + event.deltaY * 0.02))
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("resize", onResize)
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false })
    renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault())
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0]
      if (!file || !file.name.toLowerCase().endsWith(".glb")) return
      event.preventDefault()
      importRef.current(file)
    }
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      renderer.domElement.remove()
      renderer.dispose()
      renderer.domElement.removeEventListener("wheel", onWheel)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [])

  const selected = doc.props.find((prop) => prop.id === selectedId) || null
  const plan = planProgression(doc)
  const autoGrowth = usesAutoProgression(doc)
  const typeId = selected?.assetId ?? armedId
  const typeStored = typeId ? doc.assets.find((asset) => asset.id === typeId) : undefined
  const typeCatalog = typeId ? CATALOG.find((asset) => asset.id === typeId) : undefined
  const typeAsset = typeStored || typeCatalog || null
  const typeScale = selected?.meshScale ?? typeStored?.meshScale ?? typeCatalog?.meshScale ?? 1
  const typeSize = selected?.sizeCm ?? typeStored?.sizeCm ?? typeCatalog?.sizeCm ?? 2

  const applyType = (assetId: string, patch: { meshScale?: number; sizeCm?: number }) => {
    setDoc((current) => {
      const known = current.assets.find((asset) => asset.id === assetId) || CATALOG.find((asset) => asset.id === assetId)
      if (!known) return current
      const meshScale = patch.meshScale ?? (patch.sizeCm != null ? scaleForSize(patch.sizeCm, known.nativeExtent) : known.meshScale ?? 1)
      return withTypeScale(current, known, meshScale)
    })
  }

  const saveLevel = () => {
    try {
      saveLevelLocal(doc)
      setSaved(listSavedLevels())
      setStatus(`Saved “${doc.name}”`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed")
    }
  }

  const updateProp = (propId: string, patch: Partial<LevelProp>) => {
    setDoc((current) => ({
      ...current,
      props: current.props.map((prop) => (prop.id === propId ? { ...prop, ...patch } : prop)),
    }))
  }

  const importGltf = async (file: File) => {
    try {
      const extent = await measureGltf(await file.arrayBuffer())
      const asset = await storeImportedModel(file, extent)
      setDoc((current) => upsertAsset(current, asset))
      setArmedId(asset.id)
      setStatus(`Imported ${asset.name}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed")
    }
  }
  importRef.current = (file) => {
    void importGltf(file)
  }

  return (
    <div className="fixed inset-0 bg-black text-white">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="absolute top-3 left-3 flex max-w-[60vw] flex-wrap gap-2">
        {CATALOG.map((asset) => (
          <button
            key={asset.id}
            className={`rounded px-2 py-1 text-sm ${armedId === asset.id ? "bg-pink-500 text-white" : "bg-white/90 text-black"}`}
            onClick={() => setArmedId(asset.id === armedId ? null : asset.id)}
          >
            {asset.name || asset.id}
          </button>
        ))}
        {doc.assets.filter((asset) => asset.kind === "file").map((asset) => (
          <button
            key={asset.id}
            className={`rounded px-2 py-1 text-sm ${armedId === asset.id ? "bg-pink-500 text-white" : "bg-white/90 text-black"}`}
            onClick={() => setArmedId(asset.id)}
          >
            {asset.name || asset.id}
          </button>
        ))}
      </div>
      {panelOpen ? (
      <aside className="absolute top-3 right-3 bottom-3 z-10 w-80 overflow-auto bg-black/80 p-3 text-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="rounded bg-pink-500 px-2 py-1" onClick={saveLevel}>Save</button>
          <button className="rounded bg-white px-2 py-1 text-black" onClick={() => onPlaytest(doc)}>Play</button>
          <button className="rounded bg-white px-2 py-1 text-black" onClick={() => exportLevel(doc).catch((err: unknown) => setStatus(err instanceof Error ? err.message : "Export failed"))}>Export</button>
          <button className="rounded bg-white/20 px-2 py-1" onClick={onExit}>Menu</button>
          <button className="rounded bg-white/20 px-2 py-1" onClick={() => setPanelOpen(false)}>Hide</button>
        </div>
        <div className="mb-3">
          <p className="mb-1 font-bold">Saved levels</p>
          {saved.length === 0 && <p className="text-white/60">Nothing saved yet.</p>}
          {saved.map((level) => (
            <div key={level.id} className="mb-1 flex gap-2">
              <button className="flex-1 truncate text-left" onClick={() => {
                const loaded = loadLevelLocal(level.id)
                if (!loaded) return
                setDoc(loaded)
                setSelectedId(null)
                setStatus(`Opened ${loaded.name}`)
              }}>{level.name}</button>
              <button onClick={() => { deleteLevelLocal(level.id); setSaved(listSavedLevels()) }}>x</button>
            </div>
          ))}
        </div>
        <label className="mb-2 block">Name
          <input className="mt-1 w-full bg-white/10 px-2 py-1" value={doc.name} onChange={(event) => setDoc({ ...doc, name: event.target.value })} />
        </label>
        <label className="mb-2 block">Mode
          <select
            className="mt-1 w-full bg-black px-2 py-1"
            value={doc.mode}
            onChange={(event) => {
              const mode = event.target.value === "p2p" ? "p2p" : "solo"
              setDoc({
                ...doc,
                mode,
                p2p: mode === "p2p" ? doc.p2p || { roomId: doc.id, maxPlayers: 4, sync: ["ghost"] } : doc.p2p,
              })
            }}
          >
            <option value="solo">Solo</option>
            <option value="p2p">P2P</option>
          </select>
        </label>
        {doc.mode === "p2p" && doc.p2p && (
          <div className="mb-3 space-y-2">
            <label className="block">Room id
              <input className="mt-1 w-full bg-white/10 px-2 py-1" value={doc.p2p.roomId} onChange={(event) => setDoc({ ...doc, p2p: { ...doc.p2p!, roomId: event.target.value } })} />
            </label>
            <label className="block">Max players
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={2} max={8} value={doc.p2p.maxPlayers} onChange={(event) => setDoc({ ...doc, p2p: { ...doc.p2p!, maxPlayers: Number(event.target.value) || 2 } })} />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doc.p2p.sync.includes("pickups")}
                onChange={(event) => {
                  const sync = event.target.checked ? ["ghost", "pickups"] as const : ["ghost"] as const
                  setDoc({ ...doc, p2p: { ...doc.p2p!, sync: [...sync] } })
                }}
              />
              Sync pickups
            </label>
          </div>
        )}
        <label className="mb-2 block">Room cm
          <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={doc.room.sizeCm} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, sizeCm: Number(event.target.value) || 1 } })} />
        </label>
        <div className="mb-3 border border-white/20 p-2">
          <p className="mb-2 font-bold">Zoom</p>
          <p className="mb-2 text-white/70">Zoom scale and step-out are halfway from the earlier camera. Raise them if the view stays too tight.</p>
          <div className="grid grid-cols-2 gap-2">
            <label>Growth
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={1.05} step="0.05" value={autoGrowth ? plan.growth : (doc.room.growth ?? 1.55)} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, growth: Math.max(1.05, Number(event.target.value) || 1.55) } })} />
            </label>
            <label>Zoom scale
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={1} step="0.05" value={doc.room.zoom ?? 2.6} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, zoom: Math.max(1, Number(event.target.value) || 2.6) } })} />
            </label>
            <label>Step out
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0} max={1} step="0.02" value={doc.room.zoomStep ?? 0.18} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, zoomStep: Math.max(0, Number(event.target.value) || 0) } })} />
            </label>
            <label>Rise
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0} max={1} step="0.05" value={doc.room.pitch ?? 0.5} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, pitch: Math.max(0, Math.min(1, Number(event.target.value) || 0)) } })} />
            </label>
          </div>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <label>Floor repeat
            <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={doc.room.floorRepeat[0]} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, floorRepeat: [Number(event.target.value) || 1, doc.room.floorRepeat[1]] } })} />
          </label>
          <label>by
            <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={doc.room.floorRepeat[1]} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, floorRepeat: [doc.room.floorRepeat[0], Number(event.target.value) || 1] } })} />
          </label>
          <label>Wall repeat
            <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={doc.room.wallRepeat[0]} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, wallRepeat: [Number(event.target.value) || 1, doc.room.wallRepeat[1]] } })} />
          </label>
          <label>by
            <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={doc.room.wallRepeat[1]} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, wallRepeat: [doc.room.wallRepeat[0], Number(event.target.value) || 1] } })} />
          </label>
        </div>
        <label className="mb-2 block">Floor
          <select className="mt-1 w-full bg-black px-2 py-1" value={doc.room.floor} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, floor: event.target.value } })}>
            {FLOORS.map((floor) => <option key={floor}>{floor}</option>)}
          </select>
        </label>
        <label className="mb-2 block">Wall
          <select className="mt-1 w-full bg-black px-2 py-1" value={doc.room.wall} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, wall: event.target.value } })}>
            {WALLS.map((wall) => <option key={wall}>{wall}</option>)}
          </select>
        </label>
        <label className="mb-2 block">Time seconds
          <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={doc.rules.maxTime} onChange={(event) => setDoc({ ...doc, rules: { ...doc.rules, maxTime: Number(event.target.value) || 1 } })} />
        </label>
        <div className="mb-3 border border-white/20 p-2">
          <p className="mb-2 font-bold">Cargo handling</p>
          <p className="mb-2 text-white/70">Nothing happens while the roomba is small. Once it is large and carrying several big objects, uneven cargo wobbles and slows it. 0 turns that part off. 1 is a light effect.</p>
          <div className="grid grid-cols-2 gap-2">
            <label>Wobble
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0} step="0.1" value={handlingOf(doc.rules).wobble} onChange={(event) => {
                const wobble = Math.max(0, Number(event.target.value) || 0)
                setDoc({ ...doc, rules: { ...doc.rules, handling: { ...handlingOf(doc.rules), wobble } } })
              }} />
            </label>
            <label>Drag
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0} step="0.1" value={handlingOf(doc.rules).drag} onChange={(event) => {
                const drag = Math.max(0, Number(event.target.value) || 0)
                setDoc({ ...doc, rules: { ...doc.rules, handling: { ...handlingOf(doc.rules), drag } } })
              }} />
            </label>
          </div>
        </div>
        <div className="mb-3 border border-white/20 p-2">
          <label className="mb-2 flex items-center gap-2 font-bold">
            <input type="checkbox" checked={batteryOf(doc.rules).enabled} onChange={(event) => {
              setDoc({ ...doc, rules: { ...doc.rules, battery: { ...batteryOf(doc.rules), enabled: event.target.checked } } })
            }} />
            Battery mode
          </label>
          <p className="mb-2 text-white/70">Charge falls while time passes and while the roomba drives. Raise the budget after a measured run.</p>
          <label className="mb-2 block">Charge budget
            <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0.1} step="0.1" value={batteryOf(doc.rules).charge} onChange={(event) => {
              const charge = Math.max(0.1, Number(event.target.value) || 0.1)
              setDoc({ ...doc, rules: { ...doc.rules, battery: { ...batteryOf(doc.rules), charge } } })
            }} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>Per distance
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0} step="0.01" value={batteryOf(doc.rules).moveDrain} onChange={(event) => {
                const moveDrain = Math.max(0, Number(event.target.value) || 0)
                setDoc({ ...doc, rules: { ...doc.rules, battery: { ...batteryOf(doc.rules), moveDrain } } })
              }} />
            </label>
            <label>Per second
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0} step="0.01" value={batteryOf(doc.rules).idleDrain} onChange={(event) => {
                const idleDrain = Math.max(0, Number(event.target.value) || 0)
                setDoc({ ...doc, rules: { ...doc.rules, battery: { ...batteryOf(doc.rules), idleDrain } } })
              }} />
            </label>
          </div>
          {lastRun && (
            <div className="mt-2 bg-white/10 p-2">
              <p>Last run {lastRun.seconds}s · drive {lastRun.distance.toFixed(1)} · charge {lastRun.chargeSpent.toFixed(1)}</p>
              <button
                className="mt-2 rounded bg-white px-2 py-1 text-black"
                onClick={() => {
                  const charge = Math.max(0.1, Math.ceil(lastRun.chargeSpent * 10) / 10)
                  setDoc({ ...doc, rules: { ...doc.rules, battery: { ...batteryOf(doc.rules), enabled: true, charge } } })
                }}
              >
                Set budget to this run
              </button>
            </div>
          )}
        </div>
        <label className="mb-2 flex items-center gap-2">
          <input type="checkbox" checked={clusterPlace} onChange={(event) => setClusterPlace(event.target.checked)} />
          Place as cluster
        </label>
        <label className="mb-3 block">Import GLB
          <input className="mt-1 block w-full" type="file" accept=".glb,model/gltf-binary" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importGltf(file)
          }} />
        </label>
        {typeAsset && (
          <div className="mb-3 border border-white/20 p-2">
            <p className="mb-2 font-bold">{typeAsset.name || typeAsset.id}</p>
            <p className="mb-2 text-white/70">Proportion and size apply to every {typeAsset.name || typeAsset.id}.</p>
            <label className="mb-2 block">Proportion
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" min={0.01} step="0.01" value={typeScale} onChange={(event) => applyType(typeAsset.id, { meshScale: Math.max(0.01, Number(event.target.value) || 0.01) })} />
            </label>
            <label className="mb-2 block">Size cm
              <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" step="0.1" value={typeSize} onChange={(event) => applyType(typeAsset.id, { sizeCm: Math.max(0.2, Number(event.target.value) || 0.2) })} />
            </label>
        {selected && (
          <div>
            <div className="mb-2 flex gap-2">
              <button className="rounded bg-white/20 px-2 py-1" onClick={() => updateProp(selected.id, { yaw: selected.yaw - Math.PI / 12 })}>Yaw left</button>
              <button className="rounded bg-white/20 px-2 py-1" onClick={() => updateProp(selected.id, { yaw: selected.yaw + Math.PI / 12 })}>Yaw right</button>
            </div>
            {selected.placement === "cluster" && selected.cluster && (
              <div className="mb-2 space-y-2">
                <label className="block">Count
                  <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={selected.cluster.count} onChange={(event) => updateProp(selected.id, { cluster: { ...selected.cluster!, count: Number(event.target.value) || 1 } })} />
                </label>
                <label className="block">Radius cm
                  <input className="mt-1 w-full bg-white/10 px-2 py-1" type="number" value={selected.cluster.radiusCm} onChange={(event) => updateProp(selected.id, { cluster: { ...selected.cluster!, radiusCm: Number(event.target.value) || 0 } })} />
                </label>
                <button className="rounded bg-white px-2 py-1 text-black" onClick={() => { setDoc(bakeProp(doc, selected.id)); setSelectedId(null) }}>Bake to stamps</button>
              </div>
            )}
            <button className="rounded bg-white/20 px-2 py-1" onClick={() => { setDoc({ ...doc, props: doc.props.filter((prop) => prop.id !== selected.id) }); setSelectedId(null) }}>Delete</button>
          </div>
        )}
          </div>
        )}
        {!autoGrowth && <div className="mb-2">
          <p className="mb-1 font-bold">Tiers</p>
          {doc.rules.tiers.map((tier, index) => (
            <div key={index} className="mb-1 flex gap-1">
              <input className="w-14 bg-white/10 px-1" type="number" value={tier.minCm} onChange={(event) => {
                const tiers = doc.rules.tiers.slice()
                tiers[index] = { ...tier, minCm: Number(event.target.value) }
                setDoc({ ...doc, rules: { ...doc.rules, tiers } })
              }} />
              <input className="w-14 bg-white/10 px-1" type="number" value={tier.maxCm} onChange={(event) => {
                const tiers = doc.rules.tiers.slice()
                tiers[index] = { ...tier, maxCm: Number(event.target.value) }
                setDoc({ ...doc, rules: { ...doc.rules, tiers } })
              }} />
              <input className="w-14 bg-white/10 px-1" type="number" value={tier.requiredCount} onChange={(event) => {
                const tiers = doc.rules.tiers.slice()
                tiers[index] = { ...tier, requiredCount: Number(event.target.value) }
                setDoc({ ...doc, rules: { ...doc.rules, tiers } })
              }} />
            </div>
          ))}
        </div>}
        <label className="mb-2 block">Music, one path per line
          <textarea className="mt-1 h-16 w-full bg-white/10 px-2 py-1" value={doc.room.music.join("\n")} onChange={(event) => setDoc({ ...doc, room: { ...doc.room, music: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } })} />
        </label>
        <label className="mb-2 block">Add a track
          <select className="mt-1 w-full bg-black px-2 py-1" defaultValue="" onChange={(event) => {
            if (!event.target.value || doc.room.music.includes(event.target.value)) return
            setDoc({ ...doc, room: { ...doc.room, music: [...doc.room.music, event.target.value] } })
            event.target.value = ""
          }}>
            <option value="">Choose</option>
            {TRACKS.map((track) => <option key={track}>{track}</option>)}
          </select>
        </label>
        <div className="mb-2 flex gap-2">
          <button className="rounded bg-white/20 px-2 py-1" onClick={() => { setDoc(blankLevel()); setSelectedId(null) }}>New</button>
          <label className="rounded bg-white/20 px-2 py-1">
            Import
            <input className="hidden" type="file" accept=".json,.katamini,.zip,application/json" onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              importLevelFile(file).then((loaded) => { setDoc(loaded); setStatus(`Opened ${loaded.name}`) }).catch((err: unknown) => setStatus(err instanceof Error ? err.message : "Import failed"))
            }} />
          </label>
        </div>
        <label className="mb-2 block">Open builtin
          <select className="mt-1 w-full bg-black px-2 py-1" defaultValue="" onChange={(event) => {
            if (!event.target.value) return
            loadBuiltinLevel(event.target.value).then((loaded) => setDoc(cloneLevel(loaded))).catch((err: unknown) => setStatus(err instanceof Error ? err.message : "Open failed"))
          }}>
            <option value="">Choose</option>
            {builtins.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
        </label>
        <div>
          <p className="mb-1 font-bold">Drafts</p>
          {drafts.map((draft) => (
            <div key={draft.id} className="mb-1 flex gap-2">
              <button className="flex-1 truncate text-left" onClick={() => loadDraft(draft.id).then((loaded) => loaded && setDoc(loaded))}>{draft.name}</button>
              <button onClick={() => deleteDraft(draft.id).then(() => setDrafts((rows) => rows.filter((row) => row.id !== draft.id)))}>x</button>
            </div>
          ))}
        </div>
        {autoGrowth && (
          <div className="mb-3 border border-white/20 p-2">
            <p className="mb-1 font-bold">Growth from your objects</p>
            <p className="text-white/70">Each step is a small bump, and the roomba stays smaller than the objects in that step.</p>
            {plan.tiers.map((tier, index) => (
              <p key={index} className="mt-1 text-white/80">{tier.requiredCount} objects from {tier.minCm} to {tier.maxCm} cm</p>
            ))}
          </div>
        )}
        {status && <p className="mt-3 text-pink-300">{status}</p>}
      </aside>
      ) : (
        <button className="absolute top-3 right-3 z-10 rounded bg-black/80 px-3 py-2 text-sm" onClick={() => setPanelOpen(true)}>Menu</button>
      )}
      <p className="absolute bottom-3 left-3 max-w-xl text-sm text-white/80">
        The green disc is the roomba. Drag it to place the start, and drag the yellow arrow to set facing. Drag objects to move them. Drag the pink ring to turn one object. Drag the blue dot, or scroll, to resize that whole type. Right-drag orbits.
      </p>
    </div>
  )
}
