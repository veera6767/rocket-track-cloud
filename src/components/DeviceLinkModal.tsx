import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useTelemetryStore, isSimulatorDevice } from '../store/telemetryStore.js';
import {
  Smartphone,
  Radio,
  WifiOff,
  Copy,
  Check,
  Eye,
  EyeOff,
  X,
  Battery,
  Satellite,
  Compass,
  Zap,
  Activity,
  CheckCircle2,
} from 'lucide-react';

export const DeviceLinkModal: React.FC = () => {
  const {
    isDeviceLinkOpen,
    setDeviceLinkOpen,
    deviceOnline,
    wsStatus,
    activeDeviceId,
    lastSampleAt,
    ratePerSec,
    interpolatedSamples,
    serverUrl,
    viewerKey,
  } = useTelemetryStore();

  const [deviceKey, setDeviceKey] = useState<string>('rocket_device_secret_2026');
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latency: number } | null>(null);

  // Fetch device key
  useEffect(() => {
    if (!isDeviceLinkOpen) return;

    let mounted = true;
    fetch(`${serverUrl}/api/config/device?key=${encodeURIComponent(viewerKey)}`, {
      headers: { 'x-viewer-key': viewerKey },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data?.deviceKey) {
          setDeviceKey(data.deviceKey);
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [isDeviceLinkOpen, serverUrl, viewerKey]);

  // Generate QR code encoding connection payload
  useEffect(() => {
    if (!isDeviceLinkOpen) return;

    const payload = JSON.stringify({
      url: serverUrl,
      deviceKey: deviceKey,
      deviceId: activeDeviceId || 'phone_android_live',
    });

    QRCode.toDataURL(payload, {
      width: 200,
      margin: 1,
      color: {
        dark: '#38BDF8',
        light: '#111826',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => {});
  }, [isDeviceLinkOpen, serverUrl, deviceKey, activeDeviceId]);

  if (!isDeviceLinkOpen) return null;

  const latestSample = interpolatedSamples.length > 0 ? interpolatedSamples[interpolatedSamples.length - 1] : null;

  // Connection status determination
  const hasSamples = interpolatedSamples.length > 0;
  const isLive = wsStatus === 'connected' && deviceOnline && hasSamples;
  const isSignalLost = hasSamples && (!deviceOnline || (lastSampleAt && Date.now() - lastSampleAt >= 5000));

  const sampleAgeSec = lastSampleAt ? Math.max(0, Math.floor((Date.now() - lastSampleAt) / 1000)) : null;

  const handleTestLink = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const start = performance.now();
      const res = await fetch(`${serverUrl}/api/health`);
      const latency = Math.round(performance.now() - start);
      setTestResult({ ok: res.ok, latency });
    } catch {
      setTestResult({ ok: false, latency: 0 });
    } finally {
      setIsTesting(false);
    }
  };

  const copyToClipboard = (text: string, type: 'key' | 'url') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const satsUsed = latestSample?.sats ?? null;
  const satsVis = latestSample?.sats_visible ?? null;
  const satsText = satsUsed !== null ? (satsVis !== null ? `${satsUsed} / ${satsVis}` : `${satsUsed}`) : '--';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#111826] border border-[#243049] rounded-xl max-w-2xl w-full p-6 text-xs font-mono shadow-2xl relative flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#243049] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#172033] border border-[#243049] rounded-lg text-[#38BDF8]">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-[#E6EAF2] uppercase tracking-wide">
                Device Link // Smartphone Uplink
              </h3>
              <p className="text-[11px] text-[#8A97AD]">
                Connect Android phone to transmit high-rate telemetry
              </p>
            </div>
          </div>
          <button
            onClick={() => setDeviceLinkOpen(false)}
            className="text-[#8A97AD] hover:text-[#E6EAF2] p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Device Status Pill */}
        <div className="bg-[#172033] border border-[#243049] rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[#8A97AD]">STATUS:</span>
            {isLive ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold text-[#34D399] bg-[#34D399]/10 border border-[#34D399]/40">
                <span className="w-2 h-2 rounded-full bg-[#34D399] animate-pulse" />
                LIVE
              </span>
            ) : isSignalLost ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold text-[#F87171] bg-[#F87171]/10 border border-[#F87171]/40">
                <WifiOff className="w-3.5 h-3.5 text-[#F87171]" />
                SIGNAL LOST ({sampleAgeSec}s ago)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold text-[#FBBF24] bg-[#FBBF24]/10 border border-[#FBBF24]/40">
                <Radio className="w-3.5 h-3.5 text-[#FBBF24]" />
                WAITING FOR PHONE
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-[#8A97AD]">
            <span>DEVICE: <strong className="text-[#E6EAF2]">{activeDeviceId || 'None'}</strong></span>
            <span>RATE: <strong className="text-[#34D399]">{ratePerSec} Hz</strong></span>
          </div>
        </div>

        {/* Credentials & QR Code Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Connection Parameters */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[#8A97AD] text-[11px] block mb-1">SERVER URL (INGEST BASE)</label>
              <div className="flex items-center justify-between bg-[#0B0F17] px-3 py-2 rounded-lg border border-[#243049]">
                <span className="text-[#E6EAF2] truncate font-mono">{serverUrl}</span>
                <button
                  onClick={() => copyToClipboard(serverUrl, 'url')}
                  className="text-[#8A97AD] hover:text-[#38BDF8] ml-2 p-1"
                  title="Copy Server URL"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[#8A97AD] text-[11px] block mb-1">DEVICE SECRET KEY (X-API-KEY)</label>
              <div className="flex items-center justify-between bg-[#0B0F17] px-3 py-2 rounded-lg border border-[#243049]">
                <span className="text-[#E6EAF2] truncate font-mono">
                  {showKey ? deviceKey : '••••••••••••••••••••'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="text-[#8A97AD] hover:text-[#E6EAF2] p-1"
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => copyToClipboard(deviceKey, 'key')}
                    className="text-[#8A97AD] hover:text-[#38BDF8] p-1"
                    title="Copy Key"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Test Link Button */}
            <div className="mt-1">
              <button
                onClick={handleTestLink}
                disabled={isTesting}
                className="w-full py-2 px-3 bg-[#172033] hover:bg-[#243049] border border-[#243049] hover:border-[#38BDF8] text-[#E6EAF2] rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer font-medium"
              >
                <Activity className="w-4 h-4 text-[#38BDF8]" />
                <span>{isTesting ? 'Testing Link...' : 'Test Server Link'}</span>
              </button>

              {testResult && (
                <div
                  className={`mt-2 p-2 rounded border flex items-center justify-between text-[11px] ${
                    testResult.ok
                      ? 'bg-[#34D399]/10 border-[#34D399]/40 text-[#34D399]'
                      : 'bg-[#F87171]/10 border-[#F87171]/40 text-[#F87171]'
                  }`}
                >
                  <span>{testResult.ok ? '✓ Server Link Verified' : '✕ Server Unreachable'}</span>
                  <span>RTT: {testResult.latency} ms</span>
                </div>
              )}
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center justify-center p-3 bg-[#0B0F17] rounded-lg border border-[#243049]">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Device Setup QR" className="w-36 h-36 rounded" />
            ) : (
              <div className="w-36 h-36 flex items-center justify-center text-[#8A97AD]">Loading QR...</div>
            )}
            <div className="text-[11px] text-[#8A97AD] mt-2 text-center">
              Scan with the Smartphone Telemetry app camera to auto-configure server and secret key.
            </div>
          </div>
        </div>

        {/* Live Payload Telemetry Snapshot */}
        {latestSample && (
          <div className="border-t border-[#243049] pt-3">
            <span className="text-[#8A97AD] text-[11px] block mb-2 uppercase">Live Device Telemetry Snapshot</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-[#0B0F17] p-2 rounded border border-[#243049]">
                <div className="text-[10px] text-[#8A97AD]">GNSS SATELLITES</div>
                <div className="text-sm text-[#E6EAF2] font-bold">{satsText}</div>
              </div>
              <div className="bg-[#0B0F17] p-2 rounded border border-[#243049]">
                <div className="text-[10px] text-[#8A97AD]">BATTERY / TEMP</div>
                <div className="text-sm text-[#E6EAF2] font-bold">
                  {latestSample.batt}% ({latestSample.batt_temp}°C)
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2 rounded border border-[#243049]">
                <div className="text-[10px] text-[#8A97AD]">GPS ACCURACY</div>
                <div className="text-sm text-[#E6EAF2] font-bold">
                  {latestSample.gps_acc ? `±${latestSample.gps_acc.toFixed(1)}m` : '--'}
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2 rounded border border-[#243049]">
                <div className="text-[10px] text-[#8A97AD]">LAST SAMPLE AGE</div>
                <div className="text-sm text-[#E6EAF2] font-bold">
                  {sampleAgeSec !== null ? `${sampleAgeSec}s ago` : '--'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
