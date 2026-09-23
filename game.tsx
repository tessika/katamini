"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SizeIndicator } from "./components/size-indicator";
import { auraVertexShader, auraFragmentShader } from "./shaders/aura";
import type { GameState } from "./types/game";
import type { LevelDoc } from "./lib/level-doc";
import { toPlayLevel, type PlayReport } from "./lib/level-doc";
import { MusicControls } from "./components/music-controls";
import { musicMuted, subscribeMusicMuted } from "./lib/music-pref";
import { createPrimitive, wrapProp } from "./lib/fit-mesh";
import { fileObjectUrl } from "./lib/level-store";
import type { MultiplayerManager } from "./multiplayer/manager";

const Game: React.FC<{ level: LevelDoc; onExit: (report?: PlayReport) => void; measure?: boolean }> = ({ level, onExit, measure = false }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const skipMusicRef = useRef<() => void>(() => {});
  const blipSoundRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<THREE.Mesh | null>(null);
  const collectedObjectsRef = useRef<THREE.Group | null>(null);
  const finishedRef = useRef(false);
  const keysRef = useRef({
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    Space: false
  });

  const touchRef = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    isDragging: false
  });

  const [gameState, setGameState] = useState<GameState>({
    playerSize: 0.5,
    collectedObjects: [],
    timeElapsed: 0,
    currentClass: 0,
    currentLevel: level.id,
    levelProgress: {},
  });
  const playerSizeRef = useRef(0.5);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  playerSizeRef.current = gameState.playerSize;
  const [peerCount, setPeerCount] = useState(0);
  const netRef = useRef<MultiplayerManager | null>(null);
  const [userInteracted, setUserInteracted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [drained, setDrained] = useState(false);
  const [batteryPercent, setBatteryPercent] = useState<number | null>(level.rules.battery?.enabled ? 100 : null);
  const [meter, setMeter] = useState({ seconds: 0, distance: 0, chargeSpent: 0 });
  const reportRef = useRef<PlayReport>({ seconds: 0, distance: 0, chargeSpent: 0 });
  const leave = () => {
    finishedRef.current = true;
    onExitRef.current(reportRef.current);
  };
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  const detectMobileDevice = () => {
    return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  };

  const loader = new GLTFLoader();

  const playRandomSound = (sounds: string[]) => {
    const randomIndex = Math.floor(Math.random() * sounds.length);
    const sound = new Audio(sounds[randomIndex]);
    sound.volume = 0.3;
    sound.play().catch((error) => {
      console.log("Failed to play random sound:", error);
    });
  };

  function randoSeed(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  useEffect(() => {
    setIsMobileDevice(detectMobileDevice());
  }, []);

  useEffect(() => {
    // handle controls on game over screen
    if (gameOver || drained) {
      let armed = false;
      const arm = () => {
        armed = true;
      };
      const handleKeyPress = (event: KeyboardEvent) => {
        if (!armed) return;
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape' || event.key === 'Backspace') {
          event.preventDefault();
          leave();
        }
      };
      window.addEventListener('keyup', arm);
      window.addEventListener('keydown', handleKeyPress);
      return () => {
        window.removeEventListener('keyup', arm);
        window.removeEventListener('keydown', handleKeyPress);
      };
    }
  }, [gameOver, drained]);   

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      isDragging: true
    };
    console.log('Touch start', touchRef.current);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!touchRef.current.isDragging) return;

    const touch = event.touches[0];

    // Calculate delta from last position
    const deltaX = touch.clientX - touchRef.current.lastX;
    const deltaY = touch.clientY - touchRef.current.lastY;

    // Reset all keys first
    keysRef.current.ArrowUp = false;
    keysRef.current.ArrowDown = false;
    keysRef.current.ArrowLeft = false;
    keysRef.current.ArrowRight = false;

    // Update keys based on movement
    const threshold = 2; // Much lower threshold

    if (Math.abs(deltaY) > threshold || Math.abs(deltaX) > threshold) {
      // If moving more vertically
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        if (deltaY < 0) {
          keysRef.current.ArrowUp = true;
        } else {
          keysRef.current.ArrowDown = true;
        }
      }
      // If moving more horizontally
      else {
        if (deltaX < 0) {
          keysRef.current.ArrowLeft = true;
        } else {
          keysRef.current.ArrowRight = true;
        }
      }
    }

    // Update last position
    touchRef.current.lastX = touch.clientX;
    touchRef.current.lastY = touch.clientY;

    console.log('Touch move', { deltaX, deltaY, keys: { ...keysRef.current } });
  };

  const handleTouchEnd = () => {
    touchRef.current.isDragging = false;
    keysRef.current.ArrowUp = false;
    keysRef.current.ArrowDown = false;
    keysRef.current.ArrowLeft = false;
    keysRef.current.ArrowRight = false;
    console.log('Touch end');
  };


  // Handle keyboard controls
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      keysRef.current[event.code] = true;
      if (event.code === "Space" || event.code === "Backspace") {
        event.preventDefault();
      }
      if (event.code === "Escape" || event.code === "Backspace") {
        leave();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current[event.code] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Update player scale when playerSize changes
  useEffect(() => {
    if (playerRef.current) {
      // Scale only the player geometry and its direct parts
      playerRef.current.children.forEach(child => {
        if (child instanceof THREE.Group && child === collectedObjectsRef.current) {
          // Counter-scale the collected objects container
          child.scale.setScalar(1 / Math.max(gameState.playerSize * 0.25, 0.05));
        } else {
          // Scale roomba parts (top disc and sensor)
          child.scale.setScalar(1);
        }
      });
      
      // Scale the player
      playerRef.current.scale.setScalar(gameState.playerSize * 0.25);
      playerRef.current.position.y = 0.1 * playerRef.current.scale.y;
    }
  }, [gameState.playerSize]);

  // Handle user interaction
  useEffect(() => {
    const handleUserInteraction = () => {
      setUserInteracted(true);
      window.removeEventListener("click", handleUserInteraction);
      window.removeEventListener("keydown", handleUserInteraction);
    };

    window.addEventListener("click", handleUserInteraction);
    window.addEventListener("keydown", handleUserInteraction);

    return () => {
      window.removeEventListener("click", handleUserInteraction);
      window.removeEventListener("keydown", handleUserInteraction);
    };
  }, []);

  // Music system
  useEffect(() => {
	  let audio: HTMLAudioElement | null = null;
	  let blipSound: HTMLAudioElement | null = null;

	  const playAudio = () => {
	    if (audio) {
	      audio.play().catch((error) => {
	        console.log("Failed to play audio:", error);
	      });
	    }
	  };

	  const stopAudio = () => {
	    if (audio) {
	      audio.pause();
	      // audio = null;
	    }
	    if (blipSound) {
	      blipSound = null;
	    }
	  };

	  const startTrack = () => {
	    if (!userInteracted || level.room.music.length === 0) return;
	    audio?.pause();
	    const track = level.room.music[Math.floor(Math.random() * level.room.music.length)];
	    audio = new Audio(track);
	    audio.loop = true;
	    audio.volume = 0.4;
	    audio.muted = musicMuted();
	    audioRef.current = audio;
	    playAudio();
	  };

	  startTrack();
	  skipMusicRef.current = startTrack;
	  const unsubscribeMute = subscribeMusicMuted(() => {
	    if (!audio) return;
	    audio.muted = musicMuted();
	    if (!audio.muted) playAudio();
	  });

	  const handleVisibilityChange = () => {
	    if (document.visibilityState === "visible" && userInteracted) {
	      console.log('switch: resume playback');
	      playAudio();
	    } else {
	      console.log('switch: pause playback');
	      stopAudio();
	    }
	  };

	  document.addEventListener("visibilitychange", handleVisibilityChange);

	  return () => {
	    unsubscribeMute();
	    document.removeEventListener("visibilitychange", handleVisibilityChange);
	    stopAudio();
	    if (audioRef.current === audio) audioRef.current = null;
	  };
  }, [level, userInteracted]);



  // Main game setup and loop
  useEffect(() => {
    if (!mountRef.current) return;

    const currentLevel = toPlayLevel(level);
    const sizeTiers = currentLevel.sizeTiers;
    let disposed = false;
    finishedRef.current = false;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(currentLevel.ambientColor || "#E0E0E0");
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
      
    // Set the size of the renderer to the window size
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Adjust the pixel ratio to lower the resolution on mobile
    if (isMobileDevice) {
      renderer.setPixelRatio(window.devicePixelRatio / 2); // Adjust this value as needed
    } else {
      renderer.setPixelRatio(window.devicePixelRatio);
    }
      
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);

    // Lighting setup
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1200;
    directionalLight.shadow.mapSize.height = 1200;
    directionalLight.shadow.camera.near = 0.6;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0xffcacc, 0.3);
    scene.add(hemisphereLight);

    // Room setup
    let wallTexture;

        let wallRepeat = [2.5, 1];
        if (currentLevel.wallRepeat) {
              wallRepeat = [currentLevel.wallRepeat[0], currentLevel.wallRepeat[1]];
        }

	if (currentLevel?.wallTexture) {
	  const extension = currentLevel.wallTexture.split('.').pop()?.toLowerCase();

	  if (extension === 'mp4') {
	    const video = document.createElement('video');
	    video.src = currentLevel.wallTexture;
	    video.loop = true;
	    video.muted = true;
	    video.play();

	    wallTexture = new THREE.VideoTexture(video);
	    wallTexture.wrapS = THREE.RepeatWrapping;
	    wallTexture.wrapT = THREE.RepeatWrapping;
            wallTexture.repeat.set(wallRepeat[0], wallRepeat[1]);

	  } else {
	    wallTexture = new THREE.TextureLoader().load(currentLevel.wallTexture);
	    wallTexture.wrapS = THREE.RepeatWrapping;
	    wallTexture.wrapT = THREE.RepeatWrapping;
            wallTexture.repeat.set(wallRepeat[0], wallRepeat[1]);

	  }
	} else {
	  wallTexture = new THREE.TextureLoader().load("textures/wall_shoji.png");
	  wallTexture.wrapS = THREE.RepeatWrapping;
	  wallTexture.wrapT = THREE.RepeatWrapping;
          wallTexture.repeat.set(wallRepeat[0], wallRepeat[1]);
	}

	const roomSize = currentLevel.roomSize || 50;
	const roomGeometry = new THREE.BoxGeometry(roomSize, 20, roomSize);
	const roomMaterial = new THREE.MeshStandardMaterial({
	  map: wallTexture,
	  side: THREE.BackSide,
	  roughness: 0.8,
	  metalness: 0.0,
	});
     const room = new THREE.Mesh(roomGeometry, roomMaterial);
     room.position.y = 10;
     scene.add(room);


    // Floor setup
    const floorTexture = new THREE.TextureLoader().load(currentLevel.floorTexture || "textures/floor_carpet.jpg");
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;

    if (currentLevel.floorRepeat) {
      floorTexture.repeat.set(currentLevel.floorRepeat[0], currentLevel.floorRepeat[1]);
    } else {
      floorTexture.repeat.set(20, 20); // Default repeat values
    }

    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const floorGeometry = new THREE.PlaneGeometry(roomSize, roomSize);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    // Player setup
    const playerGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 32);
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: 0x303030,
      roughness: 0.7,
      metalness: 0.3,
    });
    const player = new THREE.Mesh(playerGeometry, playerMaterial);
    playerRef.current = player;

    // Roomba details
    const topDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.05, 32),
      new THREE.MeshStandardMaterial({ color: 0x404040 })
    );
    topDisc.position.y = 0.1;
    player.add(topDisc);

    const sensorBump = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0x202020 })
    );
    sensorBump.position.set(0, 0.15, 0.3);
    player.add(sensorBump);

    player.scale.setScalar(playerSizeRef.current * 0.25);
    player.position.y = 0.1 * player.scale.y;
    player.castShadow = true;
    player.receiveShadow = true;
    scene.add(player);

    // Collected objects container
    const collectedObjectsContainer = new THREE.Group();
    collectedObjectsRef.current = collectedObjectsContainer;
    player.add(collectedObjectsContainer);

    // Create aura material
    const auraMaterial = new THREE.ShaderMaterial({
      vertexShader: auraVertexShader,
      fragmentShader: auraFragmentShader,
      transparent: true,
      uniforms: {
        time: { value: 0 },
      },
    });

    // Load game objects
    const objects: THREE.Object3D[] = [];
    const auras: THREE.Mesh[] = [];
    const expectedSpawns = currentLevel.spawns.length;
    let spawned = 0;
    let remaining = expectedSpawns;

    const addSpawn = (model: THREE.Object3D, spawn: (typeof currentLevel.spawns)[number], nativeExtent: number) => {
      if (disposed) return;
      const group = wrapProp(model, spawn, nativeExtent, auraMaterial.clone());
      scene.add(group);
      objects.push(group);
      auras.push(group.userData.aura as THREE.Mesh);
      spawned++;
    };

    currentLevel.spawns.forEach((spawn) => {
      const asset = currentLevel.assets.find((item) => item.id === spawn.assetId);
      const fallback = () => addSpawn(createPrimitive("box", spawn.color || "#cccccc"), spawn, 1);
      if (!asset || asset.kind === "primitive") {
        addSpawn(createPrimitive(asset?.src || "box", spawn.color || "#ffcc66"), spawn, asset?.nativeExtent || 1);
        return;
      }
      const beginLoad = (url: string) => {
        loader.load(url, (gltf) => addSpawn(gltf.scene, spawn, asset.nativeExtent), undefined, fallback);
      };
      if (asset.kind === "file") {
        fileObjectUrl(asset.src).then(beginLoad).catch(fallback);
        return;
      }
      beginLoad(asset.src);
    });

    const syncGhost = currentLevel.mode === "p2p" && currentLevel.p2p?.sync.includes("ghost");
    const syncPickups = Boolean(currentLevel.p2p?.sync.includes("pickups"));
    const removeProp = (propId: string) => {
      const index = objects.findIndex((object) => object.userData.propId === propId && object.parent === scene);
      if (index < 0) return;
      scene.remove(objects[index]);
      const aura = auras[index];
      if (aura) {
        aura.visible = false;
        aura.parent?.remove(aura);
      }
    };
    if (syncGhost && currentLevel.p2p) {
      const session = currentLevel.p2p;
      import("./multiplayer/manager")
        .then(({ connectLevelRoom }) => {
          if (disposed) return;
          return connectLevelRoom(
            {
              roomId: session.roomId,
              maxPlayers: session.maxPlayers,
              syncPickups,
            },
            scene,
            {
              onPickup: (propId) => {
                if (syncPickups) removeProp(propId);
              },
              onPeers: (count) => {
                if (!disposed) setPeerCount(count);
              },
            }
          );
        })
        .then((net) => {
          if (!net) return;
          if (disposed) {
            net.cleanup();
            return;
          }
          netRef.current = net;
        })
        .catch((error) => {
          console.log("P2P room failed:", error);
        });
    }

    // Player movement properties
    const playerVelocity = new THREE.Vector3();
    const playerDirection = new THREE.Vector3(0, 0, -1);
    const rotationSpeed = 0.03;
    const acceleration = 0.003;
    const maxSpeed = 0.4;
    const friction = 0.9;
    const bounceForce = 0.4;
    const gravity = 0.01;
    const jumpForce = 0.2;
    let isGrounded = false;

    // Camera setup
    const cameraOffset = new THREE.Vector3(0, 2, 2.5);
    let cameraPitch = 0.42;
    const minZoom = currentLevel.minZoom || 2.5;
    const maxZoom = currentLevel.maxZoom || 150;
    let currentZoom = minZoom;

    camera.position.copy(player.position).add(cameraOffset);
    camera.lookAt(player.position);

    let startTime = Date.now();
    let driveDistance = 0;
    let chargeSpent = 0;
    let shownBattery = currentLevel.battery.enabled ? 100 : -1;
    let shownSecond = -1;
    const battery = currentLevel.battery;

    // Game loop
    let time = 0;
    let frameId = 0;
    const animate = () => {
      if (disposed) return;
      time += 0.016;

      if (finishedRef.current) {
        return;
      }
      frameId = requestAnimationFrame(animate);
        
      // Update time elapsed
      if (!finishedRef.current) {
        const currentTime = Date.now();
        const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
        setGameState(prev => ({ ...prev, timeElapsed: elapsedSeconds }));
      }

      // Check if all objects are captured
      if (spawned === expectedSpawns && remaining === 0 && !finishedRef.current) {
        console.log("Game Completed!", time, gameState, objects.length);
        finishedRef.current = true;
        audioRef.current?.pause();
        audioRef.current = null;
        playRandomSound([
          "music/effects/01.mp3",
          "music/effects/03.mp3",
          "music/effects/04.mp3",
          "music/effects/05.mp3",
        ]);
        setGameOver(true);
        return;
      }

      // Find the smallest remaining object
      const smallestObject = objects.reduce(
        (smallest, obj) => {
        if (obj.parent === scene && obj.userData.size < smallest.userData.size) {
          return obj;
        }
        return smallest;
      },
      { userData: { size: Infinity } }
    );

    // Update aura uniforms and visibility
    objects.forEach((object, index) => {
      if (object.parent === scene) {
        const aura = auras[index];
        if (aura) {
          const auraMaterial = aura.material;
          if (!Array.isArray(auraMaterial) && auraMaterial.uniforms?.time) {
            auraMaterial.uniforms.time.value = time;
          }
          aura.visible =
            object.userData.size <=
            Math.max(playerSizeRef.current * 1.2, smallestObject.userData.size);
        }
      }
    });

    // Keep the roomba a disc. Overlapping hits used to squash it flatter every frame.
    player.scale.setScalar(playerSizeRef.current * 0.25);

    // Wobble and drag stay off while the roomba is small. They fade in only
    // after it has grown and is carrying several objects that are large for it.
    let carried = 0;
    let momentX = 0;
    let momentZ = 0;
    const playerCm = Math.max(playerSizeRef.current, 0.05);
    if (playerCm >= 8) {
      collectedObjectsContainer.children.forEach((child) => {
        const size = Number(child.userData.size) || 0;
        const relative = size / playerCm;
        if (relative < 0.65) return;
        const weight = relative * relative;
        carried += weight;
        momentX += child.position.x * weight;
        momentZ += child.position.z * weight;
      });
    }
    const carryRadius = Math.max(player.scale.x * 0.5, 0.05);
    const imbalance = carried > 0
      ? Math.min(1, Math.hypot(momentX, momentZ) / carried / carryRadius)
      : 0;
    const load = THREE.MathUtils.smoothstep(carried, 4, 12);
    const burden = load * (0.2 + imbalance * 0.25);
    const wobbleAmount = currentLevel.handling.wobble;
    const dragAmount = currentLevel.handling.drag;
    const tilt = load * Math.min(0.14, wobbleAmount * (0.35 + imbalance) * 0.07);
    player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, Math.cos(time * 2.1) * tilt, 0.15);
    player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, Math.sin(time * 2.7) * tilt, 0.15);
    const turnSpeed = rotationSpeed * (1 - Math.min(0.35, burden * dragAmount * 0.25));

    // Player movement using keysRef
    const moveDirection = new THREE.Vector3();
    if (keysRef.current.ArrowUp) moveDirection.z -= 1;
    if (keysRef.current.ArrowDown) moveDirection.z += 1;
    
    if (keysRef.current.ArrowLeft) {
      playerDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), turnSpeed);
    }
    if (keysRef.current.ArrowRight) {
      playerDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turnSpeed);
    }
    if (load > 0 && wobbleAmount > 0 && (moveDirection.z !== 0 || keysRef.current.ArrowLeft || keysRef.current.ArrowRight)) {
      playerDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(time * 2.4) * tilt * 0.012);
    }

    const speedScale = 1 / (1 + burden * dragAmount);
    let dynamicMaxSpeed = maxSpeed * (1 + playerSizeRef.current * 0.6) * speedScale;
    const dynamicAcceleration = acceleration * (1 + playerSizeRef.current * 0.4) * speedScale;
    playerVelocity.add(
      playerDirection.clone().multiplyScalar(moveDirection.z * dynamicAcceleration)
    );

    playerVelocity.y -= gravity;

    isGrounded = player.position.y <= player.scale.y * 0.5;
    if (isGrounded) {
      player.position.y = player.scale.y * 0.5;
      playerVelocity.y = Math.max(0, playerVelocity.y);
    }

    if (keysRef.current.Space && isGrounded) {
      playerVelocity.y = jumpForce;
    }

    // Apply friction and limit speed
    playerVelocity.multiplyScalar(friction);
    
    if (isMobileDevice) { dynamicMaxSpeed = dynamicMaxSpeed * 2; }
    if (playerVelocity.length() > dynamicMaxSpeed) {
      playerVelocity.normalize().multiplyScalar(dynamicMaxSpeed);
    }

    // Calculate next position
    const nextPosition = player.position.clone().add(playerVelocity);
    const halfRoomSize = (roomSize / 2) - 0.15; // Room size minus bits
    nextPosition.x = Math.max(-halfRoomSize, Math.min(halfRoomSize, nextPosition.x));
    nextPosition.z = Math.max(-halfRoomSize, Math.min(halfRoomSize, nextPosition.z));

    // Check collisions with objects
    let collisionOccurred = false;
    objects.forEach((object, index) => {
      if (object.parent === scene) {
        const combinedRadius = player.scale.x * 0.5 + (object.userData.radius ?? object.userData.size / 2);
        const distance = Math.hypot(nextPosition.x - object.position.x, nextPosition.z - object.position.z);

        if (distance < combinedRadius) {
          if (object.userData.size <= Math.max(playerSizeRef.current * 1.2, smallestObject.userData.size)) {
            // Object collection logic
            scene.remove(object);
            if (syncPickups && object.userData.propId) {
              netRef.current?.broadcastPickup(object.userData.propId as string);
            }
            const aura = auras[index];
            if (aura) {
              aura.visible = false;
              aura.parent?.remove(aura);
            }
            remaining--;

            // Position on sphere surface
            const u = Math.random();
            const v = Math.random();
            const radius = player.scale.x * 0.5;

            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);

            const surfacePosition = new THREE.Vector3(
              radius * Math.sin(phi) * Math.cos(theta),
              radius * Math.sin(phi) * Math.sin(theta),
              radius * Math.cos(phi)
            );

            object.userData.initialPosition = {
              theta: theta,
              phi: phi,
              radius: radius,
            };

            object.position.copy(surfacePosition);
            surfacePosition.add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.05
              ).multiplyScalar(player.scale.x)
            );

            const scaleFactor = Math.min(1.2, object.userData.size / playerSizeRef.current);
            object.scale.multiplyScalar(scaleFactor * 0.8);
            collectedObjectsContainer.add(object);  

            const pickupSound = new Audio(object.userData.sound || "music/blips/0" + randoSeed(1, 9) + ".mp3");
            pickupSound.volume = 0.2;
            pickupSound.play().catch((error) => {
              console.log("Failed to play pickup sound:", error);
            });

            // Update game state
            setGameState((prev) => {
              const currentClass = sizeTiers[prev.currentClass];
              const objectsInClass = prev.collectedObjects.filter(
                (obj) => obj.size >= currentClass.min && obj.size <= currentClass.max
              );

              const allObjectsInClassCaptured =
                objectsInClass.length + 1 >= currentClass.requiredCount;

              let newPlayerSize = prev.playerSize;
              let newClass = prev.currentClass;

              if (allObjectsInClassCaptured && prev.currentClass < sizeTiers.length - 1) {
                newClass += 1;
                const nextTier = sizeTiers[newClass];
                let nextExtent = 0;
                objects.forEach((candidate) => {
                  if (candidate.parent !== scene) return;
                  const size = candidate.userData.size as number;
                  const extent = candidate.userData.extent as number;
                  if (size >= nextTier.min && size <= nextTier.max && extent > nextExtent) nextExtent = extent;
                });
                const stepped = prev.playerSize * currentLevel.growth;
                const fitted = nextExtent > 0 ? (nextExtent * 0.125) / 0.16 / 0.25 : stepped;
                newPlayerSize = stepped + Math.max(0, fitted - stepped) * 0.5;
                console.log('roomba upgraded', newPlayerSize);

                playRandomSound([
                  "music/effects/01.mp3",
                  "music/effects/03.mp3",
                  "music/effects/04.mp3",
                ]);
              }

              return {
                ...prev,
                playerSize: newPlayerSize,
                currentClass: newClass,
                collectedObjects: [
                  ...prev.collectedObjects,
                  {
                    type: "object",
                    size: object.userData.size,
                    position: surfacePosition.toArray(),
                    rotation: [0, 0, 0],
                    scale: object.scale.x,
                    model: "",
                    color: "#000",
                  },
                ],
              };
            });

            player.position.y = 0.1 * player.scale.y;

        collectedObjectsContainer.children.forEach((child: THREE.Object3D) => {
	  if (child.userData.size < playerSizeRef.current * 0.08) {
	    collectedObjectsContainer.remove(child);
	    return;
	  }
	
	  const initialPos = child.userData.initialPosition;
	  if (!initialPos) return;
	  const currentRadius = player.scale.x * 0.5;
	  const movementAngle = Math.atan2(playerVelocity.x, playerVelocity.z);
	  const rotationSpeed = playerVelocity.length() * 2;
	  const rotatedTheta = initialPos.theta + movementAngle * rotationSpeed;
	
	  child.position.set(
	    currentRadius * Math.sin(initialPos.phi) * Math.cos(rotatedTheta),
	    currentRadius * Math.sin(initialPos.phi) * Math.sin(rotatedTheta),
	    currentRadius * Math.cos(initialPos.phi)
	  );
	});



            cameraOffset.z = Math.max(2.5, player.scale.x * 3);
          } else {
            // Bounce off larger objects
            collisionOccurred = true;
            const pushDirection = nextPosition
              .clone()
              .sub(object.position)
              .normalize();
            playerVelocity.reflect(pushDirection).multiplyScalar(bounceForce);
          }
        }
      }
    });

    // Update player position
    if (!collisionOccurred) {
      player.position.copy(nextPosition);
    } else {
      player.position.add(playerVelocity);
    }

    // Ensure player stays above ground
    player.position.y = Math.max(player.scale.y * 0.5, player.position.y);

    const step = Math.hypot(playerVelocity.x, playerVelocity.z);
    driveDistance += step;
    chargeSpent += battery.idleDrain * 0.016 + step * battery.moveDrain;
    const elapsedSecondsNow = Math.floor((Date.now() - startTime) / 1000);
    reportRef.current = {
      seconds: elapsedSecondsNow,
      distance: Math.round(driveDistance * 10) / 10,
      chargeSpent: Math.round(chargeSpent * 10) / 10,
    };
    if (elapsedSecondsNow !== shownSecond) {
      shownSecond = elapsedSecondsNow;
      setMeter(reportRef.current);
    }
    if (battery.enabled && battery.charge > 0 && remaining > 0 && !finishedRef.current) {
      const percent = Math.max(0, Math.ceil((1 - chargeSpent / battery.charge) * 100));
      if (percent !== shownBattery) {
        shownBattery = percent;
        setBatteryPercent(percent);
      }
      if (chargeSpent >= battery.charge) {
        finishedRef.current = true;
        setDrained(true);
        return;
      }
    }

    // Same camera as before, with about half the pull toward the objects
    // and half the rise. The room box is still the farthest it may go.
    const zoomFactor = currentLevel.zoom ?? 2.6;
    const pickupLimit = Math.max(playerSizeRef.current * 1.2, smallestObject.userData.size);
    let focusExtent = player.scale.x;
    objects.forEach((candidate) => {
      if (candidate.parent !== scene) return;
      if (candidate.userData.size > pickupLimit) return;
      const extent = candidate.userData.extent as number;
      if (extent > focusExtent) focusExtent = extent;
    });
    const playerZoom = player.scale.x * zoomFactor;
    const objectZoom = focusExtent * zoomFactor;
    const blend = currentLevel.zoomStep;
    const targetZoom = THREE.MathUtils.clamp(
      playerZoom + Math.max(0, objectZoom - playerZoom) * blend,
      minZoom,
      maxZoom
    );

    currentZoom = THREE.MathUtils.lerp(currentZoom, targetZoom, 0.08);

    const growthRaw = Math.log2(Math.max(focusExtent, 0.16) / 0.16) / Math.log2(5);
    const growthT = Math.min(1, Math.max(0, (growthRaw - 0.1) / 0.9));
    const growth = growthT * growthT * (3 - 2 * growthT);
    const behindPitch = 0.42;
    const abovePitch = 1.05;
    const targetPitch = behindPitch + (abovePitch - behindPitch) * growth * currentLevel.pitch;
    cameraPitch = THREE.MathUtils.lerp(cameraPitch, targetPitch, 0.04);
    cameraOffset.z = Math.cos(cameraPitch) * currentZoom;
    cameraOffset.y = Math.sin(cameraPitch) * currentZoom;

    const idealOffset = cameraOffset
      .clone()
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.atan2(playerDirection.x, playerDirection.z)
      );
    const halfRoom = roomSize / 2 - 0.45;
    let fit = 1;
    const fitAxis = (origin: number, delta: number, min: number, max: number) => {
      if (Math.abs(delta) < 0.0001) return;
      const limit = delta > 0 ? (max - origin) / delta : (min - origin) / delta;
      if (limit < fit) fit = Math.max(0.05, limit);
    };
    fitAxis(player.position.x, idealOffset.x, -halfRoom, halfRoom);
    fitAxis(player.position.z, idealOffset.z, -halfRoom, halfRoom);
    fitAxis(player.position.y, idealOffset.y, 0.35, 19.55);
    idealOffset.multiplyScalar(fit);
    camera.position.lerp(player.position.clone().add(idealOffset), 0.1);
    const lookAhead = playerDirection.clone().multiplyScalar(Math.max(player.scale.x, focusExtent) * 0.25);
    camera.lookAt(player.position.clone().add(lookAhead));

    netRef.current?.broadcast({
      position: [player.position.x, player.position.y, player.position.z],
      direction: [playerDirection.x, playerDirection.y, playerDirection.z],
      size: playerSizeRef.current,
    });

    renderer.render(scene, camera);
  };

  // Handle window resize
  const onWindowResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (isMobileDevice) {
      renderer.setPixelRatio(window.devicePixelRatio / 2);
    } else {
      renderer.setPixelRatio(window.devicePixelRatio);
    }
  };
  window.addEventListener("resize", onWindowResize);

  // Start animation
  if (!finishedRef.current) frameId = requestAnimationFrame(animate);

  // Cleanup
  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    netRef.current?.cleanup();
    netRef.current = null;
    window.removeEventListener("resize", onWindowResize);
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
  };
}, [level]);

const touchpadStyles = {
  position: 'fixed' as const,
  bottom: '40px',
  right: '40px',
  width: '120px',
  height: '120px',
  backgroundColor: 'rgba(255, 255, 255, 0.4)',
  borderRadius: '50%',
  border: '3px solid rgba(255, 255, 255, 0.8)',
  zIndex: 1000,
  touchAction: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none' as const
};

const centerDotStyles = {
  width: '30px',
  height: '30px',
  backgroundColor: 'rgba(255, 255, 255, 0.8)',
  borderRadius: '50%',
  border: '2px solid rgba(255, 255, 255, 1)'
};

return (
  <>
    <div ref={mountRef} />
    <SizeIndicator size={gameState.playerSize} time={gameState.timeElapsed} battery={batteryPercent} />
    {measure && (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/75 px-3 py-2 text-sm font-bold text-white">
        Run {meter.seconds}s · drive {meter.distance.toFixed(1)} · charge {meter.chargeSpent.toFixed(1)}
      </div>
    )}
    <MusicControls onSkip={() => skipMusicRef.current()} />
    {level.mode === "p2p" && (
      <div className="fixed top-14 right-4 bg-black/70 text-white font-bold px-3 py-2 rounded">
        P2P {Math.min(peerCount + 1, level.p2p?.maxPlayers || 4)}/{level.p2p?.maxPlayers || 4}
      </div>
    )}
    <audio ref={audioRef} />
    <audio ref={blipSoundRef} />
    {(gameOver || drained) && (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-70">
        <div className="bg-white p-8 rounded-lg text-center">
          {drained ? (
            <>
              <h1 className="text-3xl font-bold mb-4">Out of charge</h1>
              <p className="text-xl mb-2">The roomba stopped before the room was clear.</p>
              <p className="text-lg">
                {meter.seconds}s · drive {meter.distance.toFixed(1)} · charge {meter.chargeSpent.toFixed(1)}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold mb-4 rainbow_text_animated"><b>Congratulations!</b></h1>
              <p className="text-xl mb-2">You vacuumed all the objects!</p>
              <p className="text-lg">
                Final size: {Math.floor(gameState.playerSize)} cm{" "}
                {Math.floor((gameState.playerSize % 1) * 10)} mm
              </p>
              <p className="text-lg">
                Time: {Math.floor(gameState.timeElapsed / 60)}m{" "}
                {gameState.timeElapsed % 60}s
              </p>
            </>
          )}
          <br />
          <button type="button" onClick={leave}>
            <span className="rainbow rainbow_text_animated text-lg">RETURN TO MENU</span>
          </button>
          {!drained && (
            <>
              <br />
              <img src="https://i.imgur.com/n1lfojs.gif" />
            </>
          )}
        </div>
      </div>
    )}

    {isMobileDevice && (
      <div
        style={touchpadStyles}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div style={centerDotStyles} />
      </div>
    )}
  </>
);
};

const refreshPage = () => {
  window.location.reload(); 
};

export default Game;
