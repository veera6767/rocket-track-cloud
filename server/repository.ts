import { Sample, SessionRecord, Bounds } from '../shared/types.js';
import Database from 'better-sqlite3';
import pg from 'pg';

export interface ITelemetryRepository {
  init(): Promise<void>;
  checkHealth(): Promise<boolean>;
  createSession(id: string, name: string, deviceId: string, startedAt: number, source?: 'phone' | 'sim' | 'fc'): Promise<SessionRecord>;
  endSession(id: string): Promise<boolean>;
  insertSamples(sessionId: string, samples: Sample[]): Promise<{ accepted: number; duplicates: number }>;
  getSessions(): Promise<SessionRecord[]>;
  getSession(id: string): Promise<SessionRecord | null>;
  getLatestSession(): Promise<SessionRecord | null>;
  getLatestPhoneSession(): Promise<SessionRecord | null>;
  getSamples(sessionId: string, fromSeq?: number, toSeq?: number, every?: number): Promise<Sample[]>;
  streamSamples(sessionId: string, onRow: (sample: Sample) => Promise<void> | void): Promise<void>;
  deleteSession(id: string): Promise<boolean>;
  cleanupOldSessions(days: number): Promise<number>;
  endOldSessionsForDevice(deviceId: string, excludeSessionId?: string): Promise<void>;
  autoEndInactiveSessions(timeoutMs: number): Promise<string[]>;
  close?(): Promise<void>;
}

export class SqliteRepository implements ITelemetryRepository {
  private db: Database.Database;

  constructor(filePath: string = './telemetry.sqlite') {
    this.db = new Database(filePath);
    // WAL mode for high concurrent throughput
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  async close(): Promise<void> {
    if (this.db && this.db.open) {
      this.db.close();
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source TEXT DEFAULT 'phone',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        sample_count INTEGER DEFAULT 0,
        min_lat REAL,
        max_lat REAL,
        min_lon REAL,
        max_lon REAL
      );

      CREATE TABLE IF NOT EXISTS samples (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        t INTEGER NOT NULL,
        accel_x REAL NOT NULL,
        accel_y REAL NOT NULL,
        accel_z REAL NOT NULL,
        gyro_x REAL NOT NULL,
        gyro_y REAL NOT NULL,
        gyro_z REAL NOT NULL,
        mag_x REAL NOT NULL,
        mag_y REAL NOT NULL,
        mag_z REAL NOT NULL,
        roll REAL NOT NULL,
        pitch REAL NOT NULL,
        yaw REAL NOT NULL,
        pressure REAL,
        altitude REAL,
        prox REAL,
        lat REAL,
        lon REAL,
        gps_alt REAL,
        speed REAL,
        sats INTEGER,
        gps_acc REAL,
        bearing REAL,
        gps_fix_t INTEGER,
        batt INTEGER NOT NULL,
        batt_temp REAL NOT NULL,
        sats_visible INTEGER,
        gps_cn0 REAL,
        gps_age_ms INTEGER,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_samples_session_seq ON samples (session_id, seq);
      CREATE INDEX IF NOT EXISTS idx_samples_session_t ON samples (session_id, t);
    `);

    // Migrations for existing databases
    try { this.db.exec("ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'phone'"); } catch {}
    try { this.db.exec("ALTER TABLE samples ADD COLUMN sats_visible INTEGER"); } catch {}
    try { this.db.exec("ALTER TABLE samples ADD COLUMN gps_cn0 REAL"); } catch {}
    try { this.db.exec("ALTER TABLE samples ADD COLUMN gps_age_ms INTEGER"); } catch {}
  }

  async createSession(id: string, name: string, deviceId: string, startedAt: number, source?: 'phone' | 'sim' | 'fc'): Promise<SessionRecord> {
    const isSim = source === 'sim' || deviceId.toLowerCase().startsWith('sim') || deviceId.toLowerCase().includes('simulator');
    const finalSource: 'phone' | 'sim' | 'fc' = source || (isSim ? 'sim' : 'phone');

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, device_id, source, started_at, sample_count)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
    stmt.run(id, name, deviceId, finalSource, startedAt);
    return {
      id,
      name,
      deviceId,
      source: finalSource,
      startedAt,
      endedAt: null,
      sampleCount: 0,
      bounds: null,
    };
  }

  async endSession(id: string): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL
    `);
    const res = stmt.run(Date.now(), id);
    return res.changes > 0;
  }

  async endOldSessionsForDevice(deviceId: string, excludeSessionId?: string): Promise<void> {
    if (excludeSessionId) {
      const stmt = this.db.prepare(`
        UPDATE sessions SET ended_at = ? WHERE device_id = ? AND ended_at IS NULL AND id != ?
      `);
      stmt.run(Date.now(), deviceId, excludeSessionId);
    } else {
      const stmt = this.db.prepare(`
        UPDATE sessions SET ended_at = ? WHERE device_id = ? AND ended_at IS NULL
      `);
      stmt.run(Date.now(), deviceId);
    }
  }

  async autoEndInactiveSessions(timeoutMs: number): Promise<string[]> {
    const threshold = Date.now() - timeoutMs;
    const rows = this.db.prepare(`
      SELECT s.id, MAX(COALESCE(m.max_t, s.started_at)) as last_activity
      FROM sessions s
      LEFT JOIN (
        SELECT session_id, MAX(t) as max_t FROM samples GROUP BY session_id
      ) m ON s.id = m.session_id
      WHERE s.ended_at IS NULL
      GROUP BY s.id
      HAVING last_activity < ?
    `).all(threshold) as { id: string }[];

    const endedIds: string[] = [];
    const endStmt = this.db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`);
    const now = Date.now();
    for (const r of rows) {
      endStmt.run(now, r.id);
      endedIds.push(r.id);
    }
    return endedIds;
  }

  async insertSamples(sessionId: string, samples: Sample[]): Promise<{ accepted: number; duplicates: number }> {
    if (samples.length === 0) return { accepted: 0, duplicates: 0 };

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO samples (
        session_id, seq, t, accel_x, accel_y, accel_z,
        gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z,
        roll, pitch, yaw, pressure, altitude, prox,
        lat, lon, gps_alt, speed, sats, gps_acc,
        bearing, gps_fix_t, batt, batt_temp,
        sats_visible, gps_cn0, gps_age_ms
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    let accepted = 0;
    let minLat: number | null = null;
    let maxLat: number | null = null;
    let minLon: number | null = null;
    let maxLon: number | null = null;

    const tx = this.db.transaction(() => {
      for (const s of samples) {
        const info = insertStmt.run(
          sessionId, s.seq, s.t, s.accel_x, s.accel_y, s.accel_z,
          s.gyro_x, s.gyro_y, s.gyro_z, s.mag_x, s.mag_y, s.mag_z,
          s.roll, s.pitch, s.yaw, s.pressure, s.altitude, s.prox,
          s.lat, s.lon, s.gps_alt, s.speed, s.sats, s.gps_acc,
          s.bearing, s.gps_fix_t, s.batt, s.batt_temp,
          s.sats_visible ?? null, s.gps_cn0 ?? null, s.gps_age_ms ?? null
        );
        if (info.changes > 0) {
          accepted++;
          if (s.lat !== null && s.lon !== null) {
            if (minLat === null || s.lat < minLat) minLat = s.lat;
            if (maxLat === null || s.lat > maxLat) maxLat = s.lat;
            if (minLon === null || s.lon < minLon) minLon = s.lon;
            if (maxLon === null || s.lon > maxLon) maxLon = s.lon;
          }
        }
      }

      if (accepted > 0) {
        this.db.prepare(`
          UPDATE sessions SET
            sample_count = sample_count + ?,
            min_lat = CASE WHEN min_lat IS NULL OR ? < min_lat THEN ? ELSE min_lat END,
            max_lat = CASE WHEN max_lat IS NULL OR ? > max_lat THEN ? ELSE max_lat END,
            min_lon = CASE WHEN min_lon IS NULL OR ? < min_lon THEN ? ELSE min_lon END,
            max_lon = CASE WHEN max_lon IS NULL OR ? > max_lon THEN ? ELSE max_lon END
          WHERE id = ?
        `).run(
          accepted,
          minLat, minLat,
          maxLat, maxLat,
          minLon, minLon,
          maxLon, maxLon,
          sessionId
        );
      }
    });

    tx();
    const duplicates = samples.length - accepted;
    return { accepted, duplicates };
  }

  async getSessions(): Promise<SessionRecord[]> {
    const rows = this.db.prepare(`
      SELECT id, name, device_id as deviceId, source, started_at as startedAt,
             ended_at as endedAt, sample_count as sampleCount,
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      ORDER BY started_at DESC
    `).all() as any[];

    return rows.map((r) => {
      const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
      return {
        id: r.id,
        name: r.name,
        deviceId: r.deviceId,
        source: isSim ? 'sim' : 'phone',
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        sampleCount: r.sampleCount,
        bounds: r.min_lat !== null ? {
          minLat: r.min_lat,
          maxLat: r.max_lat,
          minLon: r.min_lon,
          maxLon: r.max_lon,
        } : null,
      };
    });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const r = this.db.prepare(`
      SELECT id, name, device_id as deviceId, source, started_at as startedAt,
             ended_at as endedAt, sample_count as sampleCount,
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      WHERE id = ?
    `).get(id) as any;

    if (!r) return null;
    const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
    return {
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      source: isSim ? 'sim' : 'phone',
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      sampleCount: r.sampleCount,
      bounds: r.min_lat !== null ? {
        minLat: r.min_lat,
        maxLat: r.max_lat,
        minLon: r.min_lon,
        maxLon: r.max_lon,
      } : null,
    };
  }

  async getLatestSession(): Promise<SessionRecord | null> {
    const r = this.db.prepare(`
      SELECT id, name, device_id as deviceId, source, started_at as startedAt,
             ended_at as endedAt, sample_count as sampleCount,
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as any;

    if (!r) return null;
    const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
    return {
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      source: isSim ? 'sim' : 'phone',
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      sampleCount: r.sampleCount,
      bounds: r.min_lat !== null ? {
        minLat: r.min_lat,
        maxLat: r.max_lat,
        minLon: r.min_lon,
        maxLon: r.max_lon,
      } : null,
    };
  }

  async getLatestPhoneSession(): Promise<SessionRecord | null> {
    const r = this.db.prepare(`
      SELECT id, name, device_id as deviceId, source, started_at as startedAt,
             ended_at as endedAt, sample_count as sampleCount,
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      WHERE (source = 'phone' OR (source IS NULL AND device_id NOT LIKE 'sim%' AND device_id NOT LIKE '%simulator%'))
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as any;

    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      source: 'phone',
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      sampleCount: r.sampleCount,
      bounds: r.min_lat !== null ? {
        minLat: r.min_lat,
        maxLat: r.max_lat,
        minLon: r.min_lon,
        maxLon: r.max_lon,
      } : null,
    };
  }

  async getSamples(sessionId: string, fromSeq?: number, toSeq?: number, every: number = 1): Promise<Sample[]> {
    let query = `
      SELECT seq, t, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z,
             mag_x, mag_y, mag_z, roll, pitch, yaw, pressure, altitude, prox,
             lat, lon, gps_alt, speed, sats, gps_acc, bearing, gps_fix_t,
             batt, batt_temp, sats_visible, gps_cn0, gps_age_ms
      FROM samples
      WHERE session_id = ?
    `;
    const params: any[] = [sessionId];

    if (fromSeq !== undefined) {
      query += ` AND seq >= ?`;
      params.push(fromSeq);
    }
    if (toSeq !== undefined) {
      query += ` AND seq <= ?`;
      params.push(toSeq);
    }

    if (every > 1) {
      query += ` AND (seq % ?) = 0`;
      params.push(every);
    }

    query += ` ORDER BY seq ASC`;

    return this.db.prepare(query).all(...params) as Sample[];
  }

  async streamSamples(sessionId: string, onRow: (sample: Sample) => Promise<void> | void): Promise<void> {
    const stmt = this.db.prepare(`
      SELECT seq, t, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z,
             mag_x, mag_y, mag_z, roll, pitch, yaw, pressure, altitude, prox,
             lat, lon, gps_alt, speed, sats, gps_acc, bearing, gps_fix_t,
             batt, batt_temp, sats_visible, gps_cn0, gps_age_ms
      FROM samples
      WHERE session_id = ?
      ORDER BY seq ASC
    `);

    for (const row of stmt.iterate(sessionId)) {
      await onRow(row as Sample);
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    const delSamples = this.db.prepare(`DELETE FROM samples WHERE session_id = ?`);
    delSamples.run(id);
    const delSession = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);
    const res = delSession.run(id);
    return res.changes > 0;
  }

  async cleanupOldSessions(days: number): Promise<number> {
    const cutoff = Date.now() - days * 86400 * 1000;
    const oldSessions = this.db.prepare(`
      SELECT id FROM sessions WHERE started_at < ?
    `).all(cutoff) as { id: string }[];

    for (const s of oldSessions) {
      await this.deleteSession(s.id);
    }
    return oldSessions.length;
  }

  async getActiveSessions(): Promise<SessionRecord[]> {
    const rows = this.db.prepare(`
      SELECT id, name, device_id as deviceId, source, started_at as startedAt,
             ended_at as endedAt, sample_count as sampleCount,
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      WHERE ended_at IS NULL
    `).all() as any[];

    return rows.map((r) => {
      const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
      return {
        id: r.id,
        name: r.name,
        deviceId: r.deviceId,
        source: isSim ? 'sim' : 'phone',
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        sampleCount: r.sampleCount,
        bounds: r.min_lat !== null ? {
          minLat: r.min_lat,
          maxLat: r.max_lat,
          minLon: r.min_lon,
          maxLon: r.max_lon,
        } : null,
      };
    });
  }
}

export class PostgresRepository implements ITelemetryRepository {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const isSslNeeded = connectionString.includes('sslmode=') ||
      connectionString.includes('neon.tech') ||
      connectionString.includes('supabase.co') ||
      process.env.NODE_ENV === 'production';

    this.pool = new pg.Pool({
      connectionString,
      ssl: isSslNeeded ? { rejectUnauthorized: false } : undefined,
    });
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1');
      return (res.rowCount ?? 0) >= 0;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          device_id TEXT NOT NULL,
          source TEXT DEFAULT 'phone',
          started_at BIGINT NOT NULL,
          ended_at BIGINT,
          sample_count INTEGER DEFAULT 0,
          min_lat DOUBLE PRECISION,
          max_lat DOUBLE PRECISION,
          min_lon DOUBLE PRECISION,
          max_lon DOUBLE PRECISION
        );

        CREATE TABLE IF NOT EXISTS samples (
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          t BIGINT NOT NULL,
          accel_x REAL NOT NULL,
          accel_y REAL NOT NULL,
          accel_z REAL NOT NULL,
          gyro_x REAL NOT NULL,
          gyro_y REAL NOT NULL,
          gyro_z REAL NOT NULL,
          mag_x REAL NOT NULL,
          mag_y REAL NOT NULL,
          mag_z REAL NOT NULL,
          roll REAL NOT NULL,
          pitch REAL NOT NULL,
          yaw REAL NOT NULL,
          pressure REAL,
          altitude REAL,
          prox REAL,
          lat DOUBLE PRECISION,
          lon DOUBLE PRECISION,
          gps_alt REAL,
          speed REAL,
          sats INTEGER,
          gps_acc REAL,
          bearing REAL,
          gps_fix_t BIGINT,
          batt INTEGER NOT NULL,
          batt_temp REAL NOT NULL,
          sats_visible INTEGER,
          gps_cn0 REAL,
          gps_age_ms INTEGER,
          PRIMARY KEY (session_id, seq),
          CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_samples_pg_seq ON samples (session_id, seq);
        CREATE INDEX IF NOT EXISTS idx_samples_pg_t ON samples (session_id, t);
      `);

      try { await client.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'phone'"); } catch {}
      try { await client.query("ALTER TABLE samples ADD COLUMN IF NOT EXISTS sats_visible INTEGER"); } catch {}
      try { await client.query("ALTER TABLE samples ADD COLUMN IF NOT EXISTS gps_cn0 REAL"); } catch {}
      try { await client.query("ALTER TABLE samples ADD COLUMN IF NOT EXISTS gps_age_ms INTEGER"); } catch {}
    } finally {
      client.release();
    }
  }

  async createSession(id: string, name: string, deviceId: string, startedAt: number, source?: 'phone' | 'sim'): Promise<SessionRecord> {
    const isSim = source === 'sim' || deviceId.toLowerCase().startsWith('sim') || deviceId.toLowerCase().includes('simulator');
    const finalSource: 'phone' | 'sim' = source || (isSim ? 'sim' : 'phone');

    await this.pool.query(
      `INSERT INTO sessions (id, name, device_id, source, started_at, sample_count) VALUES ($1, $2, $3, $4, $5, 0)`,
      [id, name, deviceId, finalSource, startedAt]
    );
    return {
      id,
      name,
      deviceId,
      source: finalSource,
      startedAt,
      endedAt: null,
      sampleCount: 0,
      bounds: null,
    };
  }

  async endSession(id: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE sessions SET ended_at = $1 WHERE id = $2 AND ended_at IS NULL`,
      [Date.now(), id]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async endOldSessionsForDevice(deviceId: string, excludeSessionId?: string): Promise<void> {
    if (excludeSessionId) {
      await this.pool.query(
        `UPDATE sessions SET ended_at = $1 WHERE device_id = $2 AND ended_at IS NULL AND id != $3`,
        [Date.now(), deviceId, excludeSessionId]
      );
    } else {
      await this.pool.query(
        `UPDATE sessions SET ended_at = $1 WHERE device_id = $2 AND ended_at IS NULL`,
        [Date.now(), deviceId]
      );
    }
  }

  async autoEndInactiveSessions(timeoutMs: number): Promise<string[]> {
    const threshold = Date.now() - timeoutMs;
    const res = await this.pool.query(
      `SELECT s.id, GREATEST(COALESCE(MAX(m.t), 0), s.started_at) as last_activity
       FROM sessions s
       LEFT JOIN samples m ON s.id = m.session_id
       WHERE s.ended_at IS NULL
       GROUP BY s.id, s.started_at
       HAVING GREATEST(COALESCE(MAX(m.t), 0), s.started_at) < $1`,
      [threshold]
    );
    const ended: string[] = [];
    const now = Date.now();
    for (const row of res.rows) {
      await this.pool.query(`UPDATE sessions SET ended_at = $1 WHERE id = $2`, [now, row.id]);
      ended.push(row.id);
    }
    return ended;
  }

  async insertSamples(sessionId: string, samples: Sample[]): Promise<{ accepted: number; duplicates: number }> {
    if (samples.length === 0) return { accepted: 0, duplicates: 0 };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let accepted = 0;
      let minLat: number | null = null;
      let maxLat: number | null = null;
      let minLon: number | null = null;
      let maxLon: number | null = null;

      for (const s of samples) {
        const res = await client.query(
          `INSERT INTO samples (
            session_id, seq, t, accel_x, accel_y, accel_z,
            gyro_x, gyro_y, gyro_z, mag_x, mag_y, mag_z,
            roll, pitch, yaw, pressure, altitude, prox,
            lat, lon, gps_alt, speed, sats, gps_acc,
            bearing, gps_fix_t, batt, batt_temp,
            sats_visible, gps_cn0, gps_age_ms
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24,
            $25, $26, $27, $28,
            $29, $30, $31
          ) ON CONFLICT (session_id, seq) DO NOTHING`,
          [
            sessionId, s.seq, s.t, s.accel_x, s.accel_y, s.accel_z,
            s.gyro_x, s.gyro_y, s.gyro_z, s.mag_x, s.mag_y, s.mag_z,
            s.roll, s.pitch, s.yaw, s.pressure, s.altitude, s.prox,
            s.lat, s.lon, s.gps_alt, s.speed, s.sats, s.gps_acc,
            s.bearing, s.gps_fix_t, s.batt, s.batt_temp,
            s.sats_visible ?? null, s.gps_cn0 ?? null, s.gps_age_ms ?? null
          ]
        );
        if ((res.rowCount ?? 0) > 0) {
          accepted++;
          if (s.lat !== null && s.lon !== null) {
            if (minLat === null || s.lat < minLat) minLat = s.lat;
            if (maxLat === null || s.lat > maxLat) maxLat = s.lat;
            if (minLon === null || s.lon < minLon) minLon = s.lon;
            if (maxLon === null || s.lon > maxLon) maxLon = s.lon;
          }
        }
      }

      if (accepted > 0) {
        await client.query(
          `UPDATE sessions SET
            sample_count = sample_count + $1,
            min_lat = LEAST(COALESCE(min_lat, $2), $2),
            max_lat = GREATEST(COALESCE(max_lat, $3), $3),
            min_lon = LEAST(COALESCE(min_lon, $4), $4),
            max_lon = GREATEST(COALESCE(max_lon, $5), $5)
          WHERE id = $6`,
          [accepted, minLat, maxLat, minLon, maxLon, sessionId]
        );
      }

      await client.query('COMMIT');
      return { accepted, duplicates: samples.length - accepted };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSessions(): Promise<SessionRecord[]> {
    const res = await this.pool.query(`
      SELECT id, name, device_id as "deviceId", source, started_at as "startedAt",
             ended_at as "endedAt", sample_count as "sampleCount",
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      ORDER BY started_at DESC
    `);
    return res.rows.map((r) => {
      const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
      return {
        id: r.id,
        name: r.name,
        deviceId: r.deviceId,
        source: isSim ? 'sim' : 'phone',
        startedAt: Number(r.startedAt),
        endedAt: r.endedAt ? Number(r.endedAt) : null,
        sampleCount: r.sampleCount,
        bounds: r.min_lat !== null ? {
          minLat: Number(r.min_lat),
          maxLat: Number(r.max_lat),
          minLon: Number(r.min_lon),
          maxLon: Number(r.max_lon),
        } : null,
      };
    });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const res = await this.pool.query(`
      SELECT id, name, device_id as "deviceId", source, started_at as "startedAt",
             ended_at as "endedAt", sample_count as "sampleCount",
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      WHERE id = $1
    `, [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
    return {
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      source: isSim ? 'sim' : 'phone',
      startedAt: Number(r.startedAt),
      endedAt: r.endedAt ? Number(r.endedAt) : null,
      sampleCount: r.sampleCount,
      bounds: r.min_lat !== null ? {
        minLat: Number(r.min_lat),
        maxLat: Number(r.max_lat),
        minLon: Number(r.min_lon),
        maxLon: Number(r.max_lon),
      } : null,
    };
  }

  async getLatestSession(): Promise<SessionRecord | null> {
    const res = await this.pool.query(`
      SELECT id, name, device_id as "deviceId", source, started_at as "startedAt",
             ended_at as "endedAt", sample_count as "sampleCount",
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      ORDER BY started_at DESC
      LIMIT 1
    `);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
    return {
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      source: isSim ? 'sim' : 'phone',
      startedAt: Number(r.startedAt),
      endedAt: r.endedAt ? Number(r.endedAt) : null,
      sampleCount: r.sampleCount,
      bounds: r.min_lat !== null ? {
        minLat: Number(r.min_lat),
        maxLat: Number(r.max_lat),
        minLon: Number(r.min_lon),
        maxLon: Number(r.max_lon),
      } : null,
    };
  }

  async getLatestPhoneSession(): Promise<SessionRecord | null> {
    const res = await this.pool.query(`
      SELECT id, name, device_id as "deviceId", source, started_at as "startedAt",
             ended_at as "endedAt", sample_count as "sampleCount",
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      WHERE (source = 'phone' OR (source IS NULL AND device_id NOT LIKE 'sim%' AND device_id NOT LIKE '%simulator%'))
      ORDER BY started_at DESC
      LIMIT 1
    `);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      source: 'phone',
      startedAt: Number(r.startedAt),
      endedAt: r.endedAt ? Number(r.endedAt) : null,
      sampleCount: r.sampleCount,
      bounds: r.min_lat !== null ? {
        minLat: Number(r.min_lat),
        maxLat: Number(r.max_lat),
        minLon: Number(r.min_lon),
        maxLon: Number(r.max_lon),
      } : null,
    };
  }

  async getSamples(sessionId: string, fromSeq?: number, toSeq?: number, every: number = 1): Promise<Sample[]> {
    let query = `
      SELECT seq, t, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z,
             mag_x, mag_y, mag_z, roll, pitch, yaw, pressure, altitude, prox,
             lat, lon, gps_alt, speed, sats, gps_acc, bearing, gps_fix_t,
             batt, batt_temp, sats_visible, gps_cn0, gps_age_ms
      FROM samples
      WHERE session_id = $1
    `;
    const params: any[] = [sessionId];
    let paramIdx = 2;

    if (fromSeq !== undefined) {
      query += ` AND seq >= $${paramIdx++}`;
      params.push(fromSeq);
    }
    if (toSeq !== undefined) {
      query += ` AND seq <= $${paramIdx++}`;
      params.push(toSeq);
    }
    if (every > 1) {
      query += ` AND (seq % $${paramIdx++}) = 0`;
      params.push(every);
    }

    query += ` ORDER BY seq ASC`;
    const res = await this.pool.query(query, params);
    return res.rows.map(mapPgSample);
  }

  async streamSamples(sessionId: string, onRow: (sample: Sample) => Promise<void> | void): Promise<void> {
    const res = await this.pool.query(`
      SELECT seq, t, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z,
             mag_x, mag_y, mag_z, roll, pitch, yaw, pressure, altitude, prox,
             lat, lon, gps_alt, speed, sats, gps_acc, bearing, gps_fix_t,
             batt, batt_temp, sats_visible, gps_cn0, gps_age_ms
      FROM samples
      WHERE session_id = $1
      ORDER BY seq ASC
    `, [sessionId]);

    for (const row of res.rows) {
      await onRow(mapPgSample(row));
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async cleanupOldSessions(days: number): Promise<number> {
    const cutoff = Date.now() - days * 86400 * 1000;
    const res = await this.pool.query(`DELETE FROM sessions WHERE started_at < $1 RETURNING id`, [cutoff]);
    return res.rowCount ?? 0;
  }

  async getActiveSessions(): Promise<SessionRecord[]> {
    const res = await this.pool.query(`
      SELECT id, name, device_id as "deviceId", source, started_at as "startedAt",
             ended_at as "endedAt", sample_count as "sampleCount",
             min_lat, max_lat, min_lon, max_lon
      FROM sessions
      WHERE ended_at IS NULL
    `);
    return res.rows.map((r) => {
      const isSim = r.source === 'sim' || r.deviceId?.toLowerCase().startsWith('sim') || r.deviceId?.toLowerCase().includes('simulator');
      return {
        id: r.id,
        name: r.name,
        deviceId: r.deviceId,
        source: isSim ? 'sim' : 'phone',
        startedAt: Number(r.startedAt),
        endedAt: r.endedAt ? Number(r.endedAt) : null,
        sampleCount: r.sampleCount,
        bounds: r.min_lat !== null ? {
          minLat: Number(r.min_lat),
          maxLat: Number(r.max_lat),
          minLon: Number(r.min_lon),
          maxLon: Number(r.max_lon),
        } : null,
      };
    });
  }
}

function mapPgSample(r: any): Sample {
  return {
    seq: Number(r.seq),
    t: Number(r.t),
    accel_x: Number(r.accel_x),
    accel_y: Number(r.accel_y),
    accel_z: Number(r.accel_z),
    gyro_x: Number(r.gyro_x),
    gyro_y: Number(r.gyro_y),
    gyro_z: Number(r.gyro_z),
    mag_x: Number(r.mag_x),
    mag_y: Number(r.mag_y),
    mag_z: Number(r.mag_z),
    roll: Number(r.roll),
    pitch: Number(r.pitch),
    yaw: Number(r.yaw),
    pressure: r.pressure !== null ? Number(r.pressure) : null,
    altitude: r.altitude !== null ? Number(r.altitude) : null,
    prox: r.prox !== null ? Number(r.prox) : null,
    lat: r.lat !== null ? Number(r.lat) : null,
    lon: r.lon !== null ? Number(r.lon) : null,
    gps_alt: r.gps_alt !== null ? Number(r.gps_alt) : null,
    speed: r.speed !== null ? Number(r.speed) : null,
    sats: r.sats !== null ? Number(r.sats) : null,
    gps_acc: r.gps_acc !== null ? Number(r.gps_acc) : null,
    bearing: r.bearing !== null ? Number(r.bearing) : null,
    gps_fix_t: r.gps_fix_t !== null ? Number(r.gps_fix_t) : null,
    batt: Number(r.batt),
    batt_temp: Number(r.batt_temp),
    sats_visible: r.sats_visible !== null ? Number(r.sats_visible) : null,
    gps_cn0: r.gps_cn0 !== null ? Number(r.gps_cn0) : null,
    gps_age_ms: r.gps_age_ms !== null ? Number(r.gps_age_ms) : null,
  };
}

export function createRepository(): ITelemetryRepository {
  if (process.env.DATABASE_URL) {
    console.log('[DB] Connecting to PostgreSQL database...');
    return new PostgresRepository(process.env.DATABASE_URL);
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn('\n' + '='.repeat(80));
    console.warn('⚠️  CRITICAL WARNING: Running in PRODUCTION without DATABASE_URL!');
    console.warn('Data stored in local SQLite will be PERMANENTLY LOST when this container restarts.');
    console.warn('Configure DATABASE_URL with a managed PostgreSQL database (e.g. Neon or Supabase).');
    console.warn('='.repeat(80) + '\n');
  } else {
    console.log('[DB] DATABASE_URL not set; using local SQLite database (telemetry.sqlite)');
  }
  return new SqliteRepository('./telemetry.sqlite');
}
