import React, { useState, useEffect, useMemo } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import {
  X,
  Copy,
  Check,
  Activity,
  Satellite,
  Clock,
  Compass,
  Radio,
  Zap,
  ShieldAlert,
  Hash,
} from 'lucide-react';

export const DiagnosticsDrawer: React.FC = () => {
  const {
    isDiagnosticsOpen,
    setDiagnosticsOpen,
    interpolatedSamples,
    lastBatchReceivedAt,
    seqStep,
    lastSampleAt,
    deviceOnline,
    wsStatus,
  } = useTelemetryStore();

  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isDiagnosticsOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [isDiagnosticsOpen]);

  const latestSample =
    interpolatedSamples.length > 0
      ? interpolatedSamples[interpolatedSamples.length - 1]
      : null;

  // Number of distinct GPS fixes in the last 60 seconds
  const distinctFixes60s = useMemo(() => {
    if (interpolatedSamples.length === 0) return 0;
    const cutoff = now - 60000;
    const fixSet = new Set<number>();
    for (let i = interpolatedSamples.length - 1; i >= 0; i--) {
      const s = interpolatedSamples[i];
      if (s.t < cutoff) break;
      if (s.gps_fix_t !== null && s.gps_fix_t !== undefined) {
        fixSet.add(s.gps_fix_t);
      }
    }
    return fixSet.size;
  }, [interpolatedSamples, now]);

  if (!isDiagnosticsOpen) return null;

  const handleCopyJson = () => {
    if (!latestSample) return;
    const jsonStr = JSON.stringify(latestSample, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const batchAgeMs = lastBatchReceivedAt > 0 ? Math.max(0, now - lastBatchReceivedAt) : null;
  const batchAgeText =
    batchAgeMs !== null
      ? batchAgeMs < 1000
        ? `${batchAgeMs}ms ago`
        : `${(batchAgeMs / 1000).toFixed(1)}s ago`
      : 'No batch received';

  const gpsFixAgeMs =
    latestSample?.gps_fix_t !== null && latestSample?.gps_fix_t !== undefined
      ? Math.max(0, now - latestSample.gps_fix_t)
      : null;
  const gpsFixAgeText =
    gpsFixAgeMs !== null
      ? gpsFixAgeMs < 1000
        ? `${gpsFixAgeMs}ms ago`
        : `${(gpsFixAgeMs / 1000).toFixed(1)}s ago`
      : 'No fix recorded';

  const sats = latestSample?.sats ?? null;
  const satsVis = latestSample?.sats_visible ?? null;
  const satsText =
    sats === null
      ? 'not sent by phone'
      : sats === 0
      ? '0 (searching)'
      : `${sats}${satsVis !== null ? ` / ${satsVis} visible` : ''}`;

  const provider = latestSample?.gps_provider || 'not specified';
  const isGpsProvider = provider === 'gps';
  const isWeakGps =
    (latestSample?.gps_acc !== null &&
      latestSample?.gps_acc !== undefined &&
      latestSample.gps_acc > 20) ||
    !isGpsProvider;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
      <div className="w-full max-w-md bg-[#111826] border-l border-[#243049] flex flex-col h-full shadow-2xl text-xs font-mono text-[#E6EAF2] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#243049] flex items-center justify-between bg-[#0B0F17]">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#38BDF8]" />
            <span className="font-bold uppercase tracking-wider text-sm text-[#E6EAF2]">
              STATIC VALUES DIAGNOSTICS
            </span>
          </div>
          <button
            onClick={() => setDiagnosticsOpen(false)}
            className="p-1 rounded-lg text-[#8A97AD] hover:text-[#E6EAF2] hover:bg-[#172033] transition-colors"
            title="Close diagnostics"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Diagnostic Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Weak GPS Warning if active */}
          {isWeakGps && latestSample && (
            <div className="p-3 rounded-lg border border-[#FBBF24]/40 bg-[#FBBF24]/10 text-[#FBBF24] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Weak GPS Fix Detected</div>
                <div className="text-[11px] text-[#FBBF24]/90 mt-0.5">
                  Go outdoors with a clear sky for optimal 3D trajectory accuracy.
                </div>
              </div>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Last Batch Time */}
            <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
              <div className="text-[10px] text-[#8A97AD] uppercase">LAST BATCH RECEIVED</div>
              <div className="text-sm font-bold text-[#38BDF8] mt-1 truncate">
                {batchAgeText}
              </div>
              <div className="text-[10px] text-[#8A97AD] mt-0.5">
                {lastBatchReceivedAt > 0 ? new Date(lastBatchReceivedAt).toLocaleTimeString() : '--'}
              </div>
            </div>

            {/* Last Seq & Seq Step */}
            <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
              <div className="text-[10px] text-[#8A97AD] uppercase">LAST SEQ / STEP</div>
              <div className="text-sm font-bold text-[#E6EAF2] mt-1">
                {latestSample ? latestSample.seq : '--'}{' '}
                <span className="text-xs text-[#34D399] font-normal">(step {seqStep})</span>
              </div>
              <div className="text-[10px] text-[#8A97AD] mt-0.5">
                Expected seq delta: {seqStep}
              </div>
            </div>

            {/* Last GPS Fix Age */}
            <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
              <div className="text-[10px] text-[#8A97AD] uppercase">GPS FIX TIME & AGE</div>
              <div
                className={`text-sm font-bold mt-1 ${
                  gpsFixAgeMs && gpsFixAgeMs > 3000 ? 'text-[#FBBF24]' : 'text-[#34D399]'
                }`}
              >
                {gpsFixAgeText}
              </div>
              <div className="text-[10px] text-[#8A97AD] mt-0.5">
                {latestSample?.gps_fix_t
                  ? new Date(latestSample.gps_fix_t).toLocaleTimeString()
                  : '--'}
              </div>
            </div>

            {/* Distinct Fixes in 60s */}
            <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
              <div className="text-[10px] text-[#8A97AD] uppercase">FIXES IN LAST 60s</div>
              <div className="text-sm font-bold text-[#E6EAF2] mt-1">
                {distinctFixes60s}{' '}
                <span className="text-xs text-[#8A97AD] font-normal">distinct fixes</span>
              </div>
              <div className="text-[10px] text-[#8A97AD] mt-0.5">
                Rate: ~{(distinctFixes60s / 60).toFixed(1)} Hz GNSS
              </div>
            </div>

            {/* GPS Provider */}
            <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
              <div className="text-[10px] text-[#8A97AD] uppercase">GPS PROVIDER</div>
              <div
                className={`text-sm font-bold mt-1 uppercase ${
                  isGpsProvider ? 'text-[#34D399]' : 'text-[#FBBF24]'
                }`}
              >
                {provider}
              </div>
              <div className="text-[10px] text-[#8A97AD] mt-0.5">
                {isGpsProvider ? 'Hardware GNSS Chip' : 'Fused / Network fallback'}
              </div>
            </div>

            {/* GPS Accuracy */}
            <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
              <div className="text-[10px] text-[#8A97AD] uppercase">ESTIMATED ACCURACY</div>
              <div
                className={`text-sm font-bold mt-1 ${
                  latestSample?.gps_acc && latestSample.gps_acc > 20
                    ? 'text-[#FBBF24]'
                    : 'text-[#38BDF8]'
                }`}
              >
                {latestSample?.gps_acc !== null && latestSample?.gps_acc !== undefined
                  ? `±${latestSample.gps_acc.toFixed(1)} m`
                  : 'N/A'}
              </div>
              <div className="text-[10px] text-[#8A97AD] mt-0.5">
                Horizontal 1-sigma circle
              </div>
            </div>
          </div>

          {/* Satellites Full Readout */}
          <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
            <div className="text-[10px] text-[#8A97AD] uppercase">SATELLITES STATUS</div>
            <div className="text-sm font-bold text-[#E6EAF2] mt-1">{satsText}</div>
            <div className="text-[10px] text-[#8A97AD] mt-0.5">
              C/N0 Carrier-to-Noise:{' '}
              {latestSample?.gps_cn0 !== null && latestSample?.gps_cn0 !== undefined
                ? `${latestSample.gps_cn0.toFixed(1)} dB-Hz`
                : 'N/A'}
            </div>
          </div>

          {/* Coordinates (6 decimals) */}
          <div className="bg-[#0B0F17] p-3 rounded-lg border border-[#243049]">
            <div className="text-[10px] text-[#8A97AD] uppercase">GNSS COORDINATES (6 DECIMALS)</div>
            <div className="text-xs font-bold text-[#E6EAF2] mt-1">
              LAT: {latestSample?.lat !== null && latestSample?.lat !== undefined ? latestSample.lat.toFixed(6) : '--'}
            </div>
            <div className="text-xs font-bold text-[#E6EAF2] mt-0.5">
              LON: {latestSample?.lon !== null && latestSample?.lon !== undefined ? latestSample.lon.toFixed(6) : '--'}
            </div>
            <div className="text-[10px] text-[#8A97AD] mt-1">
              Ellipsoid Height: {latestSample?.gps_alt !== null && latestSample?.gps_alt !== undefined ? `${latestSample.gps_alt.toFixed(1)} m` : '--'}
              {latestSample?.gps_msl_alt !== null && latestSample?.gps_msl_alt !== undefined && (
                <span> | MSL: {latestSample.gps_msl_alt.toFixed(1)} m</span>
              )}
            </div>
          </div>

          {/* Raw Last Sample JSON with Copy Button */}
          <div className="bg-[#0B0F17] rounded-lg border border-[#243049] overflow-hidden">
            <div className="p-2.5 bg-[#172033] border-b border-[#243049] flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#E6EAF2] uppercase">
                RAW LAST SAMPLE JSON
              </span>
              <button
                onClick={handleCopyJson}
                disabled={!latestSample}
                className="flex items-center gap-1 px-2 py-1 bg-[#111826] hover:bg-[#243049] border border-[#243049] text-[#38BDF8] rounded text-[10px] transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-[#34D399]" />
                    <span className="text-[#34D399]">COPIED</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>COPY JSON</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 text-[11px] text-[#8A97AD] overflow-x-auto max-h-56 leading-relaxed select-text">
              {latestSample ? JSON.stringify(latestSample, null, 2) : '// No samples received yet'}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#243049] bg-[#0B0F17] flex items-center justify-between text-[11px] text-[#8A97AD]">
          <span>WebSocket: {wsStatus}</span>
          <span className={deviceOnline ? 'text-[#34D399]' : 'text-[#F87171]'}>
            Device {deviceOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  );
};
