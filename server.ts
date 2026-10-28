import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { createRepository } from './server/repository.js';
import { SessionManager } from './server/sessionManager.js';
import { createExpressApp, isViewerAuthorized, DEVICE_KEY, VIEWER_KEY, ADMIN_KEY } from './server/app.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Production safety verification: Refuse to start if any key is missing or shorter than 16 chars
if (isProd) {
  const missingOrShort: string[] = [];
  if (!DEVICE_KEY || DEVICE_KEY.length < 16) missingOrShort.push('DEVICE_KEY (must be >= 16 characters)');
  if (!VIEWER_KEY || VIEWER_KEY.length < 16) missingOrShort.push('VIEWER_KEY (must be >= 16 characters)');
  if (!ADMIN_KEY || ADMIN_KEY.length < 16) missingOrShort.push('ADMIN_KEY (must be >= 16 characters)');

  if (missingOrShort.length > 0) {
    console.error('❌ FATAL: Production startup refused due to missing/weak security keys:');
    for (const item of missingOrShort) {
      console.error(`   - ${item}`);
    }
    console.error('Generate strong random keys (e.g. node -e "console.log(crypto.randomBytes(24).toString(\'hex\'))") and set them as environment variables.');
    process.exit(1);
  }
}

async function main() {
  const repo = createRepository();
  await repo.init();

  // Retention cleanup if configured
  const retentionDays = parseInt(process.env.RETENTION_DAYS || '0', 10);
  if (retentionDays > 0) {
    console.log(`[Retention] Automated cleanup configured for sessions older than ${retentionDays} days.`);
    try {
      const removed = await repo.cleanupOldSessions(retentionDays);
      if (removed > 0) {
        console.log(`[Retention] Startup cleanup pruned ${removed} old sessions.`);
      }
    } catch (err) {
      console.error('[Retention] Startup cleanup error:', err);
    }
  }

  const sessionManager = new SessionManager(repo);
  const app = createExpressApp(repo, sessionManager);
  const server = http.createServer(app);

  // WebSocket Server on path /ws
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
      // Authenticate WebSocket connection with ?key=<VIEWER_KEY> or ADMIN_KEY
      const key = url.searchParams.get('key');
      if (!isViewerAuthorized(key)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const sessionParam = url.searchParams.get('session') || 'latest';
    await sessionManager.registerViewer(ws, sessionParam);
  });

  // Serve static / Vite app
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Rocket Track Cloud server running at http://0.0.0.0:${PORT}`);
    console.log(`📡 WebSocket endpoint ready at ws://0.0.0.0:${PORT}/ws`);
  });

  const shutdown = async () => {
    console.log('Shutting down server gracefully...');
    sessionManager.dispose();
    server.close(async () => {
      if (repo.close) {
        await repo.close();
      }
      console.log('HTTP/WebSocket server and DB pool closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
