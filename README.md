# ROCKET TRACK CLOUD 🚀📡

**ROCKET TRACK CLOUD** is a production telemetry cloud server and live ground station dashboard designed for sounding rockets, vehicle trials, and high-frequency sensor recordings. It receives sensor telemetry from Android phones or payload transmitters over mobile data, archives it idempotently, and plots sensors against GNSS trajectory (the payload's trail) in real time.

One person rides a bike or launches a rocket with an Android phone streaming data over 4G/5G; a second person watches the live dashboard on a laptop anywhere in the world.

---

## 🌟 Architecture & Features

1. **Dual-Mode 3D Trail Viewer (Three.js / WebGL)**:
   - True metric **ENU (East-North-Up)** coordinate frame (origin = first GPS fix).
   - Dynamic **Vertical Exaggeration** slider (1x to 20x).
   - **GROUND Mode**: Compact chevron pointer lying on the trail and aligned with travel heading (GPS bearing with fallback to trail direction).
   - **ROCKET Mode**: 3D rocket model oriented by phone attitude quaternion SLERP with exhaust flame appearing above acceleration thresholds ($|a| > 14\text{ m/s}^2$).
   - Constant on-screen marker size (36–48px) at all zoom levels, with glowing head sphere, pulsing ground ring, altitude drop line, and apogee/100m ticks.
   - 6 Trail Styles: **Ribbon**, **Tube**, **Comet**, **Particles**, **Curtain**, **Extrusion**.

2. **Leaflet 2D GNSS Map**:
   - Clean, dark CartoDB tiles without API key watermarks (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`).
   - Fallback to dark OpenStreetMap tiles or tactical grid canvas.
   - Real-time dead-reckoning smoothing between 1 Hz GPS fixes based on speed and bearing (with "estimated" tag).
   - Distance tick markers every 100 meters, heading arrows, and accuracy circles.

3. **Multi-Channel Synchronized Sensor Graphs**:
   - Accelerometer ($a_x, a_y, a_z, |a|$ in $\text{m/s}^2$ with $\text{g}$ toggle).
   - Gyroscope ($g_x, g_y, g_z, |\omega|$ in $\text{rad/s}$ with $\text{deg/s}$ toggle).
   - Magnetometer ($m_x, m_y, m_z, |B|$ in $\mu\text{T}$).
   - Dedicated GNSS Telemetry tab (lat, lon, altitude, speed, satellites, accuracy, fix age).
   - **X-Axis Selector**: Switch between **Latitude**, **Longitude**, **Time**, and **Distance**. Looping route detection warns if latitude/longitude folds back.
   - **LTTB Downsampling**: Largest-Triangle-Three-Buckets algorithm decimatestelemetry to ~2000 points per series for smooth 60 FPS interactions.
   - **Moving Average Smoothing**: 0, 5, 10, or 20 samples.

4. **Dedicated Attitude Indicator (ADI)**:
   - Primary Flight Display artificial horizon with pitch ladder, roll pointer, and yaw readouts in a dedicated card.

5. **Watch Mode (Ground Station Field Observer)**:
   - Fullscreen high-contrast view with giant numbers: **Speed (km/h & m/s)**, **Altitude**, **Satellites (used/visible)**, **GPS Age**, **Battery %**, and **|a|**, accompanied by a compact trail map.

6. **Role-Based Security**:
   - `DEVICE_KEY`: Phone uplink write-only.
   - `VIEWER_KEY`: Read-only ground station dashboard. Viewers cannot delete sessions or view device secrets.
   - `ADMIN_KEY`: Full mission control. Allows session deletion, device provisioning, and viewing pairing QR codes. Admin-only "Copy viewer link" button copies `https://<host>/#key=<VIEWER_KEY>` for one-click access.

7. **Storage Engine**:
   - **PostgreSQL**: Automatic connection with SSL pooling when `DATABASE_URL` is set (Neon / Supabase).
   - **SQLite**: Local fallback (`better-sqlite3` with WAL mode) for local testing. In production, a loud startup warning is emitted if `DATABASE_URL` is omitted.

---

## 📡 API Contract v1 Reference

All endpoints derive base URL dynamically from `window.location` (HTTPS $\rightarrow$ WSS).

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/health` | GET | Public | Health ping (`?deep=1` tests live DB connection) |
| `/api/whoami` | GET | Viewer / Admin | Returns `{ role: "viewer" \| "admin" }` |
| `/api/sessions` | POST | Device / Admin | Create new session `{ deviceId, name?, source? }` |
| `/api/sessions/:id/end` | POST | Device / Admin | End active session |
| `/api/sessions/:id/samples` | POST | Device / Admin | Ingest batch (JSON or Gzip, idempotent on `(id, seq)`) |
| `/api/sessions` | GET | Viewer / Admin | List recorded sessions with bounds |
| `/api/sessions/:id/samples` | GET | Viewer / Admin | Query samples (`?from=&to=&every=`) |
| `/api/sessions/:id/export.csv`| GET | Viewer / Admin | Streamed CSV download |
| `/api/sessions/:id` | DELETE | Admin Only | Delete session and associated telemetry |
| `/api/config/device` | GET | Admin Only | Get device provisioning key & ID for QR pairing |
| `/ws` | WS | Viewer / Admin | Real-time WebSocket fan-out (`?session=&key=`) |

---

## 🚀 Deployment Guide: Put It Online (Render + Neon)

Follow these steps to deploy Rocket Track Cloud to the internet with free cloud hosting:

### Step 1: Create a PostgreSQL Database on Neon
1. Go to [Neon.tech](https://neon.tech) and create a free account.
2. Click **Create Project** (e.g. `rocket-track-db`).
3. Under **Connection Details**, copy the PostgreSQL connection string. It looks like:
   ```
   postgresql://user:password@ep-cool-butterfly-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### Step 2: Generate Cryptographically Secure Keys
Run this Node.js one-liner in your terminal three times to generate distinct, strong keys:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Generate three separate keys:
- `DEVICE_KEY` (e.g. `3a4f89b...`)
- `VIEWER_KEY` (e.g. `9c12e5a...`)
- `ADMIN_KEY`  (e.g. `f048d21...`)

### Step 3: Push Repository to GitHub
```bash
git init
git add .
git commit -m "Deploy Rocket Track Cloud v1.0"
git branch -M main
git remote add origin https://github.com/<your-username>/rocket-track-cloud.git
git push -u origin main
```

### Step 4: Deploy on Render
1. Log in to [Render.com](https://render.com).
2. Click **New +** $\rightarrow$ **Blueprint** (or **Web Service**).
   - If using **Blueprint**: Point to your repository; Render will read `render.yaml`.
   - If using **Web Service**:
     - **Runtime**: `Node`
     - **Build Command**: `npm install --include=dev && npm run build`
     - **Start Command**: `npm start`
     - **Health Check Path**: `/api/health`
3. Add the following **Environment Variables** under **Environment**:
   - `NODE_ENV`: `production`
   - `DATABASE_URL`: `<your-neon-postgres-connection-string>`
   - `DEVICE_KEY`: `<generated-device-key>`
   - `VIEWER_KEY`: `<generated-viewer-key>`
   - `ADMIN_KEY`: `<generated-admin-key>`
   - `CORS_ORIGINS`: `*`
   - `RETENTION_DAYS`: `30`
4. Click **Deploy Web Service**. Render will install dependencies, build the Vite frontend, run schema migrations on Neon, and start the server.

### Step 5: Prevent Free Instance Sleep with UptimeRobot
Render free instances spin down after 15 minutes of inactivity. To keep your server awake and ready for instantaneous live flight recordings:
1. Go to [UptimeRobot.com](https://uptimerobot.com) and create a free account.
2. Click **Add New Monitor**:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Rocket Track Cloud Keepalive`
   - **URL**: `https://<your-render-subdomain>.onrender.com/api/health`
   - **Monitoring Interval**: `5 minutes`
3. Save. UptimeRobot will ping `/api/health` every 5 minutes, keeping the instance warm.

---

## 🧪 Testing Workflows

### Workflow A: Run Simulator Against Live Cloud URL
To simulate bike or rocket telemetry against your deployed server:
```bash
# Bike ride test (looping circuit in Chennai with 100 Hz IMU + 1 Hz GPS):
npx tsx tools/simulate_phone.ts --url https://<your-app>.onrender.com --device-key <YOUR_DEVICE_KEY> --profile bike

# Rocket flight test (pad idle -> boost -> coast -> apogee -> parachute descent):
npx tsx tools/simulate_phone.ts --url https://<your-app>.onrender.com --device-key <YOUR_DEVICE_KEY> --profile rocket
```

### Workflow B: Connect Real Android Phone over Mobile Internet
1. Open your laptop browser to `https://<your-app>.onrender.com`.
2. Enter your `ADMIN_KEY` on the access screen.
3. Click the **DEVICE LINK** button in the top bar.
4. On your Android phone, open the **SmartPhone Telemetry** app.
5. In the app, navigate to **Cloud Uplink** $\rightarrow$ **Scan QR Code**.
6. Scan the QR code displayed on your laptop screen. (Alternatively, manually type the Server URL and Device Key).
7. Tap **Test Connection** $\rightarrow$ **Start Streaming**.
8. Step outside with the bike or payload. As soon as the phone acquires a GNSS fix, the ground station dashboard automatically switches to the live phone session and displays real-time 3D trajectory!

### Workflow C: Local Same-Wi-Fi Test (Zero Setup)
If you are testing locally before deploying to the cloud:
1. Connect laptop and Android phone to the same Wi-Fi router or phone mobile hotspot.
2. Find your laptop IP address:
   - Windows: `ipconfig` (look for IPv4, e.g. `192.168.180.214`)
   - Mac/Linux: `ifconfig`
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. On your phone browser or app, enter: `http://192.168.180.214:3000`.

### Workflow D: Quick Internet Test via Cloudflare Tunnel
To expose your local machine to the internet without configuring router port-forwarding:
```bash
# In a separate terminal:
cloudflared tunnel --url http://localhost:3000
```
Copy the temporary `https://<random-subdomain>.trycloudflare.com` URL and use it on your phone!

---

## 🔬 Verification cURL Commands

Verify your deployment from the command line:

```bash
# 1. Health check (lightweight)
curl -s https://<HOST>/api/health

# 2. Deep database health check
curl -s https://<HOST>/api/health?deep=1

# 3. Create a session with Device Key
curl -s -X POST https://<HOST>/api/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: <DEVICE_KEY>" \
  -d '{"deviceId":"phone_test_01","name":"cURL Test Flight","source":"phone"}'

# 4. Ingest a Gzip sample batch
# (Tools/simulate_phone.ts uses gzip batches automatically)

# 5. Verify viewer access
curl -s https://<HOST>/api/sessions \
  -H "x-viewer-key: <VIEWER_KEY>"

# 6. Verify viewer cannot delete (Returns 403 Forbidden)
curl -s -i -X DELETE https://<HOST>/api/sessions/<SESSION_ID> \
  -H "x-viewer-key: <VIEWER_KEY>"

# 7. Admin deletes session (Returns 200 OK)
curl -s -i -X DELETE https://<HOST>/api/sessions/<SESSION_ID> \
  -H "x-viewer-key: <ADMIN_KEY>"
```

---

## 🧯 Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| **502 / 503 Bad Gateway on first load** | Free Render instance is waking up from sleep. | Wait 30 seconds for the "Server waking up" screen to complete auto-retry, or set up UptimeRobot. |
| **401 Unauthorized** | Missing or incorrect key in header or URL hash. | Enter the Viewer or Admin key on the access screen. For one-click viewer access, use `https://<HOST>/#key=<VIEWER_KEY>`. |
| **403 Forbidden on DELETE or Device Link** | Viewer key was used for an admin-restricted action. | Log in with the `ADMIN_KEY` to delete sessions or reveal device provisioning keys. |
| **WebSocket connection fails** | Mixed content or bad URL scheme. | Rocket Track Cloud automatically derives `wss://` from `https://`. Ensure port `443` is reachable. |
| **PostgreSQL SSL connection error** | Neon requires SSL. | In `DATABASE_URL`, append `?sslmode=require`. The repository sets `rejectUnauthorized: false` for Neon/Supabase SSL compatibility. |
| **"tsx not found" or "vite build failed" on Render** | DevDependencies were skipped during production install. | Ensure Render build command is: `npm install --include=dev && npm run build`. |
| **Charts fold back on themselves** | Looping bike or rocket descent route. | Switch the X-axis from **Latitude** to **Time** or **Distance** in the chart toolbar. |
| **Barometer altitude shows "not available"** | Android phone does not have an onboard barometer chip. | Expected behavior. Rocket Track Cloud seamlessly uses `gps_alt` without ever showing false zeros. |

---

## 📜 License
MIT License. Built for rocketry teams, STEM aerospace payloads, and sensor telemetry enthusiasts.
