import React, { useState, useEffect } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import QRCode from 'qrcode';
import {
  Smartphone,
  Copy,
  Check,
  Eye,
  EyeOff,
  Radio,
  Satellite,
  Play,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

export const EmptyPhoneState: React.FC = () => {
  const { serverUrl, viewerKey, useSimulatorData, setDeviceLinkOpen } = useTelemetryStore();
  const [deviceKey, setDeviceKey] = useState('rocket_device_secret_2026');
  const [showKey, setShowKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  useEffect(() => {
    fetch(`${serverUrl}/api/config/device?key=${encodeURIComponent(viewerKey)}`, {
      headers: { 'x-viewer-key': viewerKey },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.deviceKey) setDeviceKey(data.deviceKey);
      })
      .catch(() => {});
  }, [serverUrl, viewerKey]);

  useEffect(() => {
    const payload = JSON.stringify({
      url: serverUrl,
      deviceKey: deviceKey,
      deviceId: 'phone_android_live',
    });
    QRCode.toDataURL(payload, {
      width: 140,
      margin: 1,
      color: { dark: '#38BDF8', light: '#111826' },
    })
      .then((url) => setQrCodeUrl(url))
      .catch(() => {});
  }, [serverUrl, deviceKey]);

  const copyText = (text: string, type: 'url' | 'key') => {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="w-full bg-[#111826] border border-[#243049] rounded-xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-8 shadow-sm">
      {/* Left: Setup Instructions */}
      <div className="flex-1 max-w-2xl">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 bg-[#172033] border border-[#243049] rounded-lg text-[#38BDF8]">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base md:text-lg font-semibold text-[#E6EAF2]">
                Waiting for Phone Telemetry
              </h2>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono font-medium text-[#FBBF24] bg-[#FBBF24]/10 border border-[#FBBF24]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24] animate-pulse" />
                LISTENING
              </span>
            </div>
            <p className="text-xs text-[#8A97AD] mt-0.5">
              Live Phone Mode is active. Complete these 4 steps on your Android device to stream live sensor data:
            </p>
          </div>
        </div>

        {/* 4 Setup Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {/* Step 1: Server URL */}
          <div className="bg-[#172033] border border-[#243049] rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-medium text-[#8A97AD] mb-1.5">
              <span className="text-[#38BDF8] font-mono">STEP 1</span>
              <span>Server URL</span>
            </div>
            <div className="flex items-center justify-between gap-1.5 bg-[#0B0F17] px-2.5 py-1.5 rounded border border-[#243049]">
              <span className="font-mono text-xs text-[#E6EAF2] truncate">{serverUrl}</span>
              <button
                onClick={() => copyText(serverUrl, 'url')}
                className="text-[#8A97AD] hover:text-[#38BDF8] transition-colors p-1"
                title="Copy Server URL"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Step 2: Device Key */}
          <div className="bg-[#172033] border border-[#243049] rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-medium text-[#8A97AD] mb-1.5">
              <span className="text-[#38BDF8] font-mono">STEP 2</span>
              <span>Device Key</span>
            </div>
            <div className="flex items-center justify-between gap-1.5 bg-[#0B0F17] px-2.5 py-1.5 rounded border border-[#243049]">
              <span className="font-mono text-xs text-[#E6EAF2] truncate">
                {showKey ? deviceKey : '••••••••••••••••'}
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
                  onClick={() => copyText(deviceKey, 'key')}
                  className="text-[#8A97AD] hover:text-[#38BDF8] p-1"
                  title="Copy Device Key"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Step 3: Start Streaming */}
          <div className="bg-[#172033] border border-[#243049] rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-medium text-[#8A97AD] mb-1.5">
              <span className="text-[#38BDF8] font-mono">STEP 3</span>
              <span>Start Streaming</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#E6EAF2]">
              <Radio className="w-4 h-4 text-[#38BDF8] shrink-0" />
              <span>Toggle "Start Streaming" in Android app</span>
            </div>
          </div>

          {/* Step 4: GPS Fix */}
          <div className="bg-[#172033] border border-[#243049] rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-medium text-[#8A97AD] mb-1.5">
              <span className="text-[#38BDF8] font-mono">STEP 4</span>
              <span>GNSS Lock</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#E6EAF2]">
              <Satellite className="w-4 h-4 text-[#34D399] shrink-0" />
              <span>Wait for GPS fix (&gt;= 4 satellites outdoor)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: QR Code & Use Simulator Data fallback */}
      <div className="flex flex-col items-center justify-center gap-3 shrink-0 border-t md:border-t-0 md:border-l border-[#243049] pt-4 md:pt-0 md:pl-8">
        {qrCodeUrl && (
          <div className="p-2 bg-[#0B0F17] border border-[#243049] rounded-lg">
            <img src={qrCodeUrl} alt="Device Setup QR Code" className="w-28 h-28 rounded" />
          </div>
        )}
        <div className="text-[11px] font-mono text-[#8A97AD] text-center">
          Scan QR from Android App
        </div>

        <div className="flex flex-col gap-2 w-full mt-1">
          <button
            onClick={() => setDeviceLinkOpen(true)}
            className="w-full py-1.5 px-3 bg-[#172033] hover:bg-[#243049] border border-[#243049] hover:border-[#38BDF8] rounded-lg text-xs font-mono font-medium text-[#E6EAF2] flex items-center justify-center gap-1.5 transition-colors"
          >
            <span>Open Device Link</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#38BDF8]" />
          </button>

          <button
            onClick={useSimulatorData}
            className="w-full py-1.5 px-3 bg-[#0EA5E9]/15 hover:bg-[#0EA5E9]/25 border border-[#38BDF8]/40 hover:border-[#38BDF8] rounded-lg text-xs font-mono font-medium text-[#38BDF8] flex items-center justify-center gap-1.5 transition-colors"
            title="Load existing simulator data instead of waiting for a phone"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Use simulator data</span>
          </button>
        </div>
      </div>
    </div>
  );
};
