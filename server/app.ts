import express, { Request, Response, NextFunction } from 'express';
import zlib from 'zlib';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { z } from 'zod';
import { ITelemetryRepository } from './repository.js';
import { SessionManager } from './sessionManager.js';
import { Sample } from '../shared/types.js';

export const DEVICE_KEY = process.env.DEVICE_KEY || 'rocket_device_secret_2026';
export const VIEWER_KEY = process.env.VIEWER_KEY || 'ground_station_viewer_2026';
export const ADMIN_KEY = process.env.ADMIN_KEY || 'rocket_admin_supersecret_2026';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['req.headers["x-api-key"]', 'req.headers["x-viewer-key"]', 'key', 'deviceKey', 'adminKey'],
});

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function timingSafeCompare(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isDeviceAuthorized(key?: string | null): boolean {
  return timingSafeCompare(key, DEVICE_KEY) || timingSafeCompare(key, ADMIN_KEY);
}

export function isViewerAuthorized(key?: string | null): boolean {
  return timingSafeCompare(key, VIEWER_KEY) || timingSafeCompare(key, ADMIN_KEY);
}

export function isAdminAuthorized(key?: string | null): boolean {
  return timingSafeCompare(key, ADMIN_KEY);
}

// Zod schemas for strict contract validation (with passthrough for extra unknown fields)
const sampleSchema = z.object({
  seq: z.number().int(),
  t: z.number().int(),
  accel_x: z.number(),
  accel_y: z.number(),
  accel_z: z.number(),
  gyro_x: z.number(),
  gyro_y: z.number(),
  gyro_z: z.number(),
  mag_x: z.number(),
  mag_y: z.number(),
  mag_z: z.number(),
  roll: z.number(),
  pitch: z.number(),
  yaw: z.number(),
  pressure: z.number().nullable(),
  altitude: z.number().nullable(),
  prox: z.number().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  gps_alt: z.number().nullable(),
  speed: z.number().nullable(),
  sats: z.number().int().nullable(),
  gps_acc: z.number().nullable(),
  bearing: z.number().nullable(),
  gps_fix_t: z.number().int().nullable(),
  batt: z.number(),
  batt_temp: z.number(),
  sats_visible: z.number().int().nullable().optional(),
  gps_cn0: z.number().nullable().optional(),
  gps_age_ms: z.number().int().nullable().optional(),
}).passthrough();

const createSessionSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().optional(),
  source: z.enum(['phone', 'sim', 'fc']).optional(),
}).passthrough();

const samplesBatchSchema = z.object({
  deviceId: z.string().min(1),
  batchId: z.string().min(1),
  samples: z.array(sampleSchema),
}).passthrough();

export function createExpressApp(repo: ITelemetryRepository, sessionManager: SessionManager) {
  const app = express();

  // Trust proxy for Render and cloud load balancers
  app.set('trust proxy', 1);

  // Helmet security headers (configured for WebSockets, CDN maps, and Fonts)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // IP Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3000, // Up to 3000 req/min for high-frequency sensor streaming
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too Many Requests' },
  });
  app.use('/api/', limiter);

  // CORS headers
  const configuredCors = process.env.CORS_ORIGINS;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (configuredCors && configuredCors !== '*') {
      const allowed = configuredCors.split(',').map((s) => s.trim());
      if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding, x-api-key, x-viewer-key');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Gzip decompression & JSON parsing middleware (~5MB size limit)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentEncoding = req.headers['content-encoding'];
    if (contentEncoding === 'gzip') {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_SIZE) {
          req.destroy(new Error('Payload too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          const decompressed = zlib.gunzipSync(buffer);
          req.body = JSON.parse(decompressed.toString('utf-8'));
          next();
        } catch (err: any) {
          res.status(400).json({ error: `Failed to decompress gzip body: ${err.message}` });
        }
      });

      req.on('error', (err) => {
        res.status(400).json({ error: `Stream error: ${err.message}` });
      });
    } else {
      express.json({ limit: '5mb' })(req, res, next);
    }
  });

  // Auth middlewares
  const requireDeviceKey = (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-api-key'] as string;
    if (!key || !isDeviceAuthorized(key)) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing device x-api-key' });
      return;
    }
    next();
  };

  const requireViewerKey = (req: Request, res: Response, next: NextFunction) => {
    const key =
      (req.headers['x-viewer-key'] as string) ||
      (req.query.key as string) ||
      (req.headers['x-api-key'] as string);

    // If caller passed a plain device key that is not admin, forbid read access
    if (key && timingSafeCompare(key, DEVICE_KEY) && !isAdminAuthorized(key)) {
      res.status(403).json({ error: 'Forbidden: Device key cannot access viewer endpoints' });
      return;
    }

    if (!key || (!isViewerAuthorized(key) && !isAdminAuthorized(key))) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid viewer key' });
      return;
    }
    next();
  };

  const requireAdminKey = (req: Request, res: Response, next: NextFunction) => {
    const key =
      (req.headers['x-viewer-key'] as string) ||
      (req.headers['x-api-key'] as string) ||
      (req.query.key as string);

    if (key && isViewerAuthorized(key) && !isAdminAuthorized(key)) {
      res.status(403).json({ error: 'Forbidden: Admin key required for this operation' });
      return;
    }

    if (!key || !isAdminAuthorized(key)) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid admin key' });
      return;
    }
    next();
  };

  // 1. GET /api/health -> { ok: true, time } (Public, deep=1 checks DB)
  app.get('/api/health', async (req: Request, res: Response) => {
    const isDeep = req.query.deep === '1';
    let ok = true;
    if (isDeep) {
      ok = await repo.checkHealth();
    }
    res.json({ ok, time: Date.now() });
  });

  // 2. GET /api/whoami -> { role: "viewer" | "admin" }
  app.get('/api/whoami', (req: Request, res: Response) => {
    const key =
      (req.headers['x-viewer-key'] as string) ||
      (req.headers['x-api-key'] as string) ||
      (req.query.key as string);

    if (isAdminAuthorized(key)) {
      return res.json({ role: 'admin' });
    }
    if (isViewerAuthorized(key)) {
      return res.json({ role: 'viewer' });
    }
    res.status(401).json({ error: 'Unauthorized: Invalid viewer or admin key' });
  });

  // 3. POST /api/sessions -> { sessionId, startedAt }
  app.post('/api/sessions', requireDeviceKey, async (req: Request, res: Response) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { deviceId, name, source } = parsed.data as {
      deviceId: string;
      name?: string;
      source?: 'phone' | 'sim' | 'fc';
    };
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startedAt = Date.now();
    const sessionName = name || `Sounding Test ${new Date().toISOString().substring(0, 16).replace('T', ' ')}`;

    const isSim =
      source === 'sim' ||
      deviceId.toLowerCase().startsWith('sim') ||
      deviceId.toLowerCase().includes('simulator');
    const sessionSource: 'phone' | 'sim' | 'fc' = source || (isSim ? 'sim' : 'phone');

    // If device creates a session while another is open for same deviceId, end old session
    await repo.endOldSessionsForDevice(deviceId);

    const record = await repo.createSession(sessionId, sessionName, deviceId, startedAt, sessionSource);
    sessionManager.onSessionStarted(record);
    logger.info({ sessionId, sessionName, deviceId, sessionSource }, '[API] Session started');
    res.status(201).json({ sessionId: record.id, startedAt: record.startedAt, source: record.source });
  });

  // 4. POST /api/sessions/:id/end -> { ok: true }
  app.post('/api/sessions/:id/end', requireDeviceKey, async (req: Request, res: Response) => {
    const { id } = req.params;
    const ok = await repo.endSession(id);
    logger.info({ sessionId: id, ok }, '[API] Session ended');
    res.json({ ok });
  });

  // 5. POST /api/sessions/:id/samples -> { accepted: n, duplicates: n }
  app.post('/api/sessions/:id/samples', requireDeviceKey, async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = await repo.getSession(id);
    if (!session) {
      res.status(404).json({ error: `Session ${id} not found` });
      return;
    }

    const parsed = samplesBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const { samples, batchId, deviceId } = parsed.data;
    const now = Date.now();

    // Insert into DB (idempotent ON CONFLICT DO NOTHING)
    const result = await repo.insertSamples(id, samples as Sample[]);

    // Compute ingest latency (receive time minus sample t of latest sample)
    const latestSampleT = samples.length > 0 ? samples[samples.length - 1].t : now;
    const latencyMs = Math.max(0, now - latestSampleT);

    logger.info(
      {
        sessionId: id,
        batchId,
        sampleCount: samples.length,
        accepted: result.accepted,
        duplicates: result.duplicates,
        latencyMs,
      },
      '[Ingest] Batch received'
    );

    // Fan-out to connected WebSocket viewers
    const isBackfill = latencyMs > 5000;
    await sessionManager.onNewSamples(id, samples as Sample[], isBackfill, deviceId);

    res.json(result);
  });

  // 6. GET /api/sessions -> list of sessions
  app.get('/api/sessions', requireViewerKey, async (_req: Request, res: Response) => {
    const list = await repo.getSessions();
    res.json(list);
  });

  // 7. GET /api/sessions/:id/samples?from=<seq>&to=<seq>&every=<N>
  app.get('/api/sessions/:id/samples', requireViewerKey, async (req: Request, res: Response) => {
    let { id } = req.params;
    if (id === 'latest-phone') {
      const latestPhone = await repo.getLatestPhoneSession();
      if (!latestPhone) {
        res.json({ samples: [] });
        return;
      }
      id = latestPhone.id;
    } else if (id === 'latest') {
      const latest = (await repo.getLatestPhoneSession()) || (await repo.getLatestSession());
      if (!latest) {
        res.json({ samples: [] });
        return;
      }
      id = latest.id;
    }

    const fromSeq = req.query.from !== undefined ? parseInt(req.query.from as string, 10) : undefined;
    const toSeq = req.query.to !== undefined ? parseInt(req.query.to as string, 10) : undefined;
    const every = req.query.every !== undefined ? Math.max(1, parseInt(req.query.every as string, 10)) : 1;

    const samples = await repo.getSamples(id, fromSeq, toSeq, every);
    res.json({ samples });
  });

  // 8. GET /api/sessions/:id/export.csv
  app.get('/api/sessions/:id/export.csv', requireViewerKey, async (req: Request, res: Response) => {
    let { id } = req.params;
    if (id === 'latest-phone') {
      const latestPhone = await repo.getLatestPhoneSession();
      if (!latestPhone) {
        res.status(404).send('No phone session found');
        return;
      }
      id = latestPhone.id;
    } else if (id === 'latest') {
      const latest = (await repo.getLatestPhoneSession()) || (await repo.getLatestSession());
      if (!latest) {
        res.status(404).send('No session found');
        return;
      }
      id = latest.id;
    }

    const session = await repo.getSession(id);
    if (!session) {
      res.status(404).send('Session not found');
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rocket_track_${id}.csv"`);

    const header = [
      'seq', 't', 'accel_x', 'accel_y', 'accel_z',
      'gyro_x', 'gyro_y', 'gyro_z', 'mag_x', 'mag_y', 'mag_z',
      'roll', 'pitch', 'yaw', 'pressure', 'altitude', 'prox',
      'lat', 'lon', 'gps_alt', 'speed', 'sats', 'gps_acc',
      'bearing', 'gps_fix_t', 'batt', 'batt_temp',
      'sats_visible', 'gps_cn0', 'gps_age_ms'
    ].join(',');

    res.write(header + '\n');

    await repo.streamSamples(id, (sample: Sample) => {
      const row = [
        sample.seq,
        sample.t,
        sample.accel_x,
        sample.accel_y,
        sample.accel_z,
        sample.gyro_x,
        sample.gyro_y,
        sample.gyro_z,
        sample.mag_x,
        sample.mag_y,
        sample.mag_z,
        sample.roll,
        sample.pitch,
        sample.yaw,
        sample.pressure ?? '',
        sample.altitude ?? '',
        sample.prox ?? '',
        sample.lat ?? '',
        sample.lon ?? '',
        sample.gps_alt ?? '',
        sample.speed ?? '',
        sample.sats ?? '',
        sample.gps_acc ?? '',
        sample.bearing ?? '',
        sample.gps_fix_t ?? '',
        sample.batt,
        sample.batt_temp,
        sample.sats_visible ?? '',
        sample.gps_cn0 ?? '',
        sample.gps_age_ms ?? ''
      ].join(',');
      res.write(row + '\n');
    });

    res.end();
  });

  // 9. DELETE /api/sessions/:id (Admin only)
  app.delete('/api/sessions/:id', requireAdminKey, async (req: Request, res: Response) => {
    const { id } = req.params;
    const ok = await repo.deleteSession(id);
    logger.info({ sessionId: id, ok }, '[API] Session deleted by admin');
    res.json({ ok });
  });

  // 10. GET /api/config/device (Admin only) -> { deviceKey, deviceId }
  app.get('/api/config/device', requireAdminKey, (_req: Request, res: Response) => {
    res.json({
      deviceKey: DEVICE_KEY,
      deviceId: 'phone_' + Math.random().toString(36).substring(2, 8),
    });
  });

  return app;
}
