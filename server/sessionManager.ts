import { WebSocket } from 'ws';
import { Sample, WsServerMessage, SessionRecord } from '../shared/types.js';
import { ITelemetryRepository } from './repository.js';
import { inferSeqStep } from '../shared/math.js';

interface ViewerClient {
  ws: WebSocket;
  requestedSession: string; // session ID or 'latest'
  actualSessionId: string | null;
  pendingSamples: Sample[];
  lastFlushTime: number;
}

export class SessionManager {
  private repo: ITelemetryRepository;
  // Ring buffer of last 15s per session (~1500 samples at 100 Hz, max 3000)
  private ringBuffers: Map<string, Sample[]> = new Map();
  // Device tracking: last sample timestamp received per session
  private lastSampleTime: Map<string, number> = new Map();
  // Sample count in the last 1-second window per session
  private rateCounter: Map<string, number> = new Map();
  private currentRatePerSec: Map<string, number> = new Map();
  private sessionDevices: Map<string, string> = new Map();
  private sessionSources: Map<string, 'phone' | 'sim' | 'fc'> = new Map();
  private sessionSeqStep: Map<string, number> = new Map();
  private lastGpsFix: Map<
    string,
    {
      lat: number | null;
      lon: number | null;
      fixTime: number | null;
      sats: number | null;
      satsVisible: number | null;
      acc: number | null;
      provider: string | null;
    }
  > = new Map();
  private lastGpsFixTime: Map<string, number | null> = new Map();

  private viewers: Set<ViewerClient> = new Set();
  private pingInterval: NodeJS.Timeout | null = null;
  private statusInterval: NodeJS.Timeout | null = null;
  private flushInterval: NodeJS.Timeout | null = null;
  private inactivityInterval: NodeJS.Timeout | null = null;

  constructor(repo: ITelemetryRepository) {
    this.repo = repo;
    this.startIntervals();
  }

  private startIntervals() {
    // 1. Heartbeat ping every 15s
    this.pingInterval = setInterval(() => {
      const pingMsg = JSON.stringify({ type: 'ping' });
      for (const client of this.viewers) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(pingMsg);
        }
      }
    }, 15000);

    // 2. Throttled viewer flush: at most 10 messages/s (every 100ms)
    this.flushInterval = setInterval(() => {
      const now = Date.now();
      for (const client of this.viewers) {
        if (
          client.ws.readyState === WebSocket.OPEN &&
          client.pendingSamples.length > 0 &&
          client.actualSessionId &&
          now - client.lastFlushTime >= 95
        ) {
          const step = this.sessionSeqStep.get(client.actualSessionId) || 1;
          const batchMsg: WsServerMessage = {
            type: 'batch',
            sessionId: client.actualSessionId,
            samples: client.pendingSamples,
            seqStep: step,
          };
          client.ws.send(JSON.stringify(batchMsg));
          client.pendingSamples = [];
          client.lastFlushTime = now;
        }
      }
    }, 50);

    // 3. Status push once per second: ratePerSec, deviceOnline, gps, seqStep
    this.statusInterval = setInterval(async () => {
      const now = Date.now();
      // Calculate rates
      for (const [sessionId, count] of this.rateCounter.entries()) {
        this.currentRatePerSec.set(sessionId, count);
        this.rateCounter.set(sessionId, 0);
      }

      for (const client of this.viewers) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        const sessionId = client.actualSessionId;
        if (!sessionId) continue;

        const lastT = this.lastSampleTime.get(sessionId) ?? null;
        const deviceOnline = lastT !== null && now - lastT < 5000;
        const rate = this.currentRatePerSec.get(sessionId) ?? 0;
        const deviceId = this.sessionDevices.get(sessionId);
        const source = this.sessionSources.get(sessionId);
        const seqStep = this.sessionSeqStep.get(sessionId) || 1;
        const gpsInfo = this.lastGpsFix.get(sessionId);
        const ageMs = gpsInfo?.fixTime ? Math.max(0, now - gpsInfo.fixTime) : null;

        const statusMsg: WsServerMessage = {
          type: 'status',
          deviceOnline,
          lastSampleAt: lastT,
          ratePerSec: rate,
          deviceId,
          source,
          seqStep,
          gps: gpsInfo
            ? {
                lat: gpsInfo.lat,
                lon: gpsInfo.lon,
                fixTime: gpsInfo.fixTime,
                ageMs,
                sats: gpsInfo.sats,
                satsVisible: gpsInfo.satsVisible,
                acc: gpsInfo.acc,
                provider: gpsInfo.provider,
              }
            : undefined,
        };
        client.ws.send(JSON.stringify(statusMsg));
      }
    }, 1000);

    // 4. Auto-end sessions silent for 10 minutes (600,000 ms)
    this.inactivityInterval = setInterval(async () => {
      try {
        const ended = await this.repo.autoEndInactiveSessions(10 * 60 * 1000);
        if (ended.length > 0) {
          console.log(`[SessionManager] Auto-ended ${ended.length} inactive sessions:`, ended);
        }
      } catch (err) {
        console.error('[SessionManager] Error checking inactive sessions:', err);
      }
    }, 60000);
  }

  public onSessionStarted(record: SessionRecord) {
    const isSim =
      record.source === 'sim' ||
      record.deviceId?.toLowerCase().startsWith('sim') ||
      record.deviceId?.toLowerCase().includes('simulator');
    const source: 'phone' | 'sim' | 'fc' = record.source || (isSim ? 'sim' : 'phone');

    this.sessionDevices.set(record.id, record.deviceId);
    this.sessionSources.set(record.id, source);
    if (record.seqStep) {
      this.sessionSeqStep.set(record.id, record.seqStep);
    }

    const msg: WsServerMessage = { type: 'session_started', session: { ...record, source } };
    const str = JSON.stringify(msg);

    for (const client of this.viewers) {
      if (client.requestedSession === 'latest') {
        client.actualSessionId = record.id;
      } else if (client.requestedSession === 'latest-phone' && source === 'phone') {
        client.actualSessionId = record.id;
      }
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(str);
      }
    }
  }

  public async registerViewer(ws: WebSocket, requestedSession: string) {
    let actualSessionId: string | null = null;
    let deviceId: string | undefined = undefined;
    let source: 'phone' | 'sim' | 'fc' | undefined = undefined;

    if (requestedSession === 'latest-phone') {
      const latestPhone = await this.repo.getLatestPhoneSession();
      actualSessionId = latestPhone?.id ?? null;
      deviceId = latestPhone?.deviceId;
      source = latestPhone?.source || (latestPhone ? 'phone' : undefined);
      if (actualSessionId && deviceId) {
        this.sessionDevices.set(actualSessionId, deviceId);
        if (source) this.sessionSources.set(actualSessionId, source);
      }
    } else if (requestedSession === 'latest') {
      const latestPhone = await this.repo.getLatestPhoneSession();
      const latest = latestPhone || (await this.repo.getLatestSession());
      actualSessionId = latest?.id ?? null;
      deviceId = latest?.deviceId;
      source = latest?.source;
      if (actualSessionId && deviceId) {
        this.sessionDevices.set(actualSessionId, deviceId);
        if (source) this.sessionSources.set(actualSessionId, source);
      }
    } else {
      actualSessionId = requestedSession;
      const session = await this.repo.getSession(requestedSession);
      deviceId = session?.deviceId;
      source = session?.source;
      if (actualSessionId && deviceId) {
        this.sessionDevices.set(actualSessionId, deviceId);
        if (source) this.sessionSources.set(actualSessionId, source);
      }
    }

    const client: ViewerClient = {
      ws,
      requestedSession,
      actualSessionId,
      pendingSamples: [],
      lastFlushTime: Date.now(),
    };

    this.viewers.add(client);

    // Send hello message
    if (actualSessionId) {
      const seqStep = this.sessionSeqStep.get(actualSessionId) || 1;
      ws.send(JSON.stringify({ type: 'hello', sessionId: actualSessionId, deviceId, source, seqStep }));

      // Send last ~15s of samples so the view is never empty
      let ring = this.ringBuffers.get(actualSessionId);
      if (!ring || ring.length === 0) {
        const recentSamples = await this.repo.getSamples(actualSessionId, undefined, undefined, 1);
        ring = recentSamples.slice(-1500);
        if (ring.length > 0) {
          this.ringBuffers.set(actualSessionId, ring);
        }
      }

      if (ring && ring.length > 0) {
        const inferred = this.sessionSeqStep.get(actualSessionId) || inferSeqStep(ring);
        this.sessionSeqStep.set(actualSessionId, inferred);
        ws.send(
          JSON.stringify({
            type: 'batch',
            sessionId: actualSessionId,
            samples: ring,
            isBackfill: true,
            seqStep: inferred,
          })
        );
      }

      // Initial status
      const now = Date.now();
      const lastT = this.lastSampleTime.get(actualSessionId) ?? null;
      const deviceOnline = lastT !== null && now - lastT < 5000;
      ws.send(
        JSON.stringify({
          type: 'status',
          deviceOnline,
          lastSampleAt: lastT,
          ratePerSec: this.currentRatePerSec.get(actualSessionId) ?? 0,
          deviceId: this.sessionDevices.get(actualSessionId),
          seqStep: this.sessionSeqStep.get(actualSessionId) || 1,
        })
      );
    } else {
      ws.send(JSON.stringify({ type: 'hello', sessionId: '' }));
      ws.send(
        JSON.stringify({
          type: 'status',
          deviceOnline: false,
          lastSampleAt: null,
          ratePerSec: 0,
        })
      );
    }

    ws.on('close', () => {
      this.viewers.delete(client);
    });

    ws.on('error', () => {
      this.viewers.delete(client);
    });
  }

  public async onNewSamples(
    sessionId: string,
    samples: Sample[],
    isBackfill: boolean = false,
    deviceId?: string,
    seqStep?: number
  ) {
    if (samples.length === 0) return;

    if (deviceId) {
      this.sessionDevices.set(sessionId, deviceId);
    }

    if (seqStep && seqStep > 0) {
      this.sessionSeqStep.set(sessionId, seqStep);
    }

    const now = Date.now();
    this.lastSampleTime.set(sessionId, now);
    const currCount = this.rateCounter.get(sessionId) ?? 0;
    this.rateCounter.set(sessionId, currCount + samples.length);

    // Track GPS fix updates
    let hasNewGpsFix = false;
    const prevFixT = this.lastGpsFixTime.get(sessionId) ?? null;

    for (const s of samples) {
      if (s.lat !== null && s.lon !== null && s.gps_fix_t !== null) {
        if (prevFixT === null || s.gps_fix_t !== prevFixT) {
          hasNewGpsFix = true;
          this.lastGpsFixTime.set(sessionId, s.gps_fix_t);
        }
        this.lastGpsFix.set(sessionId, {
          lat: s.lat,
          lon: s.lon,
          fixTime: s.gps_fix_t,
          sats: s.sats,
          satsVisible: s.sats_visible ?? null,
          acc: s.gps_acc ?? null,
          provider: s.gps_provider ?? null,
        });
      }
    }

    // Maintain ring buffer (~1500 samples at 100 Hz, capped at 3000)
    let ring = this.ringBuffers.get(sessionId);
    if (!ring) {
      ring = [];
      this.ringBuffers.set(sessionId, ring);
    }
    ring.push(...samples);
    ring.sort((a, b) => a.seq - b.seq);
    if (ring.length > 3000) {
      ring.splice(0, ring.length - 3000);
    }

    // Infer step if not explicitly supplied
    if (!this.sessionSeqStep.has(sessionId)) {
      const inferred = inferSeqStep(ring);
      this.sessionSeqStep.set(sessionId, inferred);
    }

    const currentStep = this.sessionSeqStep.get(sessionId) || 1;

    // Broadcast to viewers
    for (const client of this.viewers) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      if (client.requestedSession === 'latest' && client.actualSessionId !== sessionId) {
        client.actualSessionId = sessionId;
        client.ws.send(JSON.stringify({ type: 'hello', sessionId, seqStep: currentStep }));
      }

      if (client.actualSessionId === sessionId) {
        if (isBackfill || hasNewGpsFix) {
          const allSamples = isBackfill ? samples : [...client.pendingSamples, ...samples];
          client.pendingSamples = [];
          client.lastFlushTime = now;
          client.ws.send(
            JSON.stringify({
              type: 'batch',
              sessionId,
              samples: allSamples,
              isBackfill: isBackfill || false,
              seqStep: currentStep,
            })
          );
        } else {
          client.pendingSamples.push(...samples);
        }
      }
    }
  }

  public getSessionSeqStep(sessionId: string): number {
    return this.sessionSeqStep.get(sessionId) || 1;
  }

  public async handleConnection(ws: WebSocket, requestedSession?: string | null) {
    await this.registerViewer(ws, requestedSession || 'latest');
  }

  public async ingestSamples(
    sessionId: string,
    samples: Sample[],
    seqStep?: number,
    deviceId?: string
  ) {
    await this.onNewSamples(sessionId, samples, false, deviceId, seqStep);
  }

  public dispose() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.statusInterval) clearInterval(this.statusInterval);
    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.inactivityInterval) clearInterval(this.inactivityInterval);
    for (const client of this.viewers) {
      try {
        client.ws.close();
      } catch {}
    }
    this.viewers.clear();
  }
}
