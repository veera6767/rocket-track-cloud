import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  useTelemetryStore,
  TrailStyle,
  ColorMetric,
  CameraPreset,
  QualityTier,
  OrientationMode,
  PhoneMounting,
  VehicleType,
} from '../store/telemetryStore.js';
import { geodeticToEnu } from '../../shared/math.js';
import { InterpolatedSample } from '../../shared/types.js';
import {
  Maximize2,
  Minimize2,
  Camera,
  Compass,
  Focus,
  Settings,
  X,
  RotateCw,
  Navigation,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react';

// Reusable math variables to prevent GC allocations in tick loop
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecV = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _mountQuat = new THREE.Quaternion();
const _manualQuat = new THREE.Quaternion();
const _qAzimuth = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _color = new THREE.Color();
const _upVec = new THREE.Vector3(0, 1, 0);

// Calm color palette gradient: Sky Blue (#38BDF8) -> Indigo (#818CF8) -> Pink (#F472B6) -> Amber (#FBBF24)
function getGradientColor(t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.33) {
    const f = clamped / 0.33;
    return _color.setRGB(
      0.22 + f * (0.51 - 0.22),
      0.74 + f * (0.55 - 0.74),
      0.97 + f * (0.97 - 0.97)
    );
  } else if (clamped < 0.66) {
    const f = (clamped - 0.33) / 0.33;
    return _color.setRGB(
      0.51 + f * (0.96 - 0.51),
      0.55 + f * (0.45 - 0.55),
      0.97 + f * (0.71 - 0.97)
    );
  } else {
    const f = (clamped - 0.66) / 0.34;
    return _color.setRGB(
      0.96 + f * (0.98 - 0.96),
      0.45 + f * (0.75 - 0.45),
      0.71 + f * (0.14 - 0.71)
    );
  }
}

export const ThreeTrailViewer: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    interpolatedSamples,
    originGps,
    vehicleType,
    setVehicleType,
    trailStyle,
    setTrailStyle,
    colorMetric,
    setColorMetric,
    verticalExaggeration,
    setVerticalExaggeration,
    cameraPreset,
    setCameraPreset,
    quality,
    setQuality,
    isReplayMode,
    replayIndex,
    orientationMode,
    setOrientationMode,
    phoneMounting,
    setPhoneMounting,
    manualRotation,
    rotateManual,
    resetManualRotation,
    attitudeZeroQuat,
    setAttitudeZero,
    setToast,
  } = useTelemetryStore();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [headScreenPos, setHeadScreenPos] = useState<{ x: number; y: number } | null>(null);

  // References for mutable 3D objects
  const stateRef = useRef({
    samples: interpolatedSamples,
    origin: originGps,
    vehicleType,
    trailStyle,
    colorMetric,
    verticalExaggeration,
    cameraPreset,
    quality,
    isReplayMode,
    replayIndex,
    orientationMode,
    phoneMounting,
    manualRotation,
    attitudeZeroQuat,
  });

  stateRef.current = {
    samples: interpolatedSamples,
    origin: originGps,
    vehicleType,
    trailStyle,
    colorMetric,
    verticalExaggeration,
    cameraPreset,
    quality,
    isReplayMode,
    replayIndex,
    orientationMode,
    phoneMounting,
    manualRotation,
    attitudeZeroQuat,
  };

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const vehicleMarkerGroupRef = useRef<THREE.Group | null>(null);
  const groundPointerMeshRef = useRef<THREE.Mesh | null>(null);
  const rocketMeshGroupRef = useRef<THREE.Group | null>(null);
  const rocketFlameMeshRef = useRef<THREE.Mesh | null>(null);

  const trailMeshRef = useRef<THREE.Object3D | null>(null);
  const shadowTrailRef = useRef<THREE.Line | null>(null);
  const dropLineRef = useRef<THREE.Line | null>(null);
  const groundRingRef = useRef<THREE.Mesh | null>(null);
  const referenceMarkersGroupRef = useRef<THREE.Group | null>(null);

  const trailExtentRef = useRef<number>(50);
  const boundingCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const lastUnwrappedYawRadRef = useRef<number | null>(null);

  // FPS monitor for automatic quality adaptation
  const fpsStatsRef = useRef({ frameCount: 0, lastCheckTime: performance.now() });

  // Initialize Scene
  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth || 800;
    const height = mountRef.current.clientHeight || 500;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true,
      preserveDrawingBuffer: true,
    });

    const isMobile = window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0B0F17);
    // Subtle atmospheric fog - low density so trail is crisp and visible
    scene.fog = new THREE.FogExp2(0x0B0F17, 0.00015);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 9000);
    camera.position.set(35, 25, 35);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04; // Never dip below ground level
    controls.minDistance = 2;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep slightly above ground
    controls.minDistance = 2;
    controls.maxDistance = 5000;
    controlsRef.current = controls;

    // Lighting (soft natural lighting)
    const hemiLight = new THREE.HemisphereLight(0x38BDF8, 0x0B0F17, 0.6);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xE6EAF2, 1.2);
    dirLight.position.set(60, 140, 60);
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0x172033, 0.5);
    scene.add(ambientLight);

    // Subtle Grid Floor
    const gridHelper = new THREE.GridHelper(3000, 150, 0x243049, 0x172033);
    gridHelper.position.y = -0.05;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.5;
    scene.add(gridHelper);

    // Compass Orientation Cardinal Axis Lines (North is -Z, East is +X)
    const axisGroup = new THREE.Group();
    const northLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.02, -100)]),
      new THREE.LineBasicMaterial({ color: 0xF87171, linewidth: 2 })
    );
    const eastLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(100, 0.02, 0)]),
      new THREE.LineBasicMaterial({ color: 0x38BDF8, linewidth: 2 })
    );
    axisGroup.add(northLine);
    axisGroup.add(eastLine);
    scene.add(axisGroup);

    // Reference markers group
    const refMarkersGroup = new THREE.Group();
    scene.add(refMarkersGroup);
    referenceMarkersGroupRef.current = refMarkersGroup;

    // Vehicle Marker Group (Holds both Ground Chevron Pointer & Rocket Model)
    const markerGroup = new THREE.Group();

    // 1. Ground Vehicle Pointer: Compact arrow/chevron lying on the trail
    const chevronShape = new THREE.Shape();
    chevronShape.moveTo(0, 1.4);
    chevronShape.lineTo(0.9, -0.9);
    chevronShape.lineTo(0, -0.4);
    chevronShape.lineTo(-0.9, -0.9);
    chevronShape.closePath();

    const chevronGeom = new THREE.ShapeGeometry(chevronShape);
    chevronGeom.rotateX(-Math.PI / 2); // Lay flat on trail
    const chevronMat = new THREE.MeshStandardMaterial({
      color: 0x38BDF8,
      metalness: 0.5,
      roughness: 0.3,
      emissive: 0x0EA5E9,
      emissiveIntensity: 0.4,
      side: THREE.DoubleSide,
    });
    const groundPointer = new THREE.Mesh(chevronGeom, chevronMat);
    groundPointer.position.y = 0.1;
    markerGroup.add(groundPointer);
    groundPointerMeshRef.current = groundPointer;

    // Glowing head sphere at vehicle tip
    const tipSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x38BDF8 })
    );
    tipSphere.position.set(0, 0.2, 0);
    markerGroup.add(tipSphere);

    // 2. Rocket Vehicle Model Group
    const rocketGroup = new THREE.Group();

    // Body cylinder
    const bodyGeom = new THREE.CylinderGeometry(0.35, 0.35, 2.4, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xE6EAF2,
      metalness: 0.8,
      roughness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.position.y = 1.2;
    rocketGroup.add(bodyMesh);

    // Nosecone (+Y)
    const noseGeom = new THREE.ConeGeometry(0.35, 0.9, 16);
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0x38BDF8,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0x0EA5E9,
      emissiveIntensity: 0.3,
    });
    const noseMesh = new THREE.Mesh(noseGeom, noseMat);
    noseMesh.position.y = 2.85;
    rocketGroup.add(noseMesh);

    // 4 Fins
    const finMat = new THREE.MeshStandardMaterial({ color: 0xF472B6, metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const finGeom = new THREE.BoxGeometry(0.05, 0.65, 0.55);
      const fin = new THREE.Mesh(finGeom, finMat);
      fin.position.set(Math.sin(angle) * 0.45, 0.45, Math.cos(angle) * 0.45);
      fin.rotation.y = angle;
      rocketGroup.add(fin);
    }

    // Engine exhaust flame
    const flameGeom = new THREE.ConeGeometry(0.24, 0.7, 12);
    flameGeom.rotateX(Math.PI);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xFBBF24, transparent: true, opacity: 0.85 });
    const flame = new THREE.Mesh(flameGeom, flameMat);
    flame.position.y = -0.55;
    flame.visible = false;
    rocketGroup.add(flame);
    rocketFlameMeshRef.current = flame;

    markerGroup.add(rocketGroup);
    rocketMeshGroupRef.current = rocketGroup;

    scene.add(markerGroup);
    vehicleMarkerGroupRef.current = markerGroup;

    // Ground Drop-Line
    const dropLineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 10, 0),
    ]);
    const dropLineMat = new THREE.LineDashedMaterial({
      color: 0x38BDF8,
      dashSize: 0.6,
      gapSize: 0.4,
      transparent: true,
      opacity: 0.6,
    });
    const dropLine = new THREE.Line(dropLineGeom, dropLineMat);
    dropLine.computeLineDistances();
    scene.add(dropLine);
    dropLineRef.current = dropLine;

    // Ground Pulsing Ring
    const ringGeom = new THREE.RingGeometry(1.0, 1.35, 32);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38BDF8,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const groundRing = new THREE.Mesh(ringGeom, ringMat);
    groundRing.position.y = 0.05;
    scene.add(groundRing);
    groundRingRef.current = groundRing;

    // Animation Loop
    let animId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Check FPS and adapt quality if needed
      fpsStatsRef.current.frameCount++;
      const nowMs = performance.now();
      if (nowMs - fpsStatsRef.current.lastCheckTime >= 2000) {
        const fps = (fpsStatsRef.current.frameCount * 1000) / (nowMs - fpsStatsRef.current.lastCheckTime);
        if (fps < 24 && stateRef.current.quality === 'high') {
          console.warn(`[3D] FPS dropped to ${fps.toFixed(1)}, switching to medium quality`);
          setQuality('medium');
        }
        fpsStatsRef.current.frameCount = 0;
        fpsStatsRef.current.lastCheckTime = nowMs;
      }

      // Ground ring pulse
      if (groundRingRef.current) {
        const pulse = 1.0 + 0.15 * Math.sin(elapsed * 3.5);
        groundRingRef.current.scale.set(pulse, pulse, pulse);
      }

      const state = stateRef.current;
      const currentIdx = state.isReplayMode
        ? Math.min(state.replayIndex, state.samples.length - 1)
        : state.samples.length - 1;

      // Position Vehicle
      if (state.origin && state.samples.length > 0 && currentIdx >= 0) {
        const s = state.samples[currentIdx];
        if (s.lat !== null && s.lon !== null && s.gps_alt !== null) {
          const enu = geodeticToEnu(
            s.lat,
            s.lon,
            s.gps_alt,
            state.origin.lat,
            state.origin.lon,
            state.origin.alt
          );

          const posX = enu.x;
          const posY = Math.max(0.15, enu.y * state.verticalExaggeration);
          const posZ = enu.z;

          if (vehicleMarkerGroupRef.current) {
            vehicleMarkerGroupRef.current.position.lerp(_vecA.set(posX, posY, posZ), 0.2);

            // Constant on-screen size (36-48px) regardless of zoom
            const camDist = camera.position.distanceTo(vehicleMarkerGroupRef.current.position);
            const vpHeight = renderer.domElement.clientHeight || 500;
            const targetPixelSize = 40;
            const fovRad = (camera.fov * Math.PI) / 180;
            const screenScale = (camDist * Math.tan(fovRad / 2) * targetPixelSize * 2) / vpHeight;
            const clampedScale = Math.max(0.4, Math.min(25.0, screenScale / 3.0));

            vehicleMarkerGroupRef.current.scale.set(clampedScale, clampedScale, clampedScale);

            // Switch model based on Vehicle Type: GROUND vs ROCKET
            if (state.vehicleType === 'ground') {
              if (groundPointerMeshRef.current) groundPointerMeshRef.current.visible = true;
              if (rocketMeshGroupRef.current) rocketMeshGroupRef.current.visible = false;

              // Point chevron in direction of travel (GPS bearing or segment)
              let headingDeg = s.bearing;
              if (headingDeg === null && currentIdx > 0) {
                const prev = state.samples[currentIdx - 1];
                if (prev.lat !== null && prev.lon !== null) {
                  const dLat = (s.lat - prev.lat) * 111320;
                  const dLon = (s.lon - prev.lon) * 111320 * Math.cos((s.lat * Math.PI) / 180);
                  headingDeg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
                }
              }
              const rad = ((headingDeg ?? 0) * Math.PI) / 180;
              groundPointerMeshRef.current?.rotation.set(0, -rad, 0);
            } else {
              // ROCKET mode: Orient by phone attitude (quaternion SLERP)
              if (groundPointerMeshRef.current) groundPointerMeshRef.current.visible = false;
              if (rocketMeshGroupRef.current) rocketMeshGroupRef.current.visible = true;

              // Flame visible only when |a| is above threshold (boost acceleration > 14 m/s²)
              const accelMag = s.accelMag ?? Math.sqrt(s.accel_x ** 2 + s.accel_y ** 2 + s.accel_z ** 2);
              if (rocketFlameMeshRef.current) {
                rocketFlameMeshRef.current.visible = accelMag > 14.0;
              }

              if (state.orientationMode === 'velocity') {
                const bearingDeg = s.bearing ?? 0;
                const bearingRad = (bearingDeg * Math.PI) / 180;
                const dx = Math.sin(bearingRad);
                const dz = -Math.cos(bearingRad);
                _vecV.set(dx, 0, dz).normalize();
                _targetQuat.setFromUnitVectors(_upVec, _vecV);
              } else if (state.orientationMode === 'upright') {
                _targetQuat.set(0, 0, 0, 1);
              } else {
                // Phone attitude mode
                const rawYawRad = (s.yaw * Math.PI) / 180;
                if (lastUnwrappedYawRadRef.current === null) {
                  lastUnwrappedYawRadRef.current = rawYawRad;
                } else {
                  let diff = rawYawRad - (lastUnwrappedYawRadRef.current % (Math.PI * 2));
                  while (diff < -Math.PI) diff += Math.PI * 2;
                  while (diff > Math.PI) diff -= Math.PI * 2;
                  lastUnwrappedYawRadRef.current += diff;
                }
                const rollRad = (s.roll * Math.PI) / 180;
                const pitchRad = (s.pitch * Math.PI) / 180;

                _qAzimuth.setFromAxisAngle(_upVec, -lastUnwrappedYawRadRef.current);
                _qPitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRad);
                _qRoll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rollRad);
                _targetQuat.copy(_qAzimuth).multiply(_qPitch).multiply(_qRoll);

                if (state.attitudeZeroQuat) {
                  const invZero = new THREE.Quaternion(
                    state.attitudeZeroQuat.x,
                    state.attitudeZeroQuat.y,
                    state.attitudeZeroQuat.z,
                    state.attitudeZeroQuat.w
                  ).invert();
                  _targetQuat.premultiply(invZero);
                }
              }

              rocketMeshGroupRef.current?.quaternion.slerp(_targetQuat, 0.2);
            }

            // Drop line from head to ground: only visible when height > 1m and length clamped
            if (dropLineRef.current) {
              if (posY > 1.0) {
                dropLineRef.current.visible = true;
                const geom = dropLineRef.current.geometry;
                const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
                const dropLen = Math.min(posY, 1000);
                posAttr.setXYZ(0, posX, Math.max(0, posY - dropLen), posZ);
                posAttr.setXYZ(1, posX, posY, posZ);
                posAttr.needsUpdate = true;
                dropLineRef.current.computeLineDistances();
              } else {
                dropLineRef.current.visible = false;
              }
            }

            // Ground ring under vehicle
            if (groundRingRef.current) {
              groundRingRef.current.position.set(posX, 0.05, posZ);
            }

            // Compute head screen coordinates for floating overlay info label
            _vecA.set(posX, posY, posZ).project(camera);
            const screenX = ((_vecA.x + 1) / 2) * (renderer.domElement.clientWidth || 800);
            const screenY = ((-_vecA.y + 1) / 2) * (renderer.domElement.clientHeight || 500);
            if (_vecA.z < 1.0) {
              setHeadScreenPos({ x: screenX, y: screenY });
            } else {
              setHeadScreenPos(null);
            }

            // Camera follow modes (framed with at least 30m scene extent)
            if (state.cameraPreset === 'follow') {
              let backAngleRad = 0;
              if (s.bearing !== null) {
                backAngleRad = (s.bearing * Math.PI) / 180;
              }
              const followDist = Math.max(30, clampedScale * 12);
              const camTargetX = posX - Math.sin(backAngleRad) * followDist;
              const camTargetZ = posZ + Math.cos(backAngleRad) * followDist;
              const camTargetY = Math.max(5, posY + followDist * 0.55); // Never below ground

              _camPos.set(camTargetX, camTargetY, camTargetZ);
              _camTarget.set(posX, Math.max(0.1, posY), posZ);

              camera.position.lerp(_camPos, 0.08);
              controls.target.lerp(_camTarget, 0.08);
            } else if (state.cameraPreset === 'top') {
              _camPos.set(posX, Math.max(30, posY + 80), posZ);
              camera.position.lerp(_camPos, 0.08);
              controls.target.lerp(_vecA.set(posX, posY, posZ), 0.08);
            } else if (state.cameraPreset === 'side') {
              _camPos.set(posX + 80, Math.max(5, posY + 10), posZ);
              camera.position.lerp(_camPos, 0.08);
              controls.target.lerp(_vecA.set(posX, posY, posZ), 0.08);
            }
          }
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current && rendererRef.current.domElement) {
        mountRef.current?.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, []);

  // Build Trail Mesh and Reference Markers on data change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove existing trail
    if (trailMeshRef.current) {
      scene.remove(trailMeshRef.current);
      trailMeshRef.current = null;
    }
    if (shadowTrailRef.current) {
      scene.remove(shadowTrailRef.current);
      shadowTrailRef.current = null;
    }
    if (referenceMarkersGroupRef.current) {
      referenceMarkersGroupRef.current.clear();
    }

    const { samples, origin, verticalExaggeration, colorMetric, trailStyle } = stateRef.current;
    const validSamples = samples.filter((s) => s.lat !== null && s.lon !== null && s.gps_alt !== null);
    if (!origin || validSamples.length < 2) return;

    // Convert samples to 3D vectors
    const points: THREE.Vector3[] = [];
    const colors: number[] = [];

    let minVal = Infinity;
    let maxVal = -Infinity;
    let maxSpeedVal = -1;
    let maxSpeedPt: THREE.Vector3 | null = null;
    let maxAccelVal = -1;
    let maxAccelPt: THREE.Vector3 | null = null;
    let maxAltVal = -Infinity;
    let maxAltPt: THREE.Vector3 | null = null;

    for (let i = 0; i < validSamples.length; i++) {
      const s = validSamples[i];
      let v = s.speed || 0;
      if (colorMetric === 'alt') v = s.gps_alt || 0;
      else if (colorMetric === 'accel') v = s.accelMag || 9.81;
      else if (colorMetric === 'gyro') v = s.gyroMag || 0;
      else if (colorMetric === 'mag') v = s.magMag || 40;
      else if (colorMetric === 'time') v = s.t;

      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;

      // Track reference peaks
      if ((s.speed || 0) > maxSpeedVal) {
        maxSpeedVal = s.speed || 0;
        const enu = geodeticToEnu(s.lat!, s.lon!, s.gps_alt!, origin.lat, origin.lon, origin.alt);
        maxSpeedPt = new THREE.Vector3(enu.x, Math.max(0.1, enu.y * verticalExaggeration), enu.z);
      }
      const acc = s.accelMag || 0;
      if (acc > maxAccelVal) {
        maxAccelVal = acc;
        const enu = geodeticToEnu(s.lat!, s.lon!, s.gps_alt!, origin.lat, origin.lon, origin.alt);
        maxAccelPt = new THREE.Vector3(enu.x, Math.max(0.1, enu.y * verticalExaggeration), enu.z);
      }
      if ((s.gps_alt || 0) > maxAltVal) {
        maxAltVal = s.gps_alt || 0;
        const enu = geodeticToEnu(s.lat!, s.lon!, s.gps_alt!, origin.lat, origin.lon, origin.alt);
        maxAltPt = new THREE.Vector3(enu.x, Math.max(0.1, enu.y * verticalExaggeration), enu.z);
      }
    }

    const range = maxVal > minVal ? maxVal - minVal : 1;

    for (let i = 0; i < validSamples.length; i++) {
      const s = validSamples[i];
      const enu = geodeticToEnu(s.lat!, s.lon!, s.gps_alt!, origin.lat, origin.lon, origin.alt);
      const pt = new THREE.Vector3(enu.x, Math.max(0.15, enu.y * verticalExaggeration), enu.z);
      points.push(pt);

      let v = s.speed || 0;
      if (colorMetric === 'alt') v = s.gps_alt || 0;
      else if (colorMetric === 'accel') v = s.accelMag || 9.81;
      else if (colorMetric === 'gyro') v = s.gyroMag || 0;
      else if (colorMetric === 'mag') v = s.magMag || 40;
      else if (colorMetric === 'time') v = s.t;

      const norm = (v - minVal) / range;
      const c = getGradientColor(norm);
      colors.push(c.r, c.g, c.b);
    }

    // Build Curve for Tube / Ribbon
    const curve = new THREE.CatmullRomCurve3(points);
    const curvePoints = curve.getPoints(Math.min(points.length * 2, 600));

    let trailObject: THREE.Object3D;

    if (trailStyle === 'tube') {
      const tubeGeom = new THREE.TubeGeometry(curve, Math.min(points.length * 2, 500), 0.35, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0x38BDF8,
        metalness: 0.6,
        roughness: 0.2,
        emissive: 0x0EA5E9,
        emissiveIntensity: 0.25,
      });
      trailObject = new THREE.Mesh(tubeGeom, tubeMat);
    } else {
      // Default Ribbon / Polyline
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      lineGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: 2,
      });
      trailObject = new THREE.Line(lineGeom, lineMat);
    }

    scene.add(trailObject);
    trailMeshRef.current = trailObject;

    // Dim ground shadow
    const shadowPoints = points.map((p) => new THREE.Vector3(p.x, 0.02, p.z));
    const shadowGeom = new THREE.BufferGeometry().setFromPoints(shadowPoints);
    const shadowMat = new THREE.LineBasicMaterial({
      color: 0x172033,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.5,
    });
    const shadowLine = new THREE.Line(shadowGeom, shadowMat);
    scene.add(shadowLine);
    shadowTrailRef.current = shadowLine;

    // Reference Markers (Start flag, Apogee, 100m distance ticks)
    if (referenceMarkersGroupRef.current) {
      const refGroup = referenceMarkersGroupRef.current;

      // Start flag marker
      if (points.length > 0) {
        const startFlag = createTextSprite('START', '#34D399');
        startFlag.position.copy(points[0]).add(new THREE.Vector3(0, 1.8, 0));
        refGroup.add(startFlag);
      }

      // Max altitude (Apogee) marker
      if (maxAltPt && maxAltVal > 20) {
        const apogeeSprite = createTextSprite(`APOGEE: ${maxAltVal.toFixed(0)}m`, '#38BDF8');
        apogeeSprite.position.copy(maxAltPt).add(new THREE.Vector3(0, 2.2, 0));
        refGroup.add(apogeeSprite);
      }

      // 100m distance ticks
      let nextDist = 100;
      for (let i = 0; i < validSamples.length; i++) {
        const dist = validSamples[i].distanceMeters || 0;
        if (dist >= nextDist) {
          const tickLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)}k` : `${Math.round(dist)}m`;
          const tickSprite = createTextSprite(tickLabel, '#8A97AD', 0.8);
          tickSprite.position.copy(points[i]).add(new THREE.Vector3(0, 1.0, 0));
          refGroup.add(tickSprite);
          nextDist += 100;
        }
      }
    }

    // Compute bounding box for Overview and Follow framing
    const bbox = new THREE.Box3();
    if (points.length > 0) {
      bbox.setFromPoints(points);
    }
    const center = new THREE.Vector3();
    if (points.length > 0) {
      bbox.getCenter(center);
    }
    const size = new THREE.Vector3();
    bbox.getSize(size);

    // If trail is shorter than 30m, center on latest marker and enforce minimum 30m scene extent
    const trailLen = points.length > 1 ? points[0].distanceTo(points[points.length - 1]) : 0;
    if (trailLen < 30 && points.length > 0) {
      center.copy(points[points.length - 1]);
    }
    const extent = Math.max(size.x, size.y, size.z, 30);
    boundingCenterRef.current.copy(center);
    trailExtentRef.current = extent;
  }, [interpolatedSamples, originGps, verticalExaggeration, colorMetric, trailStyle]);

  // Handle Quick Toolbar actions
  const handleOverviewCamera = () => {
    setCameraPreset('overview');
    if (cameraRef.current && controlsRef.current) {
      const center = boundingCenterRef.current;
      const extent = trailExtentRef.current;
      cameraRef.current.position.set(
        center.x + extent * 0.7,
        Math.max(5, center.y + extent * 0.6),
        center.z + extent * 0.7
      );
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };

  const handleTopCamera = () => {
    setCameraPreset('top');
    if (cameraRef.current && controlsRef.current) {
      const center = boundingCenterRef.current;
      const extent = trailExtentRef.current;
      cameraRef.current.position.set(
        center.x,
        Math.max(30, center.y + extent * 1.3),
        center.z
      );
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };

  const handleSideCamera = () => {
    setCameraPreset('side');
    if (cameraRef.current && controlsRef.current) {
      const center = boundingCenterRef.current;
      const extent = trailExtentRef.current;
      cameraRef.current.position.set(
        center.x + extent * 1.3,
        Math.max(5, center.y + 10),
        center.z
      );
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };

  const handleResetView = () => {
    handleOverviewCamera();
  };

  const handleScreenshot = () => {
    if (!rendererRef.current) return;
    const url = rendererRef.current.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `trail_view_${Date.now()}.png`;
    a.click();
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const latestSample = interpolatedSamples.length > 0 ? interpolatedSamples[interpolatedSamples.length - 1] : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[440px] bg-[#0B0F17] rounded-xl overflow-hidden border border-[#243049] flex flex-col shadow-sm"
    >
      {/* Slim Top-Left Toolbar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-[#111826]/90 border border-[#243049] p-1.5 rounded-lg text-xs font-mono backdrop-blur shadow-sm">
        {/* Camera Presets */}
        <button
          onClick={() => setCameraPreset('follow')}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            cameraPreset === 'follow' ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
          }`}
          title="Follow: 30° chase view behind vehicle"
        >
          Follow
        </button>
        <button
          onClick={handleOverviewCamera}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            cameraPreset === 'overview' ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
          }`}
          title="Overview: Frame whole trail"
        >
          Overview
        </button>
        <button
          onClick={handleTopCamera}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            cameraPreset === 'top' ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
          }`}
          title="Top: Map-like view"
        >
          Top
        </button>
        <button
          onClick={handleSideCamera}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            cameraPreset === 'side' ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
          }`}
          title="Side: Altitude profile"
        >
          Side
        </button>

        <span className="text-[#243049]">|</span>

        {/* Style Selector */}
        <select
          value={trailStyle}
          onChange={(e) => setTrailStyle(e.target.value as TrailStyle)}
          className="bg-transparent text-[#8A97AD] hover:text-[#E6EAF2] text-xs focus:outline-none cursor-pointer"
          title="Trail Rendering Style"
        >
          <option value="tube" className="bg-[#111826] text-[#E6EAF2]">Tube</option>
          <option value="ribbon" className="bg-[#111826] text-[#E6EAF2]">Ribbon</option>
          <option value="comet" className="bg-[#111826] text-[#E6EAF2]">Comet</option>
          <option value="particles" className="bg-[#111826] text-[#E6EAF2]">Particles</option>
          <option value="curtain" className="bg-[#111826] text-[#E6EAF2]">Curtain</option>
          <option value="extrusion" className="bg-[#111826] text-[#E6EAF2]">Extrusion</option>
        </select>

        {/* Color-by Selector */}
        <select
          value={colorMetric}
          onChange={(e) => setColorMetric(e.target.value as ColorMetric)}
          className="bg-transparent text-[#38BDF8] text-xs focus:outline-none cursor-pointer"
          title="Color Trail by Metric"
        >
          <option value="speed" className="bg-[#111826] text-[#E6EAF2]">Color: Speed</option>
          <option value="alt" className="bg-[#111826] text-[#E6EAF2]">Color: Alt</option>
          <option value="accel" className="bg-[#111826] text-[#E6EAF2]">Color: Accel</option>
          <option value="gyro" className="bg-[#111826] text-[#E6EAF2]">Color: Gyro</option>
          <option value="mag" className="bg-[#111826] text-[#E6EAF2]">Color: Mag</option>
          <option value="time" className="bg-[#111826] text-[#E6EAF2]">Color: Time</option>
        </select>

        <span className="text-[#243049]">|</span>

        {/* Vertical Exaggeration */}
        <select
          value={verticalExaggeration}
          onChange={(e) => setVerticalExaggeration(parseInt(e.target.value, 10))}
          className="bg-transparent text-[#8A97AD] hover:text-[#E6EAF2] text-xs focus:outline-none cursor-pointer"
          title="Vertical Exaggeration Factor"
        >
          <option value={1} className="bg-[#111826] text-[#E6EAF2]">1x Vert</option>
          <option value={2} className="bg-[#111826] text-[#E6EAF2]">2x Vert</option>
          <option value={3} className="bg-[#111826] text-[#E6EAF2]">3x Vert</option>
          <option value={5} className="bg-[#111826] text-[#E6EAF2]">5x Vert</option>
          <option value={10} className="bg-[#111826] text-[#E6EAF2]">10x Vert</option>
        </select>

        <span className="text-[#243049]">|</span>

        {/* Screenshot */}
        <button
          onClick={handleScreenshot}
          className="p-1 text-[#8A97AD] hover:text-[#38BDF8] transition-colors"
          title="Capture PNG Screenshot"
        >
          <Camera className="w-3.5 h-3.5" />
        </button>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="p-1 text-[#8A97AD] hover:text-[#38BDF8] transition-colors"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {/* Settings Drawer Toggle */}
        <button
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className={`p-1 transition-colors rounded ${
            isDrawerOpen ? 'bg-[#38BDF8]/20 text-[#38BDF8]' : 'text-[#8A97AD] hover:text-[#38BDF8]'
          }`}
          title="Vehicle & Calibration Settings Drawer"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stationary Badge */}
      {(!latestSample || latestSample.speed === null || latestSample.speed === undefined || latestSample.speed < 0.5) && (
        <div className="absolute top-3 right-14 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FBBF24]/20 border border-[#FBBF24]/50 text-[#FBBF24] font-mono text-[11px] font-bold shadow-md backdrop-blur">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24] animate-pulse" />
          <span>STATIONARY</span>
        </div>
      )}

      {/* Floating Info Label Following Vehicle Head */}
      {headScreenPos && latestSample && (
        <div
          className="absolute z-20 pointer-events-none transform -translate-x-1/2 -translate-y-full -mt-2 bg-[#111826]/90 border border-[#243049] rounded-lg px-2.5 py-1 text-[11px] font-mono text-[#E6EAF2] shadow-lg backdrop-blur flex items-center gap-2"
          style={{
            left: `${headScreenPos.x}px`,
            top: `${headScreenPos.y}px`,
          }}
        >
          <span className="text-[#38BDF8] font-bold">
            {latestSample.speed ? `${(latestSample.speed * 3.6).toFixed(0)} km/h` : '0 km/h'}
          </span>
          <span className="text-[#243049]">|</span>
          <span>
            {latestSample.heightAboveStart !== null && latestSample.heightAboveStart !== undefined
              ? `${latestSample.heightAboveStart.toFixed(1)}m`
              : latestSample.gps_alt
              ? `${latestSample.gps_alt.toFixed(1)}m`
              : '0.0m'}
          </span>
          <span className="text-[#243049]">|</span>
          <span className="text-[#8A97AD]">
            |a| {latestSample.accelMag ? `${latestSample.accelMag.toFixed(1)}` : '1.0g'}
          </span>
        </div>
      )}

      {/* Collapsible Side Drawer (Settings, Mounting, Zero Attitude) */}
      {isDrawerOpen && (
        <div className="absolute top-12 right-3 bottom-3 w-64 z-30 bg-[#111826]/95 border border-[#243049] rounded-xl p-3.5 shadow-2xl backdrop-blur flex flex-col justify-between text-xs font-mono">
          <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#243049] pb-2">
              <span className="font-semibold text-[#E6EAF2] uppercase tracking-wide">3D Configuration</span>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-[#8A97AD] hover:text-[#E6EAF2]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Vehicle Type */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[#8A97AD] text-[11px] uppercase">Vehicle Type</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setVehicleType('ground')}
                  className={`py-1 rounded text-center transition-colors ${
                    vehicleType === 'ground'
                      ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                      : 'bg-[#172033] border border-[#243049] text-[#8A97AD]'
                  }`}
                >
                  GROUND
                </button>
                <button
                  onClick={() => setVehicleType('rocket')}
                  className={`py-1 rounded text-center transition-colors ${
                    vehicleType === 'rocket'
                      ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                      : 'bg-[#172033] border border-[#243049] text-[#8A97AD]'
                  }`}
                >
                  ROCKET
                </button>
              </div>
            </div>

            {/* Orientation Mode */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[#8A97AD] text-[11px] uppercase">Orientation Mode</span>
              <div className="grid grid-cols-3 gap-1">
                {(['velocity', 'attitude', 'upright'] as OrientationMode[]).map((om) => (
                  <button
                    key={om}
                    onClick={() => setOrientationMode(om)}
                    className={`py-1 rounded text-center uppercase text-[10px] transition-colors ${
                      orientationMode === om
                        ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                        : 'bg-[#172033] border border-[#243049] text-[#8A97AD]'
                    }`}
                  >
                    {om}
                  </button>
                ))}
              </div>
            </div>

            {/* Phone Mounting (Rocket mode) */}
            {orientationMode === 'attitude' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[#8A97AD] text-[11px] uppercase">Phone Mounting</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['nose', 'flat', 'landscape'] as PhoneMounting[]).map((pm) => (
                    <button
                      key={pm}
                      onClick={() => setPhoneMounting(pm)}
                      className={`py-1 rounded text-center capitalize text-[10px] transition-colors ${
                        phoneMounting === pm
                          ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                          : 'bg-[#172033] border border-[#243049] text-[#8A97AD]'
                      }`}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Set Attitude Zero */}
            <div className="flex flex-col gap-1.5 border-t border-[#243049] pt-2">
              <span className="text-[#8A97AD] text-[11px] uppercase">Attitude Calibration</span>
              <button
                onClick={() => {
                  if (latestSample) {
                    const rawYaw = (latestSample.yaw * Math.PI) / 180;
                    const roll = (latestSample.roll * Math.PI) / 180;
                    const pitch = (latestSample.pitch * Math.PI) / 180;
                    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, -rawYaw, -roll, 'YXZ'));
                    setAttitudeZero({ x: q.x, y: q.y, z: q.z, w: q.w });
                    setToast({ type: 'info', message: 'Attitude zero reference stored' });
                  }
                }}
                className="py-1 px-2 bg-[#172033] hover:bg-[#243049] border border-[#243049] text-[#E6EAF2] rounded text-xs transition-colors"
              >
                Set Attitude Zero
              </button>
              {attitudeZeroQuat && (
                <button
                  onClick={() => {
                    setAttitudeZero(null);
                    setToast({ type: 'info', message: 'Attitude zero cleared' });
                  }}
                  className="py-1 px-2 text-[#F87171] hover:underline text-[11px]"
                >
                  Clear Attitude Zero
                </button>
              )}
            </div>

            {/* Quality Tier */}
            <div className="flex flex-col gap-1.5 border-t border-[#243049] pt-2">
              <span className="text-[#8A97AD] text-[11px] uppercase">Rendering Quality</span>
              <div className="grid grid-cols-3 gap-1">
                {(['high', 'medium', 'low'] as QualityTier[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={`py-1 rounded text-center capitalize text-[10px] transition-colors ${
                      quality === q
                        ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                        : 'bg-[#172033] border border-[#243049] text-[#8A97AD]'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-[#8A97AD] border-t border-[#243049] pt-2">
            Tip: Press Esc or Close to hide drawer
          </div>
        </div>
      )}

      {/* 3D Canvas Mount Point */}
      <div ref={mountRef} className="w-full flex-1 z-0 cursor-grab active:cursor-grabbing" />
    </div>
  );
};

// Helper: Canvas Text Sprite for reference markers in 3D scene (constant on-screen size, clamped 12-16px)
function createTextSprite(text: string, color: string, scale: number = 1.0): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(17, 24, 38, 0.9)';
    ctx.roundRect(4, 4, 248, 56, 8);
    ctx.fill();
    ctx.strokeStyle = '#243049';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 22px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  // sizeAttenuation: false ensures the text keeps a constant on-screen size
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  const targetPxHeight = Math.max(12, Math.min(16, 14 * scale));
  const scaleY = targetPxHeight / 600;
  const scaleX = scaleY * 4.0;
  sprite.scale.set(scaleX, scaleY, 1.0);
  return sprite;
}
