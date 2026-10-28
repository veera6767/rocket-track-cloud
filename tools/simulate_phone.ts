import zlib from 'zlib';
import { Sample } from '../shared/types.js';

interface CliArgs {
  url: string;
  deviceKey: string;
  rate: number;
  profile: 'bike' | 'rocket';
  offlineAfter: number; // seconds (0 = disabled)
  offlineFor: number; // seconds
  startLat: number;
  startLon: number;
  sessionName?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    url: 'http://localhost:3000',
    deviceKey: process.env.DEVICE_KEY || 'rocket_device_secret_2026',
    rate: 100,
    profile: 'bike',
    offlineAfter: 0,
    offlineFor: 20,
    startLat: 13.0827, // Chennai, India
    startLon: 80.2707,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' && args[i + 1]) result.url = args[++i];
    else if (arg === '--device-key' && args[i + 1]) result.deviceKey = args[++i];
    else if (arg === '--rate' && args[i + 1]) result.rate = parseInt(args[++i], 10);
    else if (arg === '--profile' && args[i + 1]) result.profile = args[++i] as any;
    else if (arg === '--offline-after' && args[i + 1]) result.offlineAfter = parseFloat(args[++i]);
    else if (arg === '--offline-for' && args[i + 1]) result.offlineFor = parseFloat(args[++i]);
    else if (arg === '--lat' && args[i + 1]) result.startLat = parseFloat(args[++i]);
    else if (arg === '--lon' && args[i + 1]) result.startLon = parseFloat(args[++i]);
    else if (arg === '--name' && args[i + 1]) result.sessionName = args[++i];
  }

  return result;
}

async function uploadBatch(
  baseUrl: string,
  sessionId: string,
  deviceId: string,
  batchId: string,
  samples: Sample[],
  deviceKey: string
): Promise<{ accepted: number; duplicates: number }> {
  const payload = JSON.stringify({ deviceId, batchId, samples });
  const compressed = zlib.gzipSync(Buffer.from(payload, 'utf-8'));

  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/samples`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'x-api-key': deviceKey,
    },
    body: compressed as any,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<{ accepted: number; duplicates: number }>;
}

async function startSession(baseUrl: string, deviceId: string, name: string, deviceKey: string) {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': deviceKey,
    },
    body: JSON.stringify({ deviceId, name, source: 'sim' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create session failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<{ sessionId: string; startedAt: number }>;
}

async function run() {
  const config = parseArgs();
  const deviceId = `sim_phone_px8_${Math.random().toString(36).substring(2, 7)}`;
  const defaultName =
    config.profile === 'rocket'
      ? `Sounding Rocket Flight #${Math.floor(Math.random() * 900) + 100}`
      : `Bike Pillion Test - Chennai Circuit`;
  const sessionName = config.sessionName || defaultName;

  console.log('====================================================');
  console.log('🚀 SMARTPHONE TELEMETRY SIMULATOR');
  console.log(`Server Target: ${config.url}`);
  console.log(`Profile:       ${config.profile.toUpperCase()}`);
  console.log(`Sample Rate:   ${config.rate} Hz (batching 1s)`);
  console.log(`Origin:        ${config.startLat}, ${config.startLon} (Chennai)`);
  if (config.offlineAfter > 0) {
    console.log(`Simulated Drop: After ${config.offlineAfter}s for ${config.offlineFor}s`);
  }
  console.log('====================================================');

  const { sessionId } = await startSession(config.url, deviceId, sessionName, config.deviceKey);
  console.log(`Created Session: ${sessionId}`);

  let seq = 0;
  let batchIndex = 0;
  const startTime = Date.now();
  let simTimeSeconds = 0;

  // GPS state
  let currentLat = config.startLat;
  let currentLon = config.startLon;
  let currentGpsAlt = 12.0; // meters MSL
  let currentSpeed = 0.0; // m/s
  let currentBearing = 45.0; // deg
  let lastGpsFixTime = startTime;

  // Battery state
  let batteryPct = 92;
  let batteryTemp = 33.5;

  // Offline buffer queue
  const offlineQueue: { batchId: string; samples: Sample[] }[] = [];
  let isOffline = false;

  const intervalMs = 1000 / config.rate;
  const batchSize = config.rate; // 1 second of samples

  const tick = async () => {
    const batchSamples: Sample[] = [];
    const batchId = `b_${batchIndex++}_${Date.now()}`;

    for (let i = 0; i < batchSize; i++) {
      const sampleTime = startTime + Math.floor(simTimeSeconds * 1000);
      const tSec = simTimeSeconds;

      // Update GPS once per second (at i === 0)
      if (i === 0) {
        lastGpsFixTime = sampleTime;

        if (config.profile === 'bike') {
          // Bike loop simulation: parametric oval in Chennai
          // Speed: varies between 4 m/s and 9 m/s with occasional stops/turns
          const loopT = tSec * 0.04; // complete loop every ~150 seconds
          const radiusLat = 0.0045; // ~500m radius
          const radiusLon = 0.0065;
          currentLat = config.startLat + radiusLat * Math.sin(loopT);
          currentLon = config.startLon + radiusLon * Math.sin(loopT * 2) * 0.5;
          currentGpsAlt = 12.0 + 3.0 * Math.sin(loopT * 3);
          currentSpeed = 5.5 + 2.5 * Math.sin(loopT * 1.5) + (Math.random() - 0.5) * 0.4;
          currentBearing = (Math.atan2(Math.cos(loopT), -Math.sin(loopT)) * 180) / Math.PI;
          if (currentBearing < 0) currentBearing += 360;
        } else {
          // Rocket flight profile
          if (tSec < 5) {
            // Pad idle
            currentSpeed = 0;
            currentGpsAlt = 15.0;
          } else if (tSec < 15) {
            // Boost phase (10s): accelerates up to 120 m/s, climbs to 600m
            const boostT = tSec - 5;
            currentSpeed = boostT * 12.0;
            currentGpsAlt = 15.0 + 0.5 * 12.0 * boostT * boostT;
            currentLat = config.startLat + (boostT * 0.00005);
            currentLon = config.startLon + (boostT * 0.00008);
          } else if (tSec < 35) {
            // Coast to apogee: decelerates under gravity
            const coastT = tSec - 15;
            const boostPeakSpeed = 120.0;
            currentSpeed = Math.max(0, boostPeakSpeed - 9.8 * coastT);
            currentGpsAlt = 615.0 + (boostPeakSpeed * coastT - 0.5 * 9.8 * coastT * coastT);
            currentLat = config.startLat + (0.0005 + coastT * 0.00003);
            currentLon = config.startLon + (0.0008 + coastT * 0.00005);
          } else {
            // Parachute descent
            const descentT = tSec - 35;
            currentSpeed = 7.5; // terminal parachute descent
            currentGpsAlt = Math.max(15.0, 1200.0 - descentT * 7.5);
            currentLat = config.startLat + (0.0011 + descentT * 0.00002);
            currentLon = config.startLon + (0.0018 + descentT * 0.00003);
          }
        }
      }

      // High-rate IMU sensors (100 Hz)
      let ax = (Math.random() - 0.5) * 0.8;
      let ay = (Math.random() - 0.5) * 0.8;
      let az = 9.81 + (Math.random() - 0.5) * 0.8; // Gravity + noise
      let gx = (Math.random() - 0.5) * 0.05;
      let gy = (Math.random() - 0.5) * 0.05;
      let gz = (Math.random() - 0.5) * 0.05;
      let roll = 0;
      let pitch = 0;
      let yaw = currentBearing;

      if (config.profile === 'bike') {
        // Road bump vibrations + turn banking
        const roadBump = Math.sin(tSec * 45) * 0.7 + (Math.random() - 0.5) * 1.2;
        az += roadBump;
        // Lean into turns
        const turnLean = Math.sin(tSec * 0.08) * 12; // +/- 12 deg roll
        roll = turnLean + (Math.random() - 0.5) * 1.5;
        pitch = Math.sin(tSec * 0.2) * 2.5; // slight road gradient
        ax += (turnLean / 15) * 1.5; // centripetal accel
        gz += (Math.PI / 180) * 8 * Math.cos(tSec * 0.08); // yaw rate
      } else {
        // Rocket dynamics
        if (tSec >= 5 && tSec < 15) {
          // Boost: intense 5g acceleration + motor vibration
          az = 9.81 + 45.0 + (Math.random() - 0.5) * 12.0;
          ax += (Math.random() - 0.5) * 4.0;
          ay += (Math.random() - 0.5) * 4.0;
          pitch = 85.0 + (Math.random() - 0.5) * 2.0; // near vertical
          roll = (tSec * 180) % 360; // slow spin stabilization
        } else if (tSec >= 15 && tSec < 35) {
          // Coast / Freefall (near 0-g apparent acceleration)
          az = 0.2 + (Math.random() - 0.5) * 0.3;
          pitch = 70.0 - (tSec - 15) * 3.5;
        } else {
          // Parachute canopy oscillation
          az = 9.81 + Math.sin(tSec * 2.5) * 2.0;
          roll = Math.sin(tSec * 1.2) * 15.0;
          pitch = Math.cos(tSec * 1.2) * 15.0;
        }
      }

      // Earth magnetic field (~42 uT in Chennai) rotated by yaw
      const yawRad = (yaw * Math.PI) / 180;
      const mx = 38.0 * Math.cos(yawRad) + (Math.random() - 0.5) * 1.5;
      const my = 38.0 * Math.sin(yawRad) + (Math.random() - 0.5) * 1.5;
      const mz = -18.0 + (Math.random() - 0.5) * 1.5;

      const sample: Sample = {
        seq: seq++,
        t: sampleTime,
        accel_x: parseFloat(ax.toFixed(3)),
        accel_y: parseFloat(ay.toFixed(3)),
        accel_z: parseFloat(az.toFixed(3)),
        gyro_x: parseFloat(gx.toFixed(4)),
        gyro_y: parseFloat(gy.toFixed(4)),
        gyro_z: parseFloat(gz.toFixed(4)),
        mag_x: parseFloat(mx.toFixed(2)),
        mag_y: parseFloat(my.toFixed(2)),
        mag_z: parseFloat(mz.toFixed(2)),
        roll: parseFloat(roll.toFixed(2)),
        pitch: parseFloat(pitch.toFixed(2)),
        yaw: parseFloat(yaw.toFixed(2)),
        pressure: null, // Phone has NO barometer
        altitude: null, // Phone has NO barometer
        prox: 5.0, // proximity sensor
        lat: parseFloat(currentLat.toFixed(7)),
        lon: parseFloat(currentLon.toFixed(7)),
        gps_alt: parseFloat(currentGpsAlt.toFixed(1)),
        speed: parseFloat(currentSpeed.toFixed(2)),
        sats: 12,
        gps_acc: 3.2,
        bearing: parseFloat(currentBearing.toFixed(1)),
        gps_fix_t: lastGpsFixTime,
        batt: batteryPct,
        batt_temp: parseFloat((batteryTemp + Math.sin(tSec * 0.05) * 0.5).toFixed(1)),
        sats_visible: 16,
        gps_cn0: parseFloat((33.5 + Math.sin(tSec * 0.1) * 2.0).toFixed(1)),
        gps_age_ms: Math.floor(Math.random() * 200) + 100,
      };

      batchSamples.push(sample);
      simTimeSeconds += 1 / config.rate;
    }

    // Battery slow drain
    if (batchIndex % 30 === 0 && batteryPct > 10) batteryPct--;

    // Offline simulation check
    if (config.offlineAfter > 0) {
      if (!isOffline && simTimeSeconds >= config.offlineAfter && simTimeSeconds < config.offlineAfter + config.offlineFor) {
        isOffline = true;
        console.log(`⚠️  [SIM] CELLULAR SIGNAL DROPPED at T+${simTimeSeconds.toFixed(1)}s! Accumulating offline backlog...`);
      } else if (isOffline && simTimeSeconds >= config.offlineAfter + config.offlineFor) {
        isOffline = false;
        console.log(`📶 [SIM] CELLULAR SIGNAL RESTORED! Uploading backlog of ${offlineQueue.length} batches...`);
        while (offlineQueue.length > 0) {
          const item = offlineQueue.shift()!;
          try {
            const res = await uploadBatch(config.url, sessionId, deviceId, item.batchId, item.samples, config.deviceKey);
            console.log(`   -> Flushed backlog batch ${item.batchId} (accepted: ${res.accepted})`);
          } catch (e: any) {
            console.error(`   -> Failed flushing backlog batch: ${e.message}`);
          }
        }
      }
    }

    if (isOffline) {
      offlineQueue.push({ batchId, samples: batchSamples });
      console.log(`[OFFLINE] Queued batch ${batchId} (${batchSamples.length} samples, queue size: ${offlineQueue.length})`);
    } else {
      try {
        const res = await uploadBatch(config.url, sessionId, deviceId, batchId, batchSamples, config.deviceKey);
        console.log(
          `[LIVE T+${simTimeSeconds.toFixed(0)}s] Batch #${batchIndex} uploaded (${batchSamples.length} samples) | Speed: ${currentSpeed.toFixed(1)} m/s | Alt: ${currentGpsAlt.toFixed(1)} m | Accepted: ${res.accepted}`
        );
      } catch (err: any) {
        console.error(`Upload error: ${err.message}`);
      }
    }
  };

  // Run continuous loop every 1 second
  setInterval(tick, 1000);
}

run().catch((e) => {
  console.error('Fatal simulator error:', e);
  process.exit(1);
});
