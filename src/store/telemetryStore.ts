import { create } from 'zustand';
import { Sample, InterpolatedSample, SessionRecord, WsServerMessage, SessionStats } from '../../shared/types.js';
import {
  interpolateGpsSamples,
  haversineDistance,
  calculateStartGpsAltitude,
  inferSeqStep,
  deriveSessionStats,
} from '../../shared/math.js';
import { audioManager } from '../utils/audio.js';

export { deriveSessionStats };

export type VehicleType = 'ground' | 'rocket';
export type TrailStyle = 'ribbon' | 'tube' | 'comet' | 'particles' | 'curtain' | 'extrusion';
export type ColorMetric = 'accel' | 'gyro' | 'mag' | 'speed' | 'alt' | 'time';
export type XAxisType = 'lat' | 'lon' | 'time' | 'distance';
export type CameraPreset = 'follow' | 'overview' | 'top' | 'side' | 'free';
export type QualityTier = 'high' | 'medium' | 'low';
export type OrientationMode = 'attitude' | 'velocity' | 'upright';
export type PhoneMounting = 'nose' | 'flat' | 'landscape';
export type TileSource = 'osm_dark' | 'satellite' | 'canvas';
export type TimeWindow = '30s' | '2m' | '10m' | 'all';

export interface HudToastItem {
  id?: number;
  title?: string;
  message: string;
  type?: 'phone' | 'sim' | 'info' | 'warning' | 'success';
}

export interface PinnedMarker {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  t: number;
  note: string;
}

export function isSimulatorDevice(deviceId?: string | null): boolean {
  if (!deviceId) return false;
  const d = deviceId.toLowerCase();
  return d.startsWith('sim') || d.includes('simulator') || d.includes('phone_px8_');
}

export function isSimulatorSession(session?: SessionRecord | null): boolean {
  if (!session) return false;
  if (session.source === 'sim') return true;
  return isSimulatorDevice(session.deviceId);
}

interface TelemetryState {
  // Auth & Connection & Role
  viewerKey: string;
  role: 'viewer' | 'admin' | null;
  serverStatus: 'online' | 'waking_up' | 'offline';
  isWatchMode: boolean;
  serverUrl: string;
  wsStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  deviceOnline: boolean;
  activeDeviceId: string | null;
  ratePerSec: number;
  lastSampleAt: number | null;
  linkLatencyMs: number | null;
  lastBatchReceivedAt: number;
  seqStep: number;
  startGpsAlt: number | null;
  isDiagnosticsOpen: boolean;
  isAccessModalOpen: boolean;
  isDeviceLinkOpen: boolean;

  // Real Phone Data First state
  waitingForPhone: boolean;

  // Clock Synchronization & Latency
  clockOffsetMs: number;
  serverRttMs: number;

  // Toast Notifications
  lastToast: HudToastItem | null;

  // Map Tile Source
  tileSource: TileSource;

  // 3D Vehicle Type & Calibration
  vehicleType: VehicleType;
  orientationMode: OrientationMode;
  phoneMounting: PhoneMounting;
  manualRotation: { pitch: number; roll: number; yaw: number };
  attitudeZeroQuat: { x: number; y: number; z: number; w: number } | null;

  // Session
  currentSessionId: string | null;
  currentSession: SessionRecord | null;
  sessionsList: SessionRecord[];
  ghostSessionId: string | null;
  ghostSamples: InterpolatedSample[];

  // Telemetry Samples
  samples: Sample[];
  interpolatedSamples: InterpolatedSample[];
  originGps: { lat: number; lon: number; alt: number } | null;
  lastSeenSeq: number;

  // Visual & 3D Config
  trailStyle: TrailStyle;
  colorMetric: ColorMetric;
  verticalExaggeration: number;
  cameraPreset: CameraPreset;
  quality: QualityTier;
  showMapTexture: boolean;
  cinemaMode: boolean;
  isAutoFollow: boolean;
  isSoundMuted: boolean;

  // Units
  useGForce: boolean;
  useDegPerSec: boolean;

  // Chart & Crosshair
  xAxis: XAxisType;
  hoveredIndex: number | null;
  pinnedMarkers: PinnedMarker[];
  chartSmoothing: 0 | 5 | 10 | 20;
  hideMagnitude: boolean;
  timeWindow: TimeWindow;
  followLive: boolean;

  // Replay
  isReplayMode: boolean;
  isPlaying: boolean;
  replayIndex: number;
  replaySpeed: number;

  // Actions
  setViewerKey: (key: string) => void;
  setServerUrl: (url: string) => void;
  setAccessModalOpen: (open: boolean) => void;
  setVehicleType: (type: VehicleType) => void;
  setTrailStyle: (style: TrailStyle) => void;
  setColorMetric: (metric: ColorMetric) => void;
  setVerticalExaggeration: (val: number) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  setQuality: (quality: QualityTier) => void;
  setShowMapTexture: (show: boolean) => void;
  setCinemaMode: (cinema: boolean) => void;
  setAutoFollow: (follow: boolean) => void;
  setSoundMuted: (muted: boolean) => void;
  setUseGForce: (useG: boolean) => void;
  setUseDegPerSec: (useDeg: boolean) => void;
  setXAxis: (axis: XAxisType) => void;
  setHoveredIndex: (idx: number | null) => void;
  setChartSmoothing: (smoothing: 0 | 5 | 10 | 20) => void;
  setHideMagnitude: (hide: boolean) => void;
  setRole: (role: 'viewer' | 'admin' | null) => void;
  setServerStatus: (status: 'online' | 'waking_up' | 'offline') => void;
  setWatchMode: (watch: boolean) => void;
  checkAuthAndRole: () => Promise<boolean>;
  copyViewerLink: () => Promise<boolean>;
  setTimeWindow: (w: TimeWindow) => void;
  setFollowLive: (follow: boolean) => void;
  addPinnedMarker: (marker: Omit<PinnedMarker, 'id'>) => void;
  removePinnedMarker: (id: string) => void;

  // Device Link & Orientation Actions
  setDeviceLinkOpen: (open: boolean) => void;
  setDiagnosticsOpen: (open: boolean) => void;
  setSeqStep: (step: number) => void;
  setOrientationMode: (mode: OrientationMode) => void;
  setPhoneMounting: (m: PhoneMounting) => void;
  rotateManual: (axis: 'pitch' | 'roll' | 'yaw', deltaDeg: number) => void;
  resetManualRotation: () => void;
  setAttitudeZero: (quat: { x: number; y: number; z: number; w: number } | null) => void;
  setTileSource: (src: TileSource) => void;
  setToast: (toast: HudToastItem | null) => void;
  syncClockOffset: () => Promise<void>;
  useSimulatorData: () => Promise<void>;

  // Replay Actions
  toggleReplayPlay: () => void;
  setReplayIndex: (index: number) => void;
  setReplaySpeed: (speed: number) => void;
  exitReplay: () => void;

  // Network / Data Actions
  fetchSessions: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  loadGhostSession: (sessionId: string | null) => Promise<void>;
  deleteCurrentSession: () => Promise<void>;
  initWebSocket: () => void;
  disconnectWebSocket: () => void;
}

let activeWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

export const useTelemetryStore = create<TelemetryState>((set, get) => {
  // Extract initial key from URL hash if provided: #key=<KEY>
  let initialKey = '';
  if (typeof window !== 'undefined') {
    if (window.location.hash.includes('key=')) {
      const match = window.location.hash.match(/key=([^&]+)/);
      if (match && match[1]) {
        initialKey = decodeURIComponent(match[1]);
        localStorage.setItem('rocket_viewer_key', initialKey);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    if (!initialKey) {
      initialKey = localStorage.getItem('rocket_viewer_key') || '';
    }
  }

  const savedVehicle = (typeof window !== 'undefined' ? (localStorage.getItem('rocket_vehicle_type') as VehicleType) : null) || 'ground';
  const savedTrail = (typeof window !== 'undefined' ? (localStorage.getItem('rocket_trail_style') as TrailStyle) : null) || 'tube';
  const savedQuality = (typeof window !== 'undefined' ? (localStorage.getItem('rocket_quality') as QualityTier) : null) || 'high';

  return {
    viewerKey: initialKey || 'ground_station_viewer_2026',
    role: null,
    serverStatus: 'online',
    isWatchMode: false,
    serverUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    wsStatus: 'disconnected',
    deviceOnline: false,
    activeDeviceId: null,
    ratePerSec: 0,
    lastSampleAt: null,
    linkLatencyMs: null,
    lastBatchReceivedAt: 0,
    seqStep: 1,
    startGpsAlt: null,
    isDiagnosticsOpen: false,
    isAccessModalOpen: false,
    isDeviceLinkOpen: false,
    waitingForPhone: true,

    clockOffsetMs: 0,
    serverRttMs: 0,
    lastToast: null,
    tileSource: 'osm_dark',

    vehicleType: savedVehicle,
    orientationMode: 'velocity',
    phoneMounting: 'flat',
    manualRotation: { pitch: 0, roll: 0, yaw: 0 },
    attitudeZeroQuat: null,

    currentSessionId: 'latest-phone',
    currentSession: null,
    sessionsList: [],
    ghostSessionId: null,
    ghostSamples: [],

    samples: [],
    interpolatedSamples: [],
    originGps: null,
    lastSeenSeq: -1,

    trailStyle: savedTrail,
    colorMetric: 'speed',
    verticalExaggeration: 3,
    cameraPreset: 'follow',
    quality: savedQuality,
    showMapTexture: false,
    cinemaMode: false,
    isAutoFollow: true,
    isSoundMuted: true, // Muted by default as required

    useGForce: false,
    useDegPerSec: true,

    xAxis: 'time',
    hoveredIndex: null,
    pinnedMarkers: [],
    chartSmoothing: 0,
    hideMagnitude: false,
    timeWindow: 'all',
    followLive: true,

    isReplayMode: false,
    isPlaying: false,
    replayIndex: 0,
    replaySpeed: 1,

    setViewerKey: (key: string) => {
      if (typeof window !== 'undefined') localStorage.setItem('rocket_viewer_key', key);
      set({ viewerKey: key });
      get().checkAuthAndRole();
      get().fetchSessions();
      get().initWebSocket();
    },

    setRole: (role) => set({ role }),
    setServerStatus: (status) => set({ serverStatus: status }),
    setWatchMode: (watch) => set({ isWatchMode: watch }),

    checkAuthAndRole: async () => {
      const { serverUrl, viewerKey } = get();
      if (!viewerKey) {
        set({ role: null, isAccessModalOpen: true });
        return false;
      }
      try {
        const res = await fetch(`${serverUrl}/api/whoami`, {
          headers: { 'x-viewer-key': viewerKey },
        });
        if (res.ok) {
          const data = await res.json();
          set({ role: data.role, isAccessModalOpen: false, serverStatus: 'online' });
          return true;
        } else if (res.status === 401 || res.status === 403) {
          set({ role: null, isAccessModalOpen: true, serverStatus: 'online' });
          return false;
        } else if (res.status >= 500) {
          set({ serverStatus: 'waking_up' });
          return false;
        }
      } catch (err) {
        // Failed network fetch might be sleeping server
        set({ serverStatus: 'waking_up' });
        return false;
      }
      return false;
    },

    copyViewerLink: async () => {
      const { viewerKey } = get();
      if (typeof window === 'undefined') return false;
      const shareUrl = `${window.location.origin}/#key=${encodeURIComponent(viewerKey)}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        get().setToast({
          title: 'VIEWER LINK COPIED',
          message: 'Share URL copied to clipboard: Hash-secured view link',
          type: 'success',
        });
        return true;
      } catch {
        return false;
      }
    },

    setServerUrl: (url: string) => set({ serverUrl: url }),
    setAccessModalOpen: (open: boolean) => set({ isAccessModalOpen: open }),

    setVehicleType: (type: VehicleType) => {
      if (typeof window !== 'undefined') localStorage.setItem('rocket_vehicle_type', type);
      set({ vehicleType: type });
    },

    setTrailStyle: (style: TrailStyle) => {
      if (typeof window !== 'undefined') localStorage.setItem('rocket_trail_style', style);
      set({ trailStyle: style });
    },

    setColorMetric: (metric: ColorMetric) => set({ colorMetric: metric }),
    setVerticalExaggeration: (val: number) => set({ verticalExaggeration: val }),
    setCameraPreset: (preset: CameraPreset) => set({ cameraPreset: preset }),

    setQuality: (quality: QualityTier) => {
      if (typeof window !== 'undefined') localStorage.setItem('rocket_quality', quality);
      set({ quality });
    },

    setShowMapTexture: (show: boolean) => set({ showMapTexture: show }),
    setCinemaMode: (cinema: boolean) => set({ cinemaMode: cinema }),
    setAutoFollow: (follow: boolean) => set({ isAutoFollow: follow }),

    setSoundMuted: (muted: boolean) => {
      audioManager.isMuted = muted;
      set({ isSoundMuted: muted });
    },

    setUseGForce: (useG: boolean) => set({ useGForce: useG }),
    setUseDegPerSec: (useDeg: boolean) => set({ useDegPerSec: useDeg }),
    setXAxis: (axis: XAxisType) => set({ xAxis: axis }),
    setHoveredIndex: (idx: number | null) => set({ hoveredIndex: idx }),
    setChartSmoothing: (smoothing: 0 | 5 | 10 | 20) => set({ chartSmoothing: smoothing }),
    setHideMagnitude: (hide: boolean) => set({ hideMagnitude: hide }),
    setTimeWindow: (w: TimeWindow) => set({ timeWindow: w }),
    setFollowLive: (follow: boolean) => set({ followLive: follow }),

    addPinnedMarker: (marker) => {
      const newMarker: PinnedMarker = {
        ...marker,
        id: `pin_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      };
      set((state) => ({ pinnedMarkers: [...state.pinnedMarkers, newMarker] }));
    },

    removePinnedMarker: (id: string) => {
      set((state) => ({ pinnedMarkers: state.pinnedMarkers.filter((p) => p.id !== id) }));
    },

    setDeviceLinkOpen: (open: boolean) => set({ isDeviceLinkOpen: open }),
    setDiagnosticsOpen: (open: boolean) => set({ isDiagnosticsOpen: open }),
    setSeqStep: (step: number) => set({ seqStep: step }),
    setOrientationMode: (mode: OrientationMode) => set({ orientationMode: mode }),
    setPhoneMounting: (m: PhoneMounting) => set({ phoneMounting: m }),
    rotateManual: (axis, deltaDeg) => {
      set((s) => ({
        manualRotation: {
          ...s.manualRotation,
          [axis]: (s.manualRotation[axis] + deltaDeg) % 360,
        },
      }));
    },
    resetManualRotation: () => set({ manualRotation: { pitch: 0, roll: 0, yaw: 0 } }),
    setAttitudeZero: (quat) => set({ attitudeZeroQuat: quat }),
    setTileSource: (src: TileSource) => set({ tileSource: src }),
    setToast: (toast) => {
      if (!toast) {
        set({ lastToast: null });
        return;
      }
      set({
        lastToast: {
          id: toast.id || Date.now(),
          title: toast.title || (toast.type === 'phone' ? '📱 REAL PHONE' : toast.type === 'sim' ? '⚡ SIMULATOR' : 'ℹ️ SYSTEM'),
          message: toast.message,
          type: toast.type || 'info',
        },
      });
    },

    syncClockOffset: async () => {
      try {
        const t0 = performance.now();
        const clientNow = Date.now();
        const res = await fetch(`${get().serverUrl}/api/health`);
        const t1 = performance.now();
        const data = await res.json();
        if (data && typeof data.time === 'number') {
          const rtt = t1 - t0;
          // Offset = client time - server time
          const offset = (clientNow + rtt / 2) - data.time;
          set({ clockOffsetMs: Math.round(offset), serverRttMs: Math.round(rtt) });
        }
      } catch {}
    },

    useSimulatorData: async () => {
      const { sessionsList, selectSession } = get();
      const simSession = sessionsList.find((s) => isSimulatorSession(s));
      if (simSession) {
        set({ waitingForPhone: false });
        await selectSession(simSession.id);
      } else {
        await selectSession('latest');
      }
    },

    toggleReplayPlay: () => {
      set((state) => ({
        isReplayMode: true,
        isPlaying: !state.isPlaying,
      }));
    },

    setReplayIndex: (index: number) => {
      set({ isReplayMode: true, replayIndex: index });
    },

    setReplaySpeed: (speed: number) => set({ replaySpeed: speed }),

    exitReplay: () => {
      set((state) => ({
        isReplayMode: false,
        isPlaying: false,
        replayIndex: Math.max(0, state.samples.length - 1),
      }));
    },

    fetchSessions: async () => {
      const { serverUrl, viewerKey, currentSessionId } = get();
      try {
        const res = await fetch(`${serverUrl}/api/sessions`, {
          headers: { 'x-viewer-key': viewerKey },
        });
        if (res.ok) {
          const list: SessionRecord[] = await res.json();
          set({ sessionsList: list });

          const phoneSessions = list.filter((s) => !isSimulatorSession(s));
          const hasPhoneSession = phoneSessions.length > 0;

          if (currentSessionId === 'latest-phone' || currentSessionId === 'latest') {
            if (hasPhoneSession) {
              const latestPhone = phoneSessions[0];
              set({
                currentSessionId: latestPhone.id,
                currentSession: latestPhone,
                waitingForPhone: false,
              });
              get().selectSession(latestPhone.id);
            } else {
              // Real phone data first: No phone session exists yet -> Clean Waiting for Phone state
              set({
                currentSession: null,
                samples: [],
                interpolatedSamples: [],
                waitingForPhone: true,
              });
            }
          }
        }
      } catch (e) {
        console.warn('Failed fetching sessions:', e);
      }
    },

    selectSession: async (sessionId: string) => {
      set({
        currentSessionId: sessionId,
        samples: [],
        interpolatedSamples: [],
        originGps: null,
        lastSeenSeq: -1,
        isReplayMode: false,
        isPlaying: false,
        replayIndex: 0,
        waitingForPhone: false,
      });

      const { serverUrl, viewerKey } = get();
      try {
        const res = await fetch(`${serverUrl}/api/sessions/${sessionId}/samples`, {
          headers: { 'x-viewer-key': viewerKey },
        });
        if (res.ok) {
          const data = await res.json();
          const rawSamples: Sample[] = data.samples || [];
          const interpolated = interpolateGpsSamples(rawSamples);

          let origin = null;
          for (const s of rawSamples) {
            if (s.lat !== null && s.lon !== null && s.gps_alt !== null) {
              origin = { lat: s.lat, lon: s.lon, alt: s.gps_alt };
              break;
            }
          }

          const maxSeq = rawSamples.length > 0 ? rawSamples[rawSamples.length - 1].seq : -1;
          const sessionMeta = get().sessionsList.find((s) => s.id === sessionId) || null;

          set({
            samples: rawSamples,
            interpolatedSamples: interpolated,
            originGps: origin,
            lastSeenSeq: maxSeq,
            currentSession: sessionMeta,
            replayIndex: Math.max(0, rawSamples.length - 1),
          });
        }
      } catch (err) {
        console.error('Failed loading session samples:', err);
      }

      // Re-connect WebSocket to targeted session
      get().initWebSocket();
    },

    loadGhostSession: async (sessionId: string | null) => {
      if (!sessionId) {
        set({ ghostSessionId: null, ghostSamples: [] });
        return;
      }

      const { serverUrl, viewerKey } = get();
      try {
        const res = await fetch(`${serverUrl}/api/sessions/${sessionId}/samples`, {
          headers: { 'x-viewer-key': viewerKey },
        });
        if (res.ok) {
          const data = await res.json();
          const ghostInterpolated = interpolateGpsSamples(data.samples || []);
          set({ ghostSessionId: sessionId, ghostSamples: ghostInterpolated });
        }
      } catch (err) {
        console.warn('Failed loading ghost session:', err);
      }
    },

    deleteCurrentSession: async () => {
      const { currentSessionId, serverUrl, viewerKey } = get();
      if (!currentSessionId || currentSessionId === 'latest' || currentSessionId === 'latest-phone') return;

      try {
        const res = await fetch(`${serverUrl}/api/sessions/${currentSessionId}`, {
          method: 'DELETE',
          headers: { 'x-viewer-key': viewerKey },
        });
        if (res.ok) {
          await get().fetchSessions();
        }
      } catch (e) {
        console.error('Delete error:', e);
      }
    },

    initWebSocket: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeWs) {
        try {
          activeWs.close();
        } catch {}
      }

      const { serverUrl, viewerKey, currentSessionId } = get();
      const wsUrl = new URL('/ws', serverUrl.replace(/^http/, 'ws'));
      wsUrl.searchParams.set('session', currentSessionId || 'latest-phone');
      wsUrl.searchParams.set('key', viewerKey);

      set({ wsStatus: 'connecting' });

      try {
        const ws = new WebSocket(wsUrl.toString());
        activeWs = ws;

        ws.onopen = () => {
          set({ wsStatus: 'connected' });
          reconnectAttempts = 0;
          get().syncClockOffset();
        };

        ws.onmessage = (event) => {
          try {
            const msg: WsServerMessage = JSON.parse(event.data);
            const state = get();

            if (msg.type === 'hello') {
              if (msg.sessionId) {
                const found = state.sessionsList.find((s) => s.id === msg.sessionId);
                const isPhone = msg.source === 'phone' || (msg.deviceId ? !isSimulatorDevice(msg.deviceId) : false);
                set({
                  currentSessionId: msg.sessionId,
                  activeDeviceId: msg.deviceId || found?.deviceId || state.activeDeviceId,
                  waitingForPhone: !isPhone && state.waitingForPhone,
                  seqStep: msg.seqStep || state.seqStep || 1,
                  currentSession: found || {
                    id: msg.sessionId,
                    name: `Sounding Session ${msg.sessionId.substring(0, 12)}`,
                    deviceId: msg.deviceId || 'remote-device',
                    source: msg.source || (isPhone ? 'phone' : 'sim'),
                    startedAt: Date.now(),
                    endedAt: null,
                    sampleCount: 0,
                    bounds: null,
                    seqStep: msg.seqStep || 1,
                  },
                });
              }
            } else if (msg.type === 'session_started') {
              const isPhone = msg.session.source === 'phone' || !isSimulatorDevice(msg.session.deviceId);
              
              // When a new REAL PHONE session starts, auto-switch to it with toast and audio
              if (isPhone) {
                set({
                  waitingForPhone: false,
                  lastToast: {
                    id: Date.now(),
                    title: '📱 REAL PHONE CONNECTED',
                    message: `Device "${msg.session.deviceId}" started "${msg.session.name}"`,
                    type: 'phone',
                  },
                  activeDeviceId: msg.session.deviceId,
                  seqStep: msg.session.seqStep || state.seqStep || 1,
                });
                audioManager.playConnect();
                get().selectSession(msg.session.id);
                get().fetchSessions();
              } else {
                set({
                  lastToast: {
                    id: Date.now(),
                    title: '⚡ SIMULATOR CONNECTED',
                    message: `Simulator session "${msg.session.name}" started`,
                    type: 'sim',
                  },
                  activeDeviceId: msg.session.deviceId,
                  seqStep: msg.session.seqStep || state.seqStep || 1,
                });
                get().fetchSessions();
              }
            } else if (msg.type === 'status') {
              const prevOnline = state.deviceOnline;
              set({
                deviceOnline: msg.deviceOnline,
                lastSampleAt: msg.lastSampleAt,
                ratePerSec: msg.ratePerSec,
                seqStep: msg.seqStep || state.seqStep || 1,
                ...(msg.deviceId ? { activeDeviceId: msg.deviceId } : {}),
              });
              if (prevOnline && !msg.deviceOnline) {
                audioManager.playSignalLost();
              }
            } else if (msg.type === 'batch') {
              const incoming = msg.samples;
              if (incoming.length === 0) return;

              const prevSamples = state.samples;
              let merged: Sample[];

              if (msg.isBackfill) {
                const seqMap = new Map<number, Sample>();
                for (const s of prevSamples) seqMap.set(s.seq, s);
                for (const s of incoming) seqMap.set(s.seq, s);
                merged = Array.from(seqMap.values()).sort((a, b) => a.seq - b.seq);
              } else {
                merged = [...prevSamples, ...incoming];
                if (merged.length > 5000) {
                  merged = merged.slice(-5000);
                }
              }

              const startAlt = calculateStartGpsAltitude(merged);
              let origin = state.originGps;
              if (!origin || (startAlt !== null && origin.alt !== startAlt)) {
                for (const s of merged) {
                  if (s.lat !== null && s.lon !== null && s.gps_alt !== null) {
                    origin = { lat: s.lat, lon: s.lon, alt: startAlt ?? s.gps_alt };
                    if (!state.originGps) audioManager.playGpsFix();
                    break;
                  }
                }
              }

              const interpolated = interpolateGpsSamples(merged);
              const latestSample = merged[merged.length - 1];
              const step = msg.seqStep || inferSeqStep(merged) || state.seqStep || 1;

              // Latency: compute phone-to-server clock offset with RTT removed
              const estimatedClientNow = Date.now() - state.clockOffsetMs;
              const rawDelayMs = estimatedClientNow - latestSample.t;
              const cleanLatency = rawDelayMs >= 0 && rawDelayMs <= 30000 ? Math.round(rawDelayMs) : null;

              set({
                samples: merged,
                interpolatedSamples: interpolated,
                originGps: origin,
                startGpsAlt: startAlt,
                seqStep: step,
                lastSeenSeq: latestSample.seq,
                lastBatchReceivedAt: Date.now(),
                linkLatencyMs: cleanLatency,
                waitingForPhone: false,
                replayIndex: state.isReplayMode ? state.replayIndex : merged.length - 1,
              });
            }
          } catch (e) {
            console.warn('Error parsing WS message:', e);
          }
        };

        ws.onclose = () => {
          set({ wsStatus: 'disconnected', deviceOnline: false });
          const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts++), 10000);
          reconnectTimer = setTimeout(() => {
            get().initWebSocket();
          }, delay);
        };

        ws.onerror = () => {
          set({ wsStatus: 'error' });
        };
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
        set({ wsStatus: 'error' });
      }
    },

    disconnectWebSocket: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeWs) {
        activeWs.close();
        activeWs = null;
      }
      set({ wsStatus: 'disconnected' });
    },
  };
});
