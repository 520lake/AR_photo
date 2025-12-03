import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as mpHands from '@mediapipe/hands';
import * as mpDrawing from '@mediapipe/drawing_utils';
import { ExtendedMesh } from './types';

// Manual definition of connections to avoid import errors
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 13], [13, 17], [0, 17],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20]
];

// Constants
const TREE_HEIGHT = 8; // Increased reference height
const PHOTO_COUNT_LEAVES = 140; 
const PHOTO_COUNT_TRUNK = 40; 
const SPAWN_DELAY_MS = 2000;
const LERP_FACTOR = 0.08; // Smooth transition speed

// Helper to generate Polaroid-like texture
const createPolaroidTexture = (hue: number, customImage?: HTMLImageElement, isTrunk: boolean = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 300; 
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // White card background
    ctx.fillStyle = isTrunk ? '#8b5a2b' : '#f8f9fa'; 
    ctx.fillRect(0, 0, 256, 300);
    
    // Photo area
    ctx.fillStyle = '#111';
    ctx.fillRect(20, 20, 216, 216);

    if (customImage) {
      const scale = Math.max(216 / customImage.width, 216 / customImage.height);
      const x = (216 - customImage.width * scale) / 2;
      const y = (216 - customImage.height * scale) / 2;
      
      ctx.save();
      ctx.beginPath();
      ctx.rect(20, 20, 216, 216);
      ctx.clip();
      ctx.drawImage(customImage, 20 + x, 20 + y, customImage.width * scale, customImage.height * scale);
      ctx.restore();
    } else {
      const gradient = ctx.createLinearGradient(20, 20, 236, 236);
      if (isTrunk) {
         gradient.addColorStop(0, `hsl(30, 40%, ${20 + Math.random() * 20}%)`);
         gradient.addColorStop(1, `hsl(25, 50%, ${10 + Math.random() * 10}%)`);
      } else {
         gradient.addColorStop(0, `hsl(${hue * 360}, 70%, 60%)`);
         gradient.addColorStop(1, `hsl(${(hue * 360 + 40) % 360}, 70%, 40%)`);
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(20, 20, 216, 216);
    }

    // Shine effect
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(20, 20);
    ctx.lineTo(100, 20);
    ctx.lineTo(20, 100);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
};

// Helper for soft glowing snow texture
const createSnowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
};

const App: React.FC = () => {
  // DOM Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Logic Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const treeGroupRef = useRef<THREE.Group | null>(null);
  const photoGroupRef = useRef<THREE.Group | null>(null); 
  const trunkGroupRef = useRef<THREE.Group | null>(null); 
  const snowSystemRef = useRef<THREE.Points | null>(null);
  const starRef = useRef<THREE.Mesh | null>(null);
  const raycaster = useRef(new THREE.Raycaster());
  
  // Interaction State Refs
  const handsRef = useRef<any>(null);
  const grabbedObjectRef = useRef<ExtendedMesh | null>(null);
  const thumbsUpTimerRef = useRef<number>(0);
  const hasSpawnedRef = useRef<boolean>(false);
  const animationFrameIdRef = useRef<number>(0);
  
  // State for Tree Explosion
  const isExplodedRef = useRef<boolean>(false);
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [gestureStatus, setGestureStatus] = useState<string>("Initializing...");
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

  // --- THREE.JS INITIALIZATION ---
  const initThree = useCallback(() => {
    if (!canvas3dRef.current || !containerRef.current) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Scene
    const scene = new THREE.Scene();
    // Darker fog for depth
    scene.fog = new THREE.FogExp2(0x050505, 0.02);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    // Adjusted camera position to see the taller tree
    camera.position.set(0, 3, 9);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas3dRef.current,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffeebb, 1);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    // Main Group
    const treeGroup = new THREE.Group();
    treeGroup.position.y = -3; // Move down slightly to fit the taller tree
    scene.add(treeGroup);
    treeGroupRef.current = treeGroup;

    // 1. Trunk (Made of Photos)
    const trunkGroup = new THREE.Group();
    treeGroup.add(trunkGroup);
    trunkGroupRef.current = trunkGroup;

    for (let i = 0; i < PHOTO_COUNT_TRUNK; i++) {
        const h = 2.0; // Trunk height slightly taller
        const y = 1.0 + (Math.random() - 0.5) * h;
        const angle = Math.random() * Math.PI * 2;
        const r = 0.3 + Math.random() * 0.15; 
        
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        
        const pos = new THREE.Vector3(x, y, z);
        const mesh = createPhotoMesh(pos, trunkGroup, 0, undefined, true);
        
        // Scale trunk photos smaller
        mesh.userData.originalScale.set(0.3, 0.3, 0.3);
        mesh.scale.set(0.3, 0.3, 0.3);
        
        // Look outward
        mesh.lookAt(new THREE.Vector3(0, y, 0));
        mesh.userData.originalRotation = mesh.quaternion.clone();

        // Calculate Wall Position (Bottom row of wall)
        const wallX = (i / PHOTO_COUNT_TRUNK - 0.5) * 10;
        mesh.userData.wallPosition = new THREE.Vector3(wallX, -1, -5 + Math.random());
        const dummy = new THREE.Object3D();
        dummy.position.copy(mesh.userData.wallPosition);
        dummy.lookAt(camera.position);
        mesh.userData.wallRotation = dummy.quaternion.clone();
    }

    // 2. Star on Top
    const starShape = new THREE.OctahedronGeometry(0.3, 0);
    const starMat = new THREE.MeshStandardMaterial({ 
      color: 0xffd700, 
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.9
    });
    const star = new THREE.Mesh(starShape, starMat);
    // Move star way up for taller tree
    star.position.y = 8.8;
    treeGroup.add(star);
    starRef.current = star;

    // 3. Photos Container (The Tree Leaves)
    const photoGroup = new THREE.Group();
    treeGroup.add(photoGroup);
    photoGroupRef.current = photoGroup;

    // Create Initial Photos
    for (let i = 0; i < PHOTO_COUNT_LEAVES; i++) {
      spawnPhotoOnTree(i, PHOTO_COUNT_LEAVES, photoGroup);
    }

    // --- Snow System ---
    const snowGeo = new THREE.BufferGeometry();
    const snowCount = 1000;
    const positions = new Float32Array(snowCount * 3);
    const velocities = [];
    
    for (let i = 0; i < snowCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20; // x spread
      positions[i * 3 + 1] = Math.random() * 20;     // y spread higher
      positions[i * 3 + 2] = (Math.random() - 0.5) * 15; // z spread
      velocities.push({
        y: - (Math.random() * 0.02 + 0.02), // fall speed
        x: (Math.random() - 0.5) * 0.01,    // wind x
        z: (Math.random() - 0.5) * 0.01,    // wind z
        swaySpeed: 0.5 + Math.random() * 1.5,
        swayOffset: Math.random() * Math.PI * 2
      });
    }
    
    snowGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const snowTexture = createSnowTexture();
    const snowMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.25,
      map: snowTexture,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    
    const snowSystem = new THREE.Points(snowGeo, snowMat);
    (snowSystem as any).userData = { velocities };
    scene.add(snowSystem);
    snowSystemRef.current = snowSystem;

    // Resize Handler
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
      if (canvas2dRef.current && videoRef.current) {
         canvas2dRef.current.width = window.innerWidth;
         canvas2dRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- HELPER: Random Position on Tree Surface ---
  const getRandomTreePosition = () => {
     // Avoid extreme bottom (0.0) and very top (1.0) for aesthetics
     const ratio = 0.1 + Math.random() * 0.8; 
     const height = 7.0;
     const yBase = 1.5;
     
     const y = yBase + ratio * height;
     const maxRadius = 3.0;
     const radius = maxRadius * (1 - ratio);
     
     const angle = Math.random() * Math.PI * 2;
     const x = Math.cos(angle) * radius;
     const z = Math.sin(angle) * radius;
     
     return {
       position: new THREE.Vector3(x, y, z),
       ratio: ratio
     };
  };

  // --- HELPER: Spawn Photo ---
  const spawnPhotoOnTree = (index: number, total: number, group: THREE.Group) => {
    // Spiral distribution (Phyllotaxis ish)
    const ratio = index / total; // 0 (bottom) to 1 (top)
    
    // Shape Control
    const height = 7.0; // Increased height
    const yBase = 1.5;
    const y = yBase + ratio * height;
    
    // Cone Radius: Wide at bottom, narrow at top
    const maxRadius = 3.0; // Slightly wider base
    const radius = maxRadius * (1 - ratio);
    
    // Golden Angle spiral for natural distribution
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const angle = index * goldenAngle; 

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    
    // Add jitter
    const pos = new THREE.Vector3(x + (Math.random()-0.5)*0.2, y, z + (Math.random()-0.5)*0.2);

    const mesh = createPhotoMesh(pos, group, ratio);
    
    // SCALE LOGIC: Bottom photos larger, Top photos smaller
    const scaleBase = 1.0 - (ratio * 0.6); // 1.0 at bottom -> 0.4 at top
    const s = scaleBase * (0.8 + Math.random() * 0.4); // Add randomness
    mesh.scale.set(s, s, s);
    mesh.userData.originalScale.set(s, s, s);

    // Rotation: Face slightly upwards and outwards
    mesh.lookAt(new THREE.Vector3(0, y, 0)); 
    // Add z-tilt
    mesh.rotateZ((Math.random() - 0.5) * 0.4);
    mesh.userData.originalRotation = mesh.quaternion.clone();

    // --- WALL CALCULATION ---
    const cols = 12;
    const col = index % cols;
    const row = Math.floor(index / cols);
    
    const wx = (col - cols/2) * 1.2; 
    const wy = row * 1.0 - 1; 
    // Curve it around viewer
    const wz = -4 + Math.abs(wx) * 0.3; 
    
    mesh.userData.wallPosition = new THREE.Vector3(wx, wy, wz);
    
    // Make wall photos look at camera
    const dummy = new THREE.Object3D();
    dummy.position.copy(mesh.userData.wallPosition);
    dummy.lookAt(new THREE.Vector3(0, 2, 8)); // Look roughly at camera
    mesh.userData.wallRotation = dummy.quaternion.clone();
  };

  const createPhotoMesh = (
    position: THREE.Vector3, 
    parent: THREE.Object3D, 
    hueFactor: number = Math.random(),
    customImg?: HTMLImageElement,
    isTrunk: boolean = false
  ) => {
    // Polaroid Size
    const geometry = new THREE.PlaneGeometry(0.8, 0.94); 
    const texture = createPolaroidTexture(hueFactor, customImg, isTrunk);
    const material = new THREE.MeshStandardMaterial({ 
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.1,
    });
    
    const mesh = new THREE.Mesh(geometry, material) as unknown as ExtendedMesh;
    mesh.position.copy(position);
    
    // Store original state
    mesh.userData = {
      originalPosition: position.clone(),
      originalRotation: new THREE.Quaternion(), // Set by caller
      originalScale: new THREE.Vector3(1, 1, 1),
      
      // Default Wall targets (updated by spawner)
      wallPosition: position.clone(),
      wallRotation: new THREE.Quaternion(),
      
      velocity: new THREE.Vector3(),
      isGrabbed: false,
      id: Math.random().toString(36).substr(2, 9),
      isTrunk: isTrunk,
      isCustom: !!customImg // Initialize
    };

    parent.add(mesh);
    return mesh;
  };

  // --- UPLOAD HANDLING ---
  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Iterate through all selected files
      Array.from(files).forEach((file: any) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            replacePhotoWithCustom(img);
          };
          if (typeof event.target?.result === 'string') {
            img.src = event.target.result;
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  // REPLACEMENT LOGIC
  const replacePhotoWithCustom = (img: HTMLImageElement) => {
    if (!photoGroupRef.current) return;

    const allPhotos = photoGroupRef.current.children as ExtendedMesh[];
    // Prioritize non-custom photos to fill empty slots first
    const available = allPhotos.filter(p => !p.userData.isCustom);
    
    let targetMesh: ExtendedMesh;
    
    if (available.length > 0) {
        // Pick random available
        targetMesh = available[Math.floor(Math.random() * available.length)];
    } else {
        // Overwrite random existing if all are full
        targetMesh = allPhotos[Math.floor(Math.random() * allPhotos.length)];
    }

    if (!targetMesh) return;

    // Create new texture
    const newTex = createPolaroidTexture(0, img, false);
    
    // Dispose old texture
    if (targetMesh.material instanceof THREE.MeshStandardMaterial && targetMesh.material.map) {
        targetMesh.material.map.dispose();
    }

    // Apply new texture
    if (targetMesh.material instanceof THREE.MeshStandardMaterial) {
        targetMesh.material.map = newTex;
        targetMesh.material.needsUpdate = true;
        
        // Visual Feedback: Flash white
        targetMesh.material.emissive.setHex(0xffffff);
        setTimeout(() => {
             if (targetMesh.material instanceof THREE.MeshStandardMaterial) {
                 targetMesh.material.emissive.setHex(0x000000);
             }
        }, 800);
    }
    
    targetMesh.userData.isCustom = true;
    
    // Animation Pop: Scale up momentarily (loop will lerp it back)
    targetMesh.scale.multiplyScalar(2.0);
  };

  const toggleMusic = () => {
    if (audioRef.current) {
      if (isMusicPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.log("Audio autoplay prevented", e));
      }
      setIsMusicPlaying(!isMusicPlaying);
    }
  };

  // --- ANIMATION LOOP ---
  useEffect(() => {
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const isExploded = isExplodedRef.current;
      const time = Date.now() * 0.001;

      // Helper to update a mesh
      const updateMesh = (mesh: ExtendedMesh) => {
        if (!mesh.userData) return;
        
        if (mesh.userData.isGrabbed) {
          // Handled by gesture logic
          return;
        }

        // Determine Target based on State
        const targetPos = isExploded ? mesh.userData.wallPosition : mesh.userData.originalPosition;
        const targetRot = isExploded ? mesh.userData.wallRotation : mesh.userData.originalRotation;
        
        // Lerp Movement
        mesh.position.lerp(targetPos, LERP_FACTOR);
        mesh.quaternion.slerp(targetRot, LERP_FACTOR);
        mesh.scale.lerp(mesh.userData.originalScale, LERP_FACTOR);
      };

      // Update Leaf Photos
      if (photoGroupRef.current) {
        photoGroupRef.current.children.forEach((child) => updateMesh(child as ExtendedMesh));
      }

      // Update Trunk Photos
      if (trunkGroupRef.current) {
         trunkGroupRef.current.children.forEach((child) => updateMesh(child as ExtendedMesh));
      }

      // Auto-rotate tree ONLY if NOT exploded
      if (treeGroupRef.current) {
        if (!isExploded) {
          treeGroupRef.current.rotation.y += 0.003;
        } else {
          // Slerp rotation to 0 for a flat wall view
          treeGroupRef.current.rotation.y = THREE.MathUtils.lerp(treeGroupRef.current.rotation.y, 0, 0.05);
        }
      }

      // Snow & Star Animation
      if (snowSystemRef.current) {
        const positions = snowSystemRef.current.geometry.attributes.position.array as Float32Array;
        const velocities = (snowSystemRef.current as any).userData.velocities;
        
        for (let i = 0; i < velocities.length; i++) {
          const v = velocities[i];
          // Sway logic: sin/cos based on time and random offset
          const swayX = Math.sin(time * v.swaySpeed + v.swayOffset) * 0.01;
          const swayZ = Math.cos(time * v.swaySpeed + v.swayOffset) * 0.01;
          
          positions[i*3] += v.x + swayX;
          positions[i*3+1] += v.y; // Falling down
          positions[i*3+2] += v.z + swayZ;
          
          // Reset if below floor
          if (positions[i*3+1] < -3) { // Lower floor reset
            positions[i*3+1] = 15; // Start higher up
            positions[i*3] = (Math.random() - 0.5) * 20;
            positions[i*3+2] = (Math.random() - 0.5) * 15;
          }
        }
        snowSystemRef.current.geometry.attributes.position.needsUpdate = true;
      }

      if (starRef.current) {
        starRef.current.rotation.y -= 0.02;
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    
    animate();
    return () => cancelAnimationFrame(animationId);
  }, []);


  // --- MEDIAPIPE LOGIC ---
  useEffect(() => {
    const videoElement = videoRef.current;
    const canvasElement = canvas2dRef.current;
    if (!videoElement || !canvasElement) return;

    const canvasCtx = canvasElement.getContext('2d');
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;

    const HandsClass = (mpHands as any).Hands || (mpHands as any).default?.Hands || (mpHands as any).default;
    const drawConnectorsFn = (mpDrawing as any).drawConnectors || (mpDrawing as any).default?.drawConnectors;
    const drawLandmarksFn = (mpDrawing as any).drawLandmarks || (mpDrawing as any).default?.drawLandmarks;

    if (!HandsClass) {
      setGestureStatus("Error loading MediaPipe");
      return;
    }

    const onResults = (results: any) => {
      if (!canvasCtx) return;

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      
      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
          if (drawConnectorsFn) {
            drawConnectorsFn(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
          }
          if (drawLandmarksFn) {
            drawLandmarksFn(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
          }
        }
      }
      canvasCtx.restore();

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        processGestures(results.multiHandLandmarks[0]);
        setLoading(false);
      } else {
        // No Hands: Reset States
        releaseGrab();
        setGestureStatus("Waiting for hands...");
        // If hand leaves, tree comes back together
        isExplodedRef.current = false;
      }
    };

    const hands = new HandsClass({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    const processVideo = async () => {
      if (videoElement && videoElement.readyState >= 2 && handsRef.current) {
        await handsRef.current.send({ image: videoElement });
      }
      animationFrameIdRef.current = requestAnimationFrame(processVideo);
    };

    const startCamera = async () => {
      const constraints = {
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (videoElement) {
            videoElement.srcObject = stream;
            videoElement.onloadeddata = () => {
              videoElement.play();
              processVideo();
            };
          }
        } catch (err) {
          console.error("Error accessing camera:", err);
          setGestureStatus("Camera Error");
        }
      }
    };

    startCamera();
    const cleanupThree = initThree();

    return () => {
      if (videoElement && videoElement.srcObject) {
         const tracks = (videoElement.srcObject as MediaStream).getTracks();
         tracks.forEach(track => track.stop());
      }
      cancelAnimationFrame(animationFrameIdRef.current);
      if (handsRef.current) handsRef.current.close();
      if (cleanupThree) cleanupThree();
    };
  }, [initThree]);


  // --- GESTURE PROCESSING ---
  const processGestures = (landmarks: any[]) => {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    const wrist = landmarks[0];
    const indexMCP = landmarks[5];

    // Distances
    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    const isPinching = pinchDist < 0.05;

    // Thumbs Up
    const isThumbsUp = thumbTip.y < indexMCP.y && 
                       middleTip.y > indexMCP.y && 
                       ringTip.y > indexMCP.y &&
                       pinkyTip.y > indexMCP.y &&
                       !isPinching;

    // Open Palm (All fingers extended roughly upwards/outwards)
    const isOpenPalm = !isPinching && !isThumbsUp && 
                       middleTip.y < wrist.y && 
                       ringTip.y < wrist.y && 
                       pinkyTip.y < wrist.y;

    if (isPinching) {
      setGestureStatus("GRABBING");
      handleGrab(indexTip);
      thumbsUpTimerRef.current = 0;
      hasSpawnedRef.current = false;
      // Do NOT set isExploded here, let it persist or reset?
      // Usually grabbing happens on the tree. Let's enforce tree mode if pinching.
      isExplodedRef.current = false; 
    } 
    else if (isThumbsUp) {
      setGestureStatus("Spawning...");
      releaseGrab();
      isExplodedRef.current = false; // Form tree to receive photo
      
      if (!hasSpawnedRef.current) {
        thumbsUpTimerRef.current += 100;
        if (thumbsUpTimerRef.current > SPAWN_DELAY_MS) {
          handleSpawn(thumbTip);
          hasSpawnedRef.current = true;
          setGestureStatus("SPAWNED!");
        }
      }
    }
    else if (isOpenPalm) {
      setGestureStatus("SCATTERING!");
      releaseGrab();
      thumbsUpTimerRef.current = 0;
      hasSpawnedRef.current = false;
      isExplodedRef.current = true; // TRIGGER EXPLOSION
    } 
    else {
      setGestureStatus("Idle (Make a Tree)");
      releaseGrab();
      thumbsUpTimerRef.current = 0;
      hasSpawnedRef.current = false;
      isExplodedRef.current = false; // RESET TO TREE
    }
  };

  // --- ACTIONS ---
  const handleGrab = (indexTip: {x: number, y: number}) => {
    if (!cameraRef.current || !photoGroupRef.current) return;
    
    // Correct for mirror: NDC x = (1 - x)*2 - 1
    const ndcX = (1 - indexTip.x) * 2 - 1; 
    const ndcY = -(indexTip.y * 2) + 1;

    if (grabbedObjectRef.current) {
      const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
      vector.unproject(cameraRef.current);
      const dir = vector.sub(cameraRef.current.position).normalize();
      const pos = cameraRef.current.position.clone().add(dir.multiplyScalar(4));
      
      if (grabbedObjectRef.current.parent) {
         grabbedObjectRef.current.parent.worldToLocal(pos);
         grabbedObjectRef.current.position.copy(pos);
      }
      
      grabbedObjectRef.current.rotation.set(0, 0, 0); 
      grabbedObjectRef.current.scale.set(1.5, 1.5, 1.5);
      return;
    }

    raycaster.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);
    
    // Check both groups
    const leaves = photoGroupRef.current.children;
    const trunk = trunkGroupRef.current ? trunkGroupRef.current.children : [];
    const allPhotos = [...leaves, ...trunk];

    const intersects = raycaster.current.intersectObjects(allPhotos);

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object as ExtendedMesh;
      grabbedObjectRef.current = hitMesh;
      hitMesh.userData.isGrabbed = true;
    }
  };

  const releaseGrab = () => {
    if (grabbedObjectRef.current) {
      grabbedObjectRef.current.userData.isGrabbed = false;
      grabbedObjectRef.current = null;
    }
  };

  const handleSpawn = (thumbTip: {x: number, y: number}) => {
    if (!photoGroupRef.current || !cameraRef.current) return;

    // Calculate spawning position relative to hand for initial appearance
    const ndcX = (1 - thumbTip.x) * 2 - 1;
    const ndcY = -(thumbTip.y * 2) + 1;
    
    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(cameraRef.current);
    const dir = vector.sub(cameraRef.current.position).normalize();
    const spawnPos = cameraRef.current.position.clone().add(dir.multiplyScalar(3));
    photoGroupRef.current.worldToLocal(spawnPos);

    const mesh = createPhotoMesh(spawnPos, photoGroupRef.current);
    
    // Calculate final resting place on the tree
    const { position: targetPos, ratio } = getRandomTreePosition();
    mesh.userData.originalPosition = targetPos.clone();
    
    // Scale logic
    const scaleBase = 1.0 - (ratio * 0.6);
    const s = scaleBase * 1.5; 
    mesh.scale.set(0.1, 0.1, 0.1); 
    mesh.userData.originalScale.set(s, s, s);

    // Orient
    mesh.lookAt(new THREE.Vector3(0, targetPos.y, 0));
    mesh.userData.originalRotation = mesh.quaternion.clone();

    // Wall logic
    mesh.userData.wallPosition = new THREE.Vector3((Math.random()-0.5)*12, (Math.random()-0.5)*6, -4 + Math.random());
    const dummy = new THREE.Object3D();
    dummy.position.copy(mesh.userData.wallPosition);
    dummy.lookAt(new THREE.Vector3(0, 0, 10));
    mesh.userData.wallRotation = dummy.quaternion.clone();

    // Flash effect
    (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xffffff);
    setTimeout(() => {
       (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    }, 500);
  };

  return (
    <div ref={containerRef} className="relative w-screen h-screen overflow-hidden bg-gray-900 touch-none">
      <video
        ref={videoRef}
        className="absolute top-0 left-0 w-full h-full object-cover mirror-x opacity-60"
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={canvas2dRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none mirror-x z-10"
      />
      <canvas
        ref={canvas3dRef}
        className="absolute top-0 left-0 w-full h-full z-20"
      />

      {/* Audio Element: Using a royalty free placeholder url. Replace 'love_you_so.mp3' if you have the file locally */}
      <audio ref={audioRef} loop src="https://cdn.pixabay.com/download/audio/2022/11/22/audio_febc508520.mp3?filename=christmas-magic-126447.mp3" />

      <div className="absolute top-4 left-4 z-50 bg-black/40 text-white p-4 rounded-lg backdrop-blur-md max-w-sm border border-white/10 shadow-xl pointer-events-auto">
        <h1 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-yellow-300">
          🎄 AR Photo Tree
        </h1>
        {loading ? (
          <div className="flex items-center gap-2 text-yellow-200">
            <div className="animate-spin text-xl">❄️</div>
            <span>Warming up magic...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <p className="font-mono text-sm text-green-200">
                {gestureStatus}
              </p>
            </div>
            
            <div className="grid grid-cols-1 gap-2 text-xs text-gray-200 bg-white/5 p-3 rounded-md">
               <div className="flex items-center gap-2">
                <span className="text-xl">✋</span> 
                <span><strong>Open Palm:</strong> SCATTER Wall!</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl">👌</span> 
                <span><strong>Pinch:</strong> Grab Photo</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl">👍</span> 
                <span><strong>Hold Thumbs Up:</strong> Spawn</span>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 space-y-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                accept="image/*" 
                multiple
                onChange={handleFileChange} 
                className="hidden" 
              />
              <button 
                onClick={handleUploadClick}
                className="w-full py-2 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-md text-sm font-semibold shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                <span>📷</span> Replace Photos
              </button>

              <button 
                onClick={toggleMusic}
                className={`w-full py-2 text-white rounded-md text-sm font-semibold shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2 border border-white/20 ${isMusicPlaying ? 'bg-green-600' : 'bg-gray-700'}`}
              >
                <span>{isMusicPlaying ? '🔊' : '🔇'}</span> {isMusicPlaying ? 'Music ON' : 'Music OFF'}
              </button>
            </div>
          </div>
        )}
      </div>
      
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-0"></div>
    </div>
  );
};

export default App;