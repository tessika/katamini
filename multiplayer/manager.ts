import * as THREE from "three"
import { joinRoom } from "trystero/nostr"
import type { JsonValue, Room } from "trystero/nostr"

export interface PlayerState {
  [key: string]: JsonValue
  position: [number, number, number]
  direction: [number, number, number]
  size: number
  held?: number
}

export interface LevelSession {
  roomId: string
  maxPlayers: number
  syncPickups: boolean
}

interface SessionHandlers {
  onPickup: (propId: string) => void
  onPeers: (count: number) => void
}

const APP_ID = "katamini"

export class MultiplayerManager {
  private peers = new Map<string, THREE.Group>()
  private onPickup: ((propId: string) => void) | null = null
  private lastBroadcast = 0
  private sendState: ((state: PlayerState) => Promise<void>) | null = null
  private sendPickup: ((propId: string) => Promise<void>) | null = null

  constructor(
    private room: Room,
    private scene: THREE.Scene,
    private maxPlayers: number
  ) {}

  start(handlers: SessionHandlers) {
    this.onPickup = handlers.onPickup
    const playerState = this.room.makeAction<PlayerState>("playerState")
    const pickups = this.room.makeAction<string>("pickup")
    this.sendState = (state) => playerState.send(state)
    this.sendPickup = (propId) => pickups.send(propId)

    playerState.onMessage = (state, context) => {
      this.applyPeer(context.peerId, state)
    }
    pickups.onMessage = (propId) => {
      this.onPickup?.(propId)
    }

    this.room.onPeerJoin = (peerId) => {
      this.welcome(peerId)
      handlers.onPeers(this.peers.size)
    }
    this.room.onPeerLeave = (peerId) => {
      const mesh = this.peers.get(peerId)
      if (mesh) this.scene.remove(mesh)
      this.peers.delete(peerId)
      handlers.onPeers(this.peers.size)
    }
    for (const peerId of Object.keys(this.room.getPeers())) this.welcome(peerId)
    handlers.onPeers(this.peers.size)
  }

  private welcome(peerId: string) {
    if (this.peers.has(peerId)) return
    if (this.peers.size >= Math.max(1, this.maxPlayers - 1)) return
    const mesh = createPeerMesh()
    this.peers.set(peerId, mesh)
    this.scene.add(mesh)
  }

  broadcast(state: PlayerState) {
    const now = Date.now()
    if (now - this.lastBroadcast < 50) return
    this.lastBroadcast = now
    void this.sendState?.(state)
  }

  broadcastPickup(propId: string) {
    void this.sendPickup?.(propId)
  }

  cleanup() {
    this.peers.forEach((mesh) => this.scene.remove(mesh))
    this.peers.clear()
    this.room.onPeerJoin = null
    this.room.onPeerLeave = null
    void this.room.leave()
  }

  private applyPeer(peerId: string, state: PlayerState) {
    const mesh = this.peers.get(peerId)
    if (!mesh) return
    mesh.position.lerp(new THREE.Vector3(state.position[0], state.position[1], state.position[2]), 0.2)
    const direction = new THREE.Vector3(state.direction[0], state.direction[1], state.direction[2])
    if (direction.lengthSq() > 0.0001) {
      mesh.lookAt(mesh.position.clone().add(direction))
    }
    mesh.scale.setScalar(Math.max(state.size, 0.05) * 0.25)
    mesh.position.y = 0.1 * mesh.scale.y
    const pile = mesh.getObjectByName("pile")
    if (pile) {
      const shown = Math.min(pile.children.length, Math.max(0, state.held ?? 0))
      pile.children.forEach((dot, index) => {
        dot.visible = index < shown
      })
    }
  }
}

function createPeerMesh(): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.2, 10),
    new THREE.MeshLambertMaterial({ color: 0x6495ed })
  )
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10),
    new THREE.MeshLambertMaterial({ color: 0x4169e1 })
  )
  top.position.y = 0.1
  const sensor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.1, 6),
    new THREE.MeshLambertMaterial({ color: 0x1e90ff })
  )
  sensor.position.set(0, 0.15, 0.3)
  body.add(top, sensor)
  const pile = new THREE.Group()
  pile.name = "pile"
  for (let index = 0; index < 8; index++) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xd8d8d8 })
    )
    const angle = (index / 8) * Math.PI * 2
    dot.position.set(Math.cos(angle) * 0.28, 0.28, Math.sin(angle) * 0.28)
    dot.visible = false
    pile.add(dot)
  }
  group.add(body, pile)
  group.scale.setScalar(0.5)
  return group
}

export async function connectLevelRoom(
  session: LevelSession,
  scene: THREE.Scene,
  handlers: SessionHandlers
): Promise<MultiplayerManager> {
  const room = joinRoom({ appId: APP_ID }, session.roomId)
  const manager = new MultiplayerManager(room, scene, session.maxPlayers)
  manager.start(handlers)
  return manager
}
