import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { SqliteRepository } from '../server/repository.js';
import { SessionManager } from '../server/sessionManager.js';
import { createExpressApp, isViewerAuthorized, DEVICE_KEY, VIEWER_KEY, ADMIN_KEY } from '../server/app.js';
import {
  haversineDistance,
  geodeticToEnu,
  interpolateGpsSamples,
  lttbDownsample,
  calculateDeadReckoning,
  inferSeqStep,
  calculatePacketLoss,
  calculateStartGpsAltitude,
  deriveSessionStats,
} from '../shared/math.js';
import { Sample, WsServerMessage } from '../shared/types.js';

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

describe('Packet Loss & Seq Step Inference', () => {
  it('infers seqStep correctly from decimated stream deltas', () => {
    // 100 Hz downsampled to 20 Hz gives deltas of 5
    const samples = [
      createMockSample(0, 1000),
      createMockSample(5, 1050),
      createMockSample(10, 1100),
      createMockSample(15, 1150),
      createMockSample(20, 1200),
    ];
    expect(inferSeqStep(samples)).toBe(5);

    // Standard 100 Hz stream gives deltas of 1
    const normalSamples = [
      createMockSample(0, 1000),
      createMockSample(1, 1010),
      createMockSample(2, 1020),
    ];
    expect(inferSeqStep(normalSamples)).toBe(1);
  });

  it('unit test: seq 0, 5, 10, 20 means exactly one lost sample', () => {
    const samples = [
      createMockSample(0, 1000),
      createMockSample(5, 1050),
      createMockSample(10, 1100),
      createMockSample(20, 1200), // Jump by 10 (seq 15 was lost)
    ];

    const stats = calculatePacketLoss(samples);
    expect(stats.step).toBe(5);
    expect(stats.received).toBe(4);
    expect(stats.lost).toBe(1); // Exactly one lost sample
    expect(stats.lossPct).toBeCloseTo(20.0, 1);
  });

  it('reports 0% packet loss for clean decimated 20 Hz stream', () => {
    const samples = [
      createMockSample(0, 1000),
      createMockSample(5, 1050),
      createMockSample(10, 1100),
      createMockSample(15, 1150),
      createMockSample(20, 1200),
    ];

    const stats = calculatePacketLoss(samples, 5);
    expect(stats.step).toBe(5);
    expect(stats.lost).toBe(0);
    expect(stats.lossPct).toBe(0.0);
  });
});

describe('Altitude & Height Above Start Calculations', () => {
  it('calculates start GPS altitude as the median of the first 5 valid fixes', () => {
    const samples = [
      createMockSample(0, 1000),
      createMockSample(1, 1050),
      createMockSample(2, 1100),
      createMockSample(3, 1150),
      createMockSample(4, 1200),
    ];

    // South India WGS-84 ellipsoid altitudes (~ -64m)
    samples[0].gps_alt = -64.2;
    samples[1].gps_alt = -63.8;
    samples[2].gps_alt = -64.0;
    samples[3].gps_alt = -64.5;
    samples[4].gps_alt = -63.9;
    // Sorted: -64.5, -64.2, -64.0, -63.9, -63.8 -> median is -64.0

    const startAlt = calculateStartGpsAltitude(samples);
    expect(startAlt).toBe(-64.0);
  });

  it('ignores null gps_alt samples when computing start altitude', () => {
    const samples = [
      createMockSample(0, 1000),
      createMockSample(1, 1050),
      createMockSample(2, 1100),
      createMockSample(3, 1150),
      createMockSample(4, 1200),
      createMockSample(5, 1250),
    ];
    samples[0].gps_alt = null; // No 3D fix yet
    samples[1].gps_alt = -64.0;
    samples[2].gps_alt = -64.0;
    samples[3].gps_alt = -64.0;
    samples[4].gps_alt = -64.0;
    samples[5].gps_alt = -64.0;

    const startAlt = calculateStartGpsAltitude(samples);
    expect(startAlt).toBe(-64.0);
  });

  it('computes heightAboveStart in interpolateGpsSamples relative to start altitude', () => {
    const samples = [
      createMockSample(0, 1000, 13.0, 80.0),
      createMockSample(1, 2000, 13.0, 80.0),
    ];
    samples[0].gps_alt = -64.0;
    samples[1].gps_alt = -44.0; // Climbed +20m

    const interpolated = interpolateGpsSamples(samples, -64.0);
    expect(interpolated[0].heightAboveStart).toBeCloseTo(0.0, 1);
    expect(interpolated[1].heightAboveStart).toBeCloseTo(20.0, 1);
  });

  it('derives session stats with maxAltitude relative to start altitude', () => {
    const samples = [
      createMockSample(0, 1000, 13.0, 80.0),
      createMockSample(1, 1010, 13.0, 80.0),
      createMockSample(2, 1020, 13.0, 80.0),
      createMockSample(3, 1030, 13.0, 80.0),
      createMockSample(4, 1040, 13.0, 80.0),
      createMockSample(5, 2000, 13.0, 80.0),
    ];
    samples[0].gps_alt = -64.0;
    samples[1].gps_alt = -64.0;
    samples[2].gps_alt = -64.0;
    samples[3].gps_alt = -64.0;
    samples[4].gps_alt = -64.0;
    samples[5].gps_alt = -34.0; // +30m

    const stats = deriveSessionStats(samples, 1);
    expect(stats.startAltitudeMeters).toBe(-64.0);
    expect(stats.maxAltitudeMeters).toBeCloseTo(30.0, 1);
    expect(stats.seqStep).toBe(1);
    expect(stats.lossPct).toBe(0.0);
  });
});

describe('Live WebSocket Telemetry Stream & Staleness', () => {
  let repo: SqliteRepository;
  let sessionManager: SessionManager;
  let server: http.Server;
  let wss: WebSocketServer;
  let wsUrl: string;

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

    server = http.createServer(app);
    wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      const key = url.searchParams.get('key');
      if (!isViewerAuthorized(key)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        sessionManager.handleConnection(ws, url.searchParams.get('session'));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        wsUrl = `ws://127.0.0.1:${addr.port}/ws?key=${VIEWER_KEY}&session=latest`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    wss.close();
    sessionManager.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (repo) await repo.close();
  });

  it('connects to WebSocket, receives hello message and stream updates for moving GPS fixes', async () => {
    const session = await repo.createSession('live_test_ses', 'Moving Flight', 'phone_live_1', Date.now(), 'phone');
    const targetWsUrl = `${wsUrl.split('&session=')[0]}&session=${session.id}`;
    const client = new WebSocket(targetWsUrl);

    const receivedMessages: WsServerMessage[] = [];
    client.on('message', (raw) => {
      try {
        receivedMessages.push(JSON.parse(raw.toString()));
      } catch {}
    });

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    // Ingest moving GPS fixes with seqStep: 5
    const movingSamples = [
      {
        ...createMockSample(0, Date.now() - 50, 13.0827, 80.2707, Date.now() - 50),
        speed: 4.5,
        gps_acc: 3.2,
        gps_provider: 'gps',
      },
      {
        ...createMockSample(5, Date.now(), 13.0835, 80.2715, Date.now()),
        speed: 5.1,
        gps_acc: 2.8,
        gps_provider: 'gps',
      },
    ];

    await sessionManager.ingestSamples(session.id, movingSamples, 5);

    // Wait for batch message
    const batchMsg = await new Promise<WsServerMessage>((resolve, reject) => {
      const checkExisting = receivedMessages.find((m) => m.type === 'batch');
      if (checkExisting) return resolve(checkExisting);

      const timer = setTimeout(() => reject(new Error('Timeout waiting for batch')), 4000);
      const onMsg = (raw: any) => {
        const msg = JSON.parse(raw.toString()) as WsServerMessage;
        if (msg.type === 'batch') {
          clearTimeout(timer);
          client.off('message', onMsg);
          resolve(msg);
        }
      };
      client.on('message', onMsg);
    });

    expect(batchMsg.type).toBe('batch');
    if (batchMsg.type === 'batch') {
      expect(batchMsg.samples.length).toBe(2);
      expect(batchMsg.seqStep).toBe(5);
      expect(batchMsg.samples[1].lat).toBeCloseTo(13.0835, 4);
      expect(batchMsg.samples[1].speed).toBeCloseTo(5.1, 1);
      expect(batchMsg.samples[1].gps_provider).toBe('gps');
    }

    client.close();
  });

  it('detects and broadcasts stale GPS fix when last fix is older than 3 seconds', async () => {
    const session = await repo.createSession('stale_test_ses', 'Stale GPS Flight', 'phone_stale_1', Date.now(), 'phone');
    const targetWsUrl = `${wsUrl.split('&session=')[0]}&session=${session.id}`;
    const client = new WebSocket(targetWsUrl);

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    // Send sample where GPS fix was 5 seconds ago
    const staleFixTime = Date.now() - 5000;
    const staleSamples = [
      createMockSample(0, Date.now(), 13.0827, 80.2707, staleFixTime),
    ];

    await sessionManager.ingestSamples(session.id, staleSamples, 1);

    // Wait for status message
    const statusMsg = await new Promise<WsServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for status message')), 4000);
      const handler = (raw: any) => {
        const msg = JSON.parse(raw.toString()) as WsServerMessage;
        if (msg.type === 'status' && msg.gps?.ageMs !== undefined && msg.gps?.ageMs !== null) {
          clearTimeout(timer);
          client.off('message', handler);
          resolve(msg);
        }
      };
      client.on('message', handler);
    });

    expect(statusMsg.type).toBe('status');
    if (statusMsg.type === 'status') {
      expect(statusMsg.gps?.ageMs).toBeGreaterThanOrEqual(4000);
    }

    client.close();
  });

  it('reports zero rate when data stream stops', async () => {
    const session = await repo.createSession('stop_test_ses', 'Stopped Stream', 'phone_stop_1', Date.now(), 'phone');
    const targetWsUrl = `${wsUrl.split('&session=')[0]}&session=${session.id}`;
    const client = new WebSocket(targetWsUrl);

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    // Feed a sample
    await sessionManager.ingestSamples(session.id, [createMockSample(0, Date.now())], 1);

    // Wait for status message reporting ratePerSec === 0
    const statusMsg = await new Promise<WsServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for zero ratePerSec')), 5000);
      const handler = (raw: any) => {
        const msg = JSON.parse(raw.toString()) as WsServerMessage;
        if (msg.type === 'status' && msg.ratePerSec === 0) {
          clearTimeout(timer);
          client.off('message', handler);
          resolve(msg);
        }
      };
      client.on('message', handler);
    });

    expect(statusMsg.type).toBe('status');
    if (statusMsg.type === 'status') {
      expect(statusMsg.ratePerSec).toBe(0);
    }

    client.close();
  });
});
