import { Sample, InterpolatedSample, Bounds } from './types.js';

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates Haversine distance between two coordinates in meters.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Converts Geodetic (lat, lon, alt) to East-North-Up (ENU) coordinates in meters
 * relative to a reference origin coordinate.
 */
export function geodeticToEnu(
  lat: number,
  lon: number,
  alt: number,
  originLat: number,
  originLon: number,
  originAlt: number
): { x: number; y: number; z: number } {
  const dLat = ((lat - originLat) * Math.PI) / 180;
  const dLon = ((lon - originLon) * Math.PI) / 180;
  const meanLat = (((lat + originLat) / 2) * Math.PI) / 180;

  // Local tangent plane approximation (highly accurate for regional ranges < 50 km)
  const north = dLat * EARTH_RADIUS_METERS;
  const east = dLon * (EARTH_RADIUS_METERS * Math.cos(meanLat));
  const up = alt - originAlt;

  // Three.js convention: X = East, Y = Up, Z = -North (standard right-handed)
  return {
    x: east,
    y: up,
    z: -north,
  };
}

/**
 * Linearly interpolates lat/lon between consecutive GPS fixes.
 * The phone samples IMU at up to 100 Hz but GPS at ~1 Hz.
 * Consecutive samples with identical (lat, lon, gps_fix_t) are interpolated
 * between fix_A and fix_B using sample t.
 */
export function interpolateGpsSamples(samples: Sample[]): InterpolatedSample[] {
  if (samples.length === 0) return [];

  const result: InterpolatedSample[] = [];

  // Identify distinct GPS fix indices
  const fixIndices: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].lat !== null && samples[i].lon !== null) {
      if (
        fixIndices.length === 0 ||
        samples[i].gps_fix_t !== samples[fixIndices[fixIndices.length - 1]].gps_fix_t
      ) {
        fixIndices.push(i);
      }
    }
  }

  let totalDist = 0;
  let prevLat: number | null = null;
  let prevLon: number | null = null;

  let currentFixPointer = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let lat = s.lat;
    let lon = s.lon;
    let alt = s.gps_alt;
    let isInterpolated = false;

    // Check if we have two surrounding fixes to interpolate between
    while (
      currentFixPointer < fixIndices.length - 1 &&
      samples[fixIndices[currentFixPointer + 1]].t <= s.t
    ) {
      currentFixPointer++;
    }

    if (
      currentFixPointer < fixIndices.length - 1 &&
      fixIndices.length > 1
    ) {
      const idxA = fixIndices[currentFixPointer];
      const idxB = fixIndices[currentFixPointer + 1];
      const sampleA = samples[idxA];
      const sampleB = samples[idxB];

      if (
        sampleA.lat !== null &&
        sampleA.lon !== null &&
        sampleB.lat !== null &&
        sampleB.lon !== null &&
        sampleB.t > sampleA.t &&
        s.t >= sampleA.t &&
        s.t <= sampleB.t
      ) {
        const factor = (s.t - sampleA.t) / (sampleB.t - sampleA.t);
        lat = sampleA.lat + (sampleB.lat - sampleA.lat) * factor;
        lon = sampleA.lon + (sampleB.lon - sampleA.lon) * factor;
        if (sampleA.gps_alt !== null && sampleB.gps_alt !== null) {
          alt = sampleA.gps_alt + (sampleB.gps_alt - sampleA.gps_alt) * factor;
        }
        isInterpolated = factor > 0 && factor < 1;
      }
    }

    if (lat !== null && lon !== null) {
      if (prevLat !== null && prevLon !== null) {
        totalDist += haversineDistance(prevLat, prevLon, lat, lon);
      }
      prevLat = lat;
      prevLon = lon;
    }

    const accelMag = Math.sqrt(
      s.accel_x * s.accel_x + s.accel_y * s.accel_y + s.accel_z * s.accel_z
    );
    const gyroMag = Math.sqrt(
      s.gyro_x * s.gyro_x + s.gyro_y * s.gyro_y + s.gyro_z * s.gyro_z
    );
    const magMag = Math.sqrt(
      s.mag_x * s.mag_x + s.mag_y * s.mag_y + s.mag_z * s.mag_z
    );

    result.push({
      ...s,
      lat,
      lon,
      gps_alt: alt,
      isInterpolated,
      distanceMeters: totalDist,
      accelMag,
      gyroMag,
      magMag,
    });
  }

  return result;
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 * Reduces an array of points to a target threshold while preserving peaks and shapes.
 */
export function lttbDownsample<T>(
  data: T[],
  threshold: number,
  getX: (item: T) => number,
  getY: (item: T) => number
): T[] {
  if (threshold >= data.length || threshold <= 2) {
    return data;
  }

  const sampled: T[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  let a = 0; // Initially first point
  sampled.push(data[a]);

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate average point for the next bucket (bucket C)
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(
      Math.floor((i + 2) * bucketSize) + 1,
      data.length
    );
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    if (avgRangeLength > 0) {
      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += getX(data[j]);
        avgY += getY(data[j]);
      }
      avgX /= avgRangeLength;
      avgY /= avgRangeLength;
    } else {
      const idx = Math.min(avgRangeStart, data.length - 1);
      avgX = getX(data[idx]);
      avgY = getY(data[idx]);
    }

    // Get the range for this bucket (bucket B)
    const rangeBStart = Math.floor(i * bucketSize) + 1;
    const rangeBEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length
    );

    // Point a
    const pointAX = getX(data[a]);
    const pointAY = getY(data[a]);

    let maxArea = -1;
    let maxAreaPoint = rangeBStart;

    for (let j = rangeBStart; j < rangeBEnd; j++) {
      // Calculate triangle area between point A, point B, and average point C
      const area = Math.abs(
        (pointAX - avgX) * (getY(data[j]) - pointAY) -
          (pointAX - getX(data[j])) * (avgY - pointAY)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = j;
      }
    }

    sampled.push(data[maxAreaPoint]);
    a = maxAreaPoint;
  }

  // Always include the last point
  sampled.push(data[data.length - 1]);
  return sampled;
}

/**
 * Calculates bounding box from samples
 */
export function computeBounds(samples: Sample[]): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let found = false;

  for (const s of samples) {
    if (s.lat !== null && s.lon !== null) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
      found = true;
    }
  }

  if (!found) return null;
  return { minLat, maxLat, minLon, maxLon };
}

export interface DeadReckoningResult {
  lat: number;
  lon: number;
  isEstimated: boolean;
  dtSeconds: number;
}

/**
 * Calculates dead-reckoning position between 1 Hz GPS fixes based on speed (m/s) and bearing (deg).
 * Allowed up to 2 seconds after the fix, when speed >= 1.0 m/s and accuracy is acceptable (<= 25m).
 */
export function calculateDeadReckoning(
  lastFix: {
    lat: number;
    lon: number;
    fixTime: number;
    speed: number | null;
    bearing: number | null;
    gps_acc?: number | null;
  },
  nowMs: number
): DeadReckoningResult {
  const dtMs = nowMs - lastFix.fixTime;
  const dtSeconds = dtMs / 1000;

  // Conditions: valid dt within 2 seconds, speed >= 1.0 m/s, bearing valid, accuracy acceptable
  const speed = lastFix.speed ?? 0;
  const bearing = lastFix.bearing;
  const acc = lastFix.gps_acc ?? 10;

  if (
    dtMs > 100 &&
    dtMs <= 2000 &&
    speed >= 1.0 &&
    bearing !== null &&
    acc <= 25
  ) {
    const dist = speed * dtSeconds;
    const radBearing = (bearing * Math.PI) / 180;
    const latRad = (lastFix.lat * Math.PI) / 180;

    const deltaLat = (dist * Math.cos(radBearing)) / EARTH_RADIUS_METERS;
    const deltaLon = (dist * Math.sin(radBearing)) / (EARTH_RADIUS_METERS * Math.cos(latRad));

    const estLat = lastFix.lat + (deltaLat * 180) / Math.PI;
    const estLon = lastFix.lon + (deltaLon * 180) / Math.PI;

    return {
      lat: estLat,
      lon: estLon,
      isEstimated: true,
      dtSeconds,
    };
  }

  return {
    lat: lastFix.lat,
    lon: lastFix.lon,
    isEstimated: false,
    dtSeconds: 0,
  };
}

