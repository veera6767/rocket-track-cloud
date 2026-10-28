# Rocket Track Cloud — API Contract Reference (v1)

Base URL: `https://<SERVER_HOST>` (configurable, never hardcoded).

## Authentication & Security Keys

The server supports three distinct roles enforced by environment keys:
- **`DEVICE_KEY`**: Phone uplink client (write-only). Sends header `x-api-key: <DEVICE_KEY>`. Cannot read telemetry (returns `403 Forbidden` on GET).
- **`VIEWER_KEY`**: Read-only ground station dashboard. Sends header `x-viewer-key: <VIEWER_KEY>` on REST or `?key=<VIEWER_KEY>` on WebSocket. Cannot delete sessions or view device secrets (`403 Forbidden`).
- **`ADMIN_KEY`**: Mission control full access. Accepted on all endpoints (REST and WebSocket), plus admin-only actions (session deletion and device provisioning).

> In production (`NODE_ENV=production`), keys must be at least 16 characters long. Key comparison uses constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks. Keys are never logged.

---

## REST Endpoints

### 1. Health Check
`GET /api/health`
- **Auth**: Public (lightweight, zero DB overhead)
- **Query params**: `?deep=1` (verifies live connection to SQLite / PostgreSQL database via `SELECT 1`)
- **Response**:
```json
{
  "ok": true,
  "time": 1793182238402
}
```

---

### 2. Role Identity
`GET /api/whoami`
- **Auth**: Requires `x-viewer-key` or `x-api-key`
- **Response**:
```json
{
  "role": "viewer" // or "admin"
}
```

---

### 3. Create Session
`POST /api/sessions`
- **Auth**: Device key (`x-api-key`) or Admin key
- **Request Body**:
```json
{
  "deviceId": "phone_px8_actual",
  "name": "Sounding Rocket Flight #104",
  "source": "phone" // "phone" | "sim" | "fc"
}
```
- **Response**: `201 Created`
```json
{
  "sessionId": "ses_1793182238401_ymy66z",
  "startedAt": 1793182238401,
  "source": "phone"
}
```

---

### 4. End Session
`POST /api/sessions/:id/end`
- **Auth**: Device key (`x-api-key`) or Admin key
- **Response**:
```json
{
  "ok": true
}
```

---

### 5. Ingest Telemetry Samples Batch
`POST /api/sessions/:id/samples`
- **Auth**: Device key (`x-api-key`) or Admin key
- **Headers**:
  - `Content-Type: application/json`
  - `Content-Encoding: gzip` (optional, supported with streaming decompression)
- **Size Limit**: ~5 MB
- **Idempotency**: Fully idempotent on `(sessionId, seq)`. Duplicate samples are skipped via `ON CONFLICT DO NOTHING`.
- **Request Body**:
```json
{
  "deviceId": "phone_px8_actual",
  "batchId": "b_12_1793182238",
  "samples": [
    {
      "seq": 0,
      "t": 1793182237000,
      "accel_x": 0.12,
      "accel_y": 0.24,
      "accel_z": 9.81,
      "gyro_x": 0.01,
      "gyro_y": -0.02,
      "gyro_z": 0.03,
      "mag_x": 35.1,
      "mag_y": 12.4,
      "mag_z": -15.8,
      "roll": 1.2,
      "pitch": 2.5,
      "yaw": 45.0,
      "pressure": null,
      "altitude": null,
      "prox": 5.0,
      "lat": 13.0827,
      "lon": 80.2707,
      "gps_alt": 14.5,
      "speed": 5.2,
      "bearing": 45.0,
      "gps_acc": 3.1,
      "gps_fix_t": 1793182237000,
      "sats": 12,
      "batt": 85,
      "batt_temp": 32.5,
      "sats_visible": 18,
      "gps_cn0": 36.5,
      "gps_age_ms": 120
    }
  ]
}
```
- **Response**:
```json
{
  "accepted": 1,
  "duplicates": 0
}
```

---

### 6. List Sessions
`GET /api/sessions`
- **Auth**: Viewer key (`x-viewer-key`) or Admin key
- **Response**:
```json
[
  {
    "id": "ses_1793182238401_ymy66z",
    "name": "Sounding Rocket Flight #104",
    "deviceId": "phone_px8_actual",
    "source": "phone",
    "startedAt": 1793182238401,
    "endedAt": null,
    "sampleCount": 1200,
    "bounds": {
      "minLat": 13.0820,
      "maxLat": 13.0835,
      "minLon": 80.2700,
      "maxLon": 80.2715
    }
  }
]
```

---

### 7. Query Session Samples
`GET /api/sessions/:id/samples?from=<seq>&to=<seq>&every=<N>`
- **Auth**: Viewer key (`x-viewer-key`) or Admin key
- **Aliases**: `:id` can be `'latest-phone'` or `'latest'`
- **Query Params**:
  - `from`: starting sequence number (inclusive)
  - `to`: ending sequence number (inclusive)
  - `every`: downsampling decimation factor (e.g. `2` returns every 2nd sample)
- **Response**:
```json
{
  "samples": [ ... ]
}
```

---

### 8. Stream CSV Export
`GET /api/sessions/:id/export.csv`
- **Auth**: Viewer key (`x-viewer-key`) or Admin key
- **Response**: Streamed `text/csv; charset=utf-8` containing all standard and optional telemetry columns.

---

### 9. Delete Session
`DELETE /api/sessions/:id`
- **Auth**: **Admin key only** (`x-viewer-key: ADMIN_KEY` or `x-api-key: ADMIN_KEY`).
- Returns `403 Forbidden` if attempted with a viewer key.
- **Response**:
```json
{
  "ok": true
}
```

---

### 10. Device Configuration & Pairing Key
`GET /api/config/device`
- **Auth**: **Admin key only**.
- Returns `403 Forbidden` if accessed with a viewer key.
- **Response**:
```json
{
  "deviceKey": "rocket_device_secret_2026",
  "deviceId": "phone_7b3a9e"
}
```

---

## WebSocket Protocol

Endpoint: `/ws?session=<id|latest|latest-phone>&key=<VIEWER_KEY_OR_ADMIN_KEY>`

### Server -> Client Messages

1. **Hello handshake**:
```json
{
  "type": "hello",
  "sessionId": "ses_1793182238401_ymy66z",
  "deviceId": "phone_px8_actual",
  "source": "phone"
}
```

2. **Telemetry Batch**:
- Sent at most 10 messages/s (every ~100ms) during steady IMU streaming.
- **Immediate dispatch rule**: If any sample contains a new GPS fix (`new gps_fix_t`), the batch is transmitted immediately without waiting for the throttle timer.
- On connection, server sends the last ~15 seconds of samples with `isBackfill: true`.
```json
{
  "type": "batch",
  "sessionId": "ses_1793182238401_ymy66z",
  "samples": [ ... ],
  "isBackfill": false
}
```

3. **Status Heartbeat (1 Hz)**:
```json
{
  "type": "status",
  "deviceOnline": true,
  "lastSampleAt": 1793182238400,
  "ratePerSec": 100,
  "deviceId": "phone_px8_actual",
  "source": "phone",
  "gps": {
    "lat": 13.0827,
    "lon": 80.2707,
    "fixTime": 1793182238000,
    "ageMs": 400,
    "sats": 12,
    "satsVisible": 18
  }
}
```

4. **Session Started**:
Broadcast whenever any device starts a new session.
```json
{
  "type": "session_started",
  "session": { ... }
}
```

5. **Ping (every 15s)**:
```json
{
  "type": "ping"
}
```
