export interface Sample {
  seq: number;
  t: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  mag_x: number;
  mag_y: number;
  mag_z: number;
  roll: number;
  pitch: number;
  yaw: number;
  pressure: number | null;
  altitude: number | null;
  prox: number | null;
  lat: number | null;
  lon: number | null;
  gps_alt: number | null;
  speed: number | null;
  sats: number | null;
  gps_acc: number | null;
  bearing: number | null;
  gps_fix_t: number | null;
  batt: number;
  batt_temp: number;
  sats_visible?: number | null;
  gps_cn0?: number | null;
  gps_age_ms?: number | null;
  gps_msl_alt?: number | null;
  gps_provider?: 'gps' | 'fused' | 'network' | string | null;
}

export interface InterpolatedSample extends Sample {
  isInterpolated?: boolean;
  distanceMeters?: number;
  accelMag?: number;
  gyroMag?: number;
  magMag?: number;
  heightAboveStart?: number | null;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface SessionRecord {
  id: string;
  name: string;
  deviceId: string;
  source?: 'phone' | 'sim' | 'fc';
  startedAt: number;
  endedAt: number | null;
  sampleCount: number;
  bounds: Bounds | null;
  seqStep?: number | null;
}

export type WsServerMessage =
  | { type: 'hello'; sessionId: string; deviceId?: string; source?: 'phone' | 'sim' | 'fc'; seqStep?: number | null }
  | { type: 'batch'; sessionId: string; samples: Sample[]; isBackfill?: boolean; seqStep?: number | null }
  | {
      type: 'status';
      deviceOnline: boolean;
      lastSampleAt: number | null;
      ratePerSec: number;
      deviceId?: string;
      source?: 'phone' | 'sim' | 'fc';
      seqStep?: number | null;
      gps?: {
        lat: number | null;
        lon: number | null;
        fixTime: number | null;
        ageMs: number | null;
        sats: number | null;
        satsVisible: number | null;
        acc?: number | null;
        provider?: string | null;
      };
    }
  | { type: 'session_started'; session: SessionRecord }
  | { type: 'ping' };

export interface SessionStats {
  durationSeconds: number;
  distanceMeters: number;
  maxSpeedKmh: number;
  maxAccelG: number;
  maxAltitudeMeters: number;
  startAltitudeMeters: number | null;
  sampleCount: number;
  avgRateHz: number;
  packetsLost: number;
  lossPct: number;
  seqStep: number;
}
