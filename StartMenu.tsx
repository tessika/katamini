import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Howl } from 'howler';
import { MusicControls } from './components/music-controls';
import { musicMuted, subscribeMusicMuted } from './lib/music-pref';

interface MenuLevel {
  id: string;
  name: string;
}

interface StartMenuProps {
  levels: MenuLevel[];
  onSelectLevel: (levelId: string) => void;
  onEdit: () => void;
}

const StartMenu: React.FC<StartMenuProps> = ({ levels, onSelectLevel, onEdit }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<Howl | null>(null);
  const skipMusicRef = useRef<() => void>(() => {});
  const selectedRef = useRef(0);
  const onSelectRef = useRef(onSelectLevel);
  onSelectRef.current = onSelectLevel;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || levels.length === 0) return;

    selectedRef.current = Math.min(selectedRef.current, levels.length - 1);

    const menuMusicFiles = [
      "music/katamenu_01.mp3",
      "music/katamenu_02.mp3",
      "music/katamenu_03.mp3",
    ];
    const startTrack = () => {
      audioRef.current?.stop();
      const audio = new Howl({
        src: [menuMusicFiles[Math.floor(Math.random() * menuMusicFiles.length)]],
        loop: true,
        volume: 0.1,
        mute: musicMuted(),
      });
      audio.play();
      audioRef.current = audio;
    };
    startTrack();
    skipMusicRef.current = startTrack;
    const unsubscribeMute = subscribeMusicMuted(() => {
      audioRef.current?.mute(musicMuted());
    });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        audioRef.current?.pause();
      } else {
        audioRef.current?.play();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const backgroundGeometry = new THREE.PlaneGeometry(100, 100);
    const backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec2 resolution;
        varying vec2 vUv;

        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        vec3 starfield(vec2 uv) {
          float rotation = time * 0.05;
          vec2 center = vec2(0.5);
          vec2 rotatedUv = center + mat2(
            cos(rotation), -sin(rotation),
            sin(rotation), cos(rotation)
          ) * (uv - center);
          
          vec3 col = vec3(0.0);
          col = vec3(0.1, 0.0, 0.2);
          float noise = random(rotatedUv + time * 0.1);
          col += vec3(0.2, 0.0, 0.3) * noise;
          float stars = step(0.98, random(floor(rotatedUv * 1000.0)));
          col += vec3(1.0) * stars;
          return col;
        }

        void main() {
          vec2 uv = vUv;
          vec3 color = starfield(uv);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
    const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
    background.position.z = -20;
    scene.add(background);

    const levelGroup = new THREE.Group();
    scene.add(levelGroup);

    const frameGeometry = new THREE.CircleGeometry(1.2, 32);
    const levelGeometry = new THREE.CircleGeometry(1, 32);
    const planets: THREE.Group[] = [];
    const rowY = 0.4;
    const gap = 3.4;
    const count = levels.length;
    const rowWidth = Math.max(0, count - 1) * gap;

    levels.forEach((level, index) => {
      const planetGroup = new THREE.Group();
      planetGroup.userData.levelIndex = index;
      planetGroup.userData.levelId = level.id;

      const frameMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const frame = new THREE.Mesh(frameGeometry, frameMaterial);
      planetGroup.add(frame);

      const levelMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(index * 0.2, 0.7, 0.5)
      });
      const levelMesh = new THREE.Mesh(levelGeometry, levelMaterial);
      planetGroup.add(levelMesh);

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = 256;
        canvas.height = 64;
        context.font = 'Bold 32px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.fillText(level.name, 128, 32);
        const texture = new THREE.CanvasTexture(canvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: texture });
        const label = new THREE.Sprite(labelMaterial);
        label.scale.set(2, 0.5, 1);
        label.position.y = -1.5;
        planetGroup.add(label);
      }

      const x = count === 1 ? 0 : -rowWidth / 2 + index * gap;
      planetGroup.position.set(x, rowY, 0);
      levelGroup.add(planetGroup);
      planets.push(planetGroup);
    });

    const halfFov = (camera.fov * Math.PI) / 360;
    const fitDistance = (rowWidth / 2 + 2.4) / Math.tan(halfFov);
    camera.position.set(0, rowY, Math.max(10, fitDistance));

    let frame = 0;
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);

      backgroundMaterial.uniforms.time.value = time * 0.001;

      const selected = selectedRef.current;
      planets.forEach((planet, index) => {
        const targetScale = index === selected ? 1.2 : 1.0;
        planet.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
        planet.position.y = rowY;
      });

      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);

    const blip = () => {
      const sounds = [
        "music/effects/01.mp3",
        "music/effects/03.mp3",
        "music/effects/04.mp3",
        "music/effects/05.mp3",
      ];
      const sound = new Howl({
        src: [sounds[Math.floor(Math.random() * sounds.length)]],
        volume: 0.2,
      });
      sound.play();
    };

    const startSelected = () => {
      const level = levels[selectedRef.current];
      if (!level) return;
      audioRef.current?.stop();
      onSelectRef.current(level.id);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Backspace") {
        event.preventDefault();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      if (event.repeat && (event.key === "Enter" || event.key === " ")) return;
      blip();
      if (event.key === "ArrowLeft") {
        selectedRef.current = (selectedRef.current - 1 + levels.length) % levels.length;
      } else if (event.key === "ArrowRight") {
        selectedRef.current = (selectedRef.current + 1) % levels.length;
      } else {
        startSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(planets, true);
      if (!hits.length) return;
      let node: THREE.Object3D | null = hits[0].object;
      while (node && node.userData.levelId == null) node = node.parent;
      if (!node || typeof node.userData.levelId !== "string") return;
      selectedRef.current = node.userData.levelIndex as number;
      blip();
      audioRef.current?.stop();
      onSelectRef.current(node.userData.levelId);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      backgroundMaterial.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribeMute();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.dispose();
      renderer.domElement.remove();
      audioRef.current?.stop();
      audioRef.current = null;
    };
  }, [levels]);

  const logoStyle = {
    maxWidth: '40%',
    marginTop: '10px',
  }

  const instructionsStyle = {
    color: 'white',
    fontSize: '1.5rem',
    textAlign: 'center' as const,
    textShadow: '0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(255,255,255,0.3)',
    marginTop: '20px',
  };

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" />
      <MusicControls onSkip={() => skipMusicRef.current()} />
      <div className="absolute top-0 left-0 right-0 flex justify-center mt-8">
        <img className="justify-center logomenu" src="logo.png" style={logoStyle} />
        <br />
        <h1 className="text-6xl font-bold text-white text-center rainbow_text_animated" 
            style={{
              textShadow: '0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(255,255,255,0.3)',
              marginTop: '10px'
            }}> beta
        </h1>
      </div>
      <div className="absolute bottom-0 left-0 right-0 mb-8" style={instructionsStyle}>
        <p>⬅️ + ➡️ to choose a level</p>
        <p>ENTER, SPACE, or click to play</p>
        <p>ESC or BACKSPACE to exit a level</p>
      </div>
      <button
        onClick={(event) => {
          event.preventDefault();
          onEdit();
        }}
        className="absolute bottom-4 left-4 px-4 h-16 rounded-full bg-white/90 hover:bg-white text-black text-xl font-bold"
      >
        Edit
      </button>
      <button 
        onClick={(e) => {
          e.preventDefault();
          window.open("https://github.com/katamini", "_blank");
        }}
        className="absolute bottom-4 right-4 w-16 h-16 rounded-full bg-pink-500 hover:bg-pink-600 flex items-center justify-center text-white text-2xl font-bold"
      >
        ?
      </button>
    </div>
  );
};

export default StartMenu;
