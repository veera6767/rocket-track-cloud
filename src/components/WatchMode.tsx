import React, { useEffect, useState } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import {
  X,
  Gauge,
  Mountain,
  Satellite,
  Clock,
  Battery,
  Zap,
  Radio,
  WifiOff,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { TrailMap } from './TrailMap.js';

export const WatchMode: React.FC = () => {
  const {
    isWatchMode,
    setWatchMode,
    interpolatedSamples,
    deviceOnline,
    lastSampleAt,
    currentSession,
    linkLatencyMs,
  } = useTelemetryStore();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isWatchMode) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [isWatchMode]);

  if (!isWatchMode) return null;

  const latest = interpolatedSamples.length > 0 ? interpolatedSamples[interpolatedSamples.length - 1] : null;

  // Speed
  const speedMps = latest?.speed ?? 0;
  const speedKmh = speedMps * 3.6;

  // Altitude
  const altMeters = latest?.gps_alt ?? latest?.altitude ?? null;

  // Satellites
  const satsUsed = latest?.sats ?? null;
  const satsVis = latest?.sats_visible ?? null;

  // GPS Age
  const gpsAgeSec = latest?.gps_fix_t ? Math.max(0, Math.floor((now - latest.gps_fix_t) / 1000)) : null;

  // Battery
  const battPercent = latest?.batt ?? null;
  const battTemp = latest?.batt_temp ?? null;

  // Accel Mag
  const accelMag = latest?.accelMag ?? 9.81;
  const accelG = accelMag / 9.80665;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0F17] flex flex-col p-4 md:p-6 text-white font-mono select-none overflow-y-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-[#243049] mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8] animate-pulse" />
            <span className="text-sm font-bold tracking-wider uppercase text-[#E6EAF2]">
              WATCH MODE — GROUND STATION OBSERVER
            </span>
          </div>
          <span className="text-xs text-[#8A97AD] hidden sm:inline">
            {currentSession?.name || 'Live Telemetry Stream'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Badge */}
          {deviceOnline ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold text-[#34D399] border-[#34D399]/40 bg-[#34D399]/10">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>LIVE</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold text-[#F87171] border-[#F87171]/40 bg-[#F87171]/10">
              <WifiOff className="w-3.5 h-3.5" />
              <span>SIGNAL LOST</span>
            </div>
          )}

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg border border-[#243049] bg-[#111826] text-[#8A97AD] hover:text-[#38BDF8] transition-colors"
            title="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setWatchMode(false)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#243049] bg-[#172033] hover:bg-[#243049] text-xs text-[#E6EAF2] font-semibold transition-colors"
            title="Exit watch mode"
          >
            <X className="w-4 h-4 text-[#F87171]" />
            <span>EXIT</span>
          </button>
        </div>
      </div>

      {/* Main Content: Big Numbers Grid + Map */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Big Telemetry Numbers (7 cols on lg) */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4 auto-rows-fr">
          {/* 1. SPEED */}
          <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 md:p-5 flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-[#8A97AD]">
              <span className="text-xs uppercase font-semibold flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-[#38BDF8]" />
                Speed
              </span>
              <span className="text-[11px] text-[#8A97AD]">km/h</span>
            </div>
            <div className="my-2">
              <div className="text-3xl md:text-5xl font-black text-[#E6EAF2] tracking-tight tabular-nums">
                {speedKmh.toFixed(1)}
              </div>
              <div className="text-xs text-[#8A97AD] mt-1 tabular-nums">
                {speedMps.toFixed(2)} m/s
              </div>
            </div>
          </div>

          {/* 2. ALTITUDE */}
          <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 md:p-5 flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-[#8A97AD]">
              <span className="text-xs uppercase font-semibold flex items-center gap-1.5">
                <Mountain className="w-4 h-4 text-[#38BDF8]" />
                Altitude
              </span>
              <span className="text-[11px] text-[#8A97AD]">GPS (m)</span>
            </div>
            <div className="my-2">
              <div className="text-3xl md:text-5xl font-black text-[#E6EAF2] tracking-tight tabular-nums">
                {altMeters !== null ? altMeters.toFixed(1) : '--'}
              </div>
              <div className="text-xs text-[#8A97AD] mt-1">
                {altMeters !== null ? `${(altMeters * 3.28084).toFixed(0)} ft` : 'Awaiting 3D fix'}
              </div>
            </div>
          </div>

          {/* 3. SATELLITES */}
          <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 md:p-5 flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-[#8A97AD]">
              <span className="text-xs uppercase font-semibold flex items-center gap-1.5">
                <Satellite className="w-4 h-4 text-[#38BDF8]" />
                Satellites
              </span>
              <span className="text-[11px] text-[#8A97AD]">used / vis</span>
            </div>
            <div className="my-2">
              <div className="text-3xl md:text-5xl font-black text-[#38BDF8] tracking-tight tabular-nums">
                {satsUsed !== null ? (satsVis !== null ? `${satsUsed}/${satsVis}` : `${satsUsed}`) : '--'}
              </div>
              <div className="text-xs text-[#8A97AD] mt-1">
                Acc: {latest?.gps_acc !== null && latest?.gps_acc !== undefined ? `±${latest.gps_acc.toFixed(1)}m` : '--'}
              </div>
            </div>
          </div>

          {/* 4. GPS FIX AGE */}
          <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 md:p-5 flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-[#8A97AD]">
              <span className="text-xs uppercase font-semibold flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#38BDF8]" />
                GPS Age
              </span>
              <span className="text-[11px] text-[#8A97AD]">freshness</span>
            </div>
            <div className="my-2">
              <div
                className={`text-3xl md:text-5xl font-black tracking-tight tabular-nums ${
                  gpsAgeSec === null
                    ? 'text-[#8A97AD]'
                    : gpsAgeSec <= 2
                    ? 'text-[#34D399]'
                    : gpsAgeSec <= 5
                    ? 'text-[#FBBF24]'
                    : 'text-[#F87171]'
                }`}
              >
                {gpsAgeSec !== null ? `${gpsAgeSec}s` : '--'}
              </div>
              <div className="text-xs text-[#8A97AD] mt-1">
                Link: {linkLatencyMs !== null ? `${linkLatencyMs}ms` : 'n/a'}
              </div>
            </div>
          </div>

          {/* 5. BATTERY */}
          <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 md:p-5 flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-[#8A97AD]">
              <span className="text-xs uppercase font-semibold flex items-center gap-1.5">
                <Battery className="w-4 h-4 text-[#34D399]" />
                Battery
              </span>
              <span className="text-[11px] text-[#8A97AD]">{battTemp ? `${battTemp.toFixed(1)}°C` : ''}</span>
            </div>
            <div className="my-2">
              <div className="text-3xl md:text-5xl font-black text-[#E6EAF2] tracking-tight tabular-nums">
                {battPercent !== null ? `${battPercent}%` : '--'}
              </div>
              <div className="text-xs text-[#8A97AD] mt-1">
                Phone Payload Power
              </div>
            </div>
          </div>

          {/* 6. ACCELERATION */}
          <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 md:p-5 flex flex-col justify-between shadow-lg">
            <div className="flex items-center justify-between text-[#8A97AD]">
              <span className="text-xs uppercase font-semibold flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-[#FBBF24]" />
                Accel |a|
              </span>
              <span className="text-[11px] text-[#8A97AD]">g-force</span>
            </div>
            <div className="my-2">
              <div className="text-3xl md:text-5xl font-black text-[#E6EAF2] tracking-tight tabular-nums">
                {accelG.toFixed(2)}G
              </div>
              <div className="text-xs text-[#8A97AD] mt-1 tabular-nums">
                {accelMag.toFixed(1)} m/s²
              </div>
            </div>
          </div>
        </div>

        {/* Trail Map View (5 cols on lg) */}
        <div className="lg:col-span-5 bg-[#111826] border border-[#243049] rounded-xl overflow-hidden flex flex-col shadow-lg min-h-[350px]">
          <div className="px-4 py-2.5 bg-[#172033] border-b border-[#243049] flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-[#E6EAF2]">
              Live GPS Trail Tracking
            </span>
            <span className="text-[11px] text-[#38BDF8]">
              {latest?.lat && latest?.lon ? `${latest.lat.toFixed(5)}, ${latest.lon.toFixed(5)}` : 'Waiting for GPS'}
            </span>
          </div>
          <div className="flex-1 relative">
            <TrailMap />
          </div>
        </div>
      </div>
    </div>
  );
};
