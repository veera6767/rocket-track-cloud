import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import fs from 'fs';
import { SqliteRepository } from '../server/repository.js';
import { SessionManager } from '../server/sessionManager.js';
import { createExpressApp, DEVICE_KEY, VIEWER_KEY, ADMIN_KEY } from '../server/app.js';
import {
  haversineDistance,
  geodeticToEnu,
  interpolateGpsSamples,
  lttbDownsample,
  calculateDeadReckoning,
} from '../shared/math.js';
import { Sample } from '../shared/types.js';

const TEST_DB = './test_telemetry.sqlite';

function createMockSample(
  seq: number,
  t: number,
  lat: number | null = 13.0827,
  lon: number | null = 80.2707,
  gpsFixT: number | null = null
): Sample {
  return {
    seq,
    t,
    accel_x: 0.1,
    accel_y: 0.2,
    accel_z: 9.81,
    gyro_x: 0.01,
    gyro_y: 0.02,
    gyro_z: 0.03,
    mag_x: 35.0,
    mag_y: 12.0,
    mag_z: -15.0,
    roll: 1.5,
    pitch: 2.0,
    yaw: 45.0,
    pressure: null,
    altitude: null,
    prox: 5.0,
    lat,
    lon,
    gps_alt: lat !== null ? 14.5 : null,
    speed: lat !== null ? 5.2 : null,
    sats: 12,
    gps_acc: 3.1,
    bearing: 45.0,
    gps_fix_t: gpsFixT !== null ? gpsFixT : lat !== null ? t : null,
    batt: 85,
    batt_temp: 32.5,
  };
}

describe('Telemetry Repository & Contract Logic', () => {
  let repo: SqliteRepository;

  beforeEach(async () => {
    const files = [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`];
    for (const f of files) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
    repo = new SqliteRepository(TEST_DB);
    await repo.init();
  });

  afterEach(async () => {
    if (repo) {
      await repo.close();
    }
    const files = [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`];
    for (const f of files) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
  });

  it('handles batch idempotency and rejects duplicates on (sessionId, seq)', async () => {
    const session = await repo.createSession('test_ses_1', 'Test Ride', 'phone_1', Date.now());
    expect(session.id).toBe('test_ses_1');

    const batch = [
      createMockSample(0, 1000),
      createMockSample(1, 1010),
      createMockSample(2, 1020),
    ];

    // First insert: 3 accepted, 0 dupes
    const res1 = await repo.insertSamples('test_ses_1', batch);
    expect(res1.accepted).toBe(3);
    expect(res1.duplicates).toBe(0);

    // Second insert of same batch: 0 accepted, 3 dupes
    const res2 = await repo.insertSamples('test_ses_1', batch);
    expect(res2.accepted).toBe(0);
    expect(res2.duplicates).toBe(3);

    const stored = await repo.getSamples('test_ses_1');
    expect(stored.length).toBe(3);
  });

  it('accepts out-of-order batches and stores them correctly ordered by seq', async () => {
    await repo.createSession('test_ses_2', 'Late Batch Ride', 'phone_1', Date.now());

    // Batch 2 arrived before Batch 1
    const batch2 = [createMockSample(3, 1030), createMockSample(4, 1040)];
    const batch1 = [createMockSample(0, 1000), createMockSample(1, 1010), createMockSample(2, 1020)];

    await repo.insertSamples('test_ses_2', batch2);
    await repo.insertSamples('test_ses_2', batch1);

    const samples = await repo.getSamples('test_ses_2');
    expect(samples.length).toBe(5);
    expect(samples.map((s) => s.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('supports downsampling query every=N', async () => {
    await repo.createSession('test_ses_3', 'Downsample Ride', 'phone_1', Date.now());
    const samples = Array.from({ length: 10 }, (_, i) => createMockSample(i, 1000 + i * 10));
    await repo.insertSamples('test_ses_3', samples);

    const every2 = await repo.getSamples('test_ses_3', undefined, undefined, 2);
    expect(every2.map((s) => s.seq)).toEqual([0, 2, 4, 6, 8]);
  });

  it('stores and retrieves optional extra Sample fields (sats_visible, gps_cn0, gps_age_ms)', async () => {
    const session = await repo.createSession('test_extra_f', 'Sounding Extra Fields', 'phone_real_01', Date.now(), 'phone');
    const sampleWithExtra: Sample = {
      ...createMockSample(0, 1000),
      sats_visible: 18,
      gps_cn0: 36.5,
      gps_age_ms: 150,
    };

    const res = await repo.insertSamples(session.id, [sampleWithExtra]);
    expect(res.accepted).toBe(1);

    const fetched = await repo.getSamples(session.id);
    expect(fetched.length).toBe(1);
    expect(fetched[0].sats_visible).toBe(18);
    expect(fetched[0].gps_cn0).toBeCloseTo(36.5, 1);
    expect(fetched[0].gps_age_ms).toBe(150);
  });

  it('distinguishes real phone sessions from simulator sessions and retrieves latest phone session', async () => {
    const simSession = await repo.createSession('sim_ses_01', 'Sim Ride', 'sim_phone_px8_123', 1000, 'sim');
    expect(simSession.source).toBe('sim');

    const phoneSession = await repo.createSession('phone_ses_01', 'Real Phone Flight', 'phone_px8_actual', 2000, 'phone');
    expect(phoneSession.source).toBe('phone');

    const latestPhone = await repo.getLatestPhoneSession();
    expect(latestPhone).not.toBeNull();
    expect(latestPhone?.id).toBe('phone_ses_01');
    expect(latestPhone?.source).toBe('phone');
  });
});

describe('HTTP Endpoints, Roles & Permissions', () => {
  let repo: SqliteRepository;
  let sessionManager: SessionManager;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    const files = [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`];
    for (const f of files) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
    repo = new SqliteRepository(TEST_DB);
    await repo.init();
    sessionManager = new SessionManager(repo);
    const app = createExpressApp(repo, sessionManager);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    sessionManager.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (repo) await repo.close();
  });

  it('verifies /api/health returns ok:true, and ?deep=1 validates database health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.time).toBe('number');

    const deepRes = await fetch(`${baseUrl}/api/health?deep=1`);
    expect(deepRes.status).toBe(200);
    const deepData = await deepRes.json();
    expect(deepData.ok).toBe(true);
  });

  it('validates role identification via /api/whoami', async () => {
    // 1. Viewer key
    const viewerRes = await fetch(`${baseUrl}/api/whoami`, {
      headers: { 'x-viewer-key': VIEWER_KEY },
    });
    expect(viewerRes.status).toBe(200);
    expect((await viewerRes.json()).role).toBe('viewer');

    // 2. Admin key
    const adminRes = await fetch(`${baseUrl}/api/whoami`, {
      headers: { 'x-viewer-key': ADMIN_KEY },
    });
    expect(adminRes.status).toBe(200);
    expect((await adminRes.json()).role).toBe('admin');

    // 3. Invalid key
    const invalidRes = await fetch(`${baseUrl}/api/whoami`, {
      headers: { 'x-viewer-key': 'wrong_key_12345678' },
    });
    expect(invalidRes.status).toBe(401);
  });

  it('enforces role boundaries: viewer cannot delete, device cannot read, admin can do both', async () => {
    // Create session using device key
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DEVICE_KEY,
      },
      body: JSON.stringify({ deviceId: 'test_dev_01', name: 'Perms Test' }),
    });
    expect(createRes.status).toBe(201);
    const { sessionId } = await createRes.json();

    // 1. Viewer attempts DELETE -> 403 Forbidden
    const viewerDel = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'x-viewer-key': VIEWER_KEY },
    });
    expect(viewerDel.status).toBe(403);

    // 2. Viewer attempts to read device config (admin only) -> 403 Forbidden
    const viewerCfg = await fetch(`${baseUrl}/api/config/device`, {
      headers: { 'x-viewer-key': VIEWER_KEY },
    });
    expect(viewerCfg.status).toBe(403);

    // 3. Device key attempts to read sessions (read forbidden for device key) -> 403 Forbidden
    const devRead = await fetch(`${baseUrl}/api/sessions`, {
      headers: { 'x-viewer-key': DEVICE_KEY },
    });
    expect(devRead.status).toBe(403);

    // 4. Admin accesses config & deletes session -> 200 OK
    const adminCfg = await fetch(`${baseUrl}/api/config/device`, {
      headers: { 'x-viewer-key': ADMIN_KEY },
    });
    expect(adminCfg.status).toBe(200);
    const cfgData = await adminCfg.json();
    expect(cfgData.deviceKey).toBe(DEVICE_KEY);

    const adminDel = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'x-viewer-key': ADMIN_KEY },
    });
    expect(adminDel.status).toBe(200);
  });

  it('accepts and decompresses gzip batches via HTTP POST /api/sessions/:id/samples', async () => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DEVICE_KEY,
      },
      body: JSON.stringify({ deviceId: 'phone_gzip_01', name: 'Gzip Test' }),
    });
    const { sessionId } = await createRes.json();

    const payload = JSON.stringify({
      deviceId: 'phone_gzip_01',
      batchId: 'gzip_batch_01',
      samples: [createMockSample(0, 1000), createMockSample(1, 1010)],
    });
    const compressed = zlib.gzipSync(Buffer.from(payload, 'utf-8'));

    const uploadRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/samples`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'x-api-key': DEVICE_KEY,
      },
      body: compressed as any,
    });

    expect(uploadRes.status).toBe(200);
    const result = await uploadRes.json();
    expect(result.accepted).toBe(2);
    expect(result.duplicates).toBe(0);
  });
});

describe('Mathematical Algorithms & Dead Reckoning', () => {
  it('calculates Haversine distance correctly', () => {
    // Chennai to Central Station (~1.5 km)
    const d = haversineDistance(13.0827, 80.2707, 13.0837, 80.2834);
    expect(d).toBeGreaterThan(1300);
    expect(d).toBeLessThan(1500);
  });

  it('converts Geodetic coordinates to local ENU meters correctly', () => {
    const origin = { lat: 13.0827, lon: 80.2707, alt: 10 };
    // Exact origin should be (0, 0, 0)
    const enuZero = geodeticToEnu(origin.lat, origin.lon, origin.alt, origin.lat, origin.lon, origin.alt);
    expect(enuZero.x).toBeCloseTo(0, 3);
    expect(enuZero.y).toBeCloseTo(0, 3);
    expect(enuZero.z).toBeCloseTo(0, 3);

    // +100m altitude should correspond to Y = 100
    const enuUp = geodeticToEnu(origin.lat, origin.lon, 110, origin.lat, origin.lon, origin.alt);
    expect(enuUp.y).toBeCloseTo(100, 3);
  });

  it('calculates dead-reckoning position between 1 Hz GPS fixes', () => {
    const lastFix = {
      lat: 13.0827,
      lon: 80.2707,
      fixTime: 10000,
      speed: 10.0, // 10 m/s
      bearing: 90.0, // heading East
      gps_acc: 5.0,
    };

    // 1 second after fix: should project ~10 meters East
    const dr = calculateDeadReckoning(lastFix, 11000);
    expect(dr.isEstimated).toBe(true);
    expect(dr.dtSeconds).toBe(1.0);
    expect(dr.lon).toBeGreaterThan(lastFix.lon); // Moved East
    expect(dr.lat).toBeCloseTo(lastFix.lat, 4); // Same latitude roughly

    // More than 2 seconds after fix: dead-reckoning must expire
    const drExpired = calculateDeadReckoning(lastFix, 12500);
    expect(drExpired.isEstimated).toBe(false);
    expect(drExpired.lat).toBe(lastFix.lat);
    expect(drExpired.lon).toBe(lastFix.lon);
  });

  it('linearly interpolates lat/lon between 1 Hz GPS fixes using high-rate IMU timestamps', () => {
    const samples: Sample[] = [
      createMockSample(0, 1000, 13.0000, 80.0000, 1000),
      createMockSample(1, 1250, 13.0000, 80.0000, 1000),
      createMockSample(2, 1500, 13.0000, 80.0000, 1000),
      createMockSample(3, 2000, 13.0004, 80.0008, 2000),
    ];

    const interpolated = interpolateGpsSamples(samples);
    expect(interpolated.length).toBe(4);
    // At t=1500 (halfway between t=1000 and t=2000)
    expect(interpolated[2].lat).toBeCloseTo(13.0002, 4);
    expect(interpolated[2].lon).toBeCloseTo(80.0004, 4);
    expect(interpolated[2].isInterpolated).toBe(true);
    expect(interpolated[0].isInterpolated).toBe(false);
  });

  it('handles null GPS and null Barometer gracefully without placeholders', () => {
    const samples: Sample[] = [
      createMockSample(0, 1000, null, null),
      createMockSample(1, 1010, null, null),
      createMockSample(2, 1020, 13.0827, 80.2707),
    ];

    const interpolated = interpolateGpsSamples(samples);
    expect(interpolated[0].lat).toBeNull();
    expect(interpolated[0].pressure).toBeNull(); // Barometer null must never be coerced to 0
    expect(interpolated[0].altitude).toBeNull();
    expect(interpolated[2].lat).toBe(13.0827);
  });

  it('LTTB downsampling preserves bounds and visual peaks', () => {
    const rawData = Array.from({ length: 1000 }, (_, i) => ({
      x: i,
      y: i === 500 ? 999.0 : Math.sin(i * 0.1) * 10,
    }));

    const downsampled = lttbDownsample(
      rawData,
      100,
      (d) => d.x,
      (d) => d.y
    );

    expect(downsampled.length).toBe(100);
    expect(downsampled[0].x).toBe(0);
    expect(downsampled[downsampled.length - 1].x).toBe(999);

    // The extreme spike at x=500 must be retained by LTTB
    const peak = downsampled.find((d) => d.y === 999.0);
    expect(peak).toBeDefined();
  });
});
