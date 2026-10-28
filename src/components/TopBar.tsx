import React, { useState, useEffect } from 'react';
import { useTelemetryStore, isSimulatorSession } from '../store/telemetryStore.js';
import {
  Rocket,
  Radio,
  WifiOff,
  Battery,
  Satellite,
  Clock,
  Volume2,
  VolumeX,
  KeyRound,
  RefreshCw,
  Smartphone,
  Navigation,
  Eye,
  Share2,
  Maximize,
  Minimize,
} from 'lucide-react';

export const TopBar: React.FC = () => {
  const {
    currentSession,
    currentSessionId,
    sessionsList,
    selectSession,
    fetchSessions,
    wsStatus,
    deviceOnline,
    activeDeviceId,
    ratePerSec,
    lastSampleAt,
    linkLatencyMs,
    interpolatedSamples,
    isSoundMuted,
    setSoundMuted,
    setAccessModalOpen,
    setDeviceLinkOpen,
    vehicleType,
    setVehicleType,
    role,
    setWatchMode,
    copyViewerLink,
  } = useTelemetryStore();

  const [signalLostElapsedSec, setSignalLostElapsedSec] = useState<number>(0);

  // Determine connection status: LIVE / WAITING / SIGNAL LOST
  // LIVE: deviceOnline is true and samples exist
  // WAITING: no samples received in session yet
  // SIGNAL LOST: had samples, but now deviceOnline is false (> 5s since last sample)
  const hasSamples = interpolatedSamples.length > 0;
  const isLive = wsStatus === 'connected' && deviceOnline && hasSamples;
  const isSignalLost = hasSamples && (!deviceOnline || (lastSampleAt && Date.now() - lastSampleAt >= 5000));
  const isWaiting = !hasSamples;

  // Running counter for "Signal lost 00:12 ago"
  useEffect(() => {
    if (!isSignalLost || !lastSampleAt) {
      setSignalLostElapsedSec(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - lastSampleAt) / 1000));
      setSignalLostElapsedSec(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [isSignalLost, lastSampleAt]);

  // Compute T+: MUST equal (last sample t minus first sample t), NEVER wall-clock time!
  const missionElapsedSec = hasSamples
    ? Math.max(0, Math.floor((interpolatedSamples[interpolatedSamples.length - 1].t - interpolatedSamples[0].t) / 1000))
    : 0;

  const formatTimer = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = Math.floor(totalSecs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTPlus = (totalSecs: number) => {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = Math.floor(totalSecs % 60);
    if (h > 0) {
      return `T+ ${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `T+ ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const latestSample = hasSamples ? interpolatedSamples[interpolatedSamples.length - 1] : null;

  // Last GPS Fix Age
  const gpsFixAgeSec =
    latestSample?.gps_fix_t && lastSampleAt
      ? Math.max(0, Math.floor((Date.now() - latestSample.gps_fix_t) / 1000))
      : null;

  const satsUsed = latestSample?.sats ?? null;
  const satsVis = latestSample?.sats_visible ?? null;
  const satsText = satsUsed !== null ? (satsVis !== null ? `${satsUsed}/${satsVis}` : `${satsUsed}`) : '--';

  return (
    <header className="w-full bg-[#111826] border-b border-[#243049] px-3 md:px-5 py-2 flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono sticky top-0 z-40 shadow-sm">
      {/* Zone 1: Brand & Session Picker */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-[#172033] border border-[#243049] rounded-lg text-[#38BDF8]">
            <Rocket className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm tracking-wide text-[#E6EAF2] uppercase whitespace-nowrap">
            ROCKET TRACK CLOUD
          </span>
        </div>

        {/* Session Picker with SIM / PHONE badge */}
        <div className="flex items-center gap-1.5 bg-[#0B0F17] border border-[#243049] rounded-lg px-2 py-1 text-xs">
          <select
            value={currentSessionId || 'latest-phone'}
            onChange={(e) => selectSession(e.target.value)}
            className="bg-transparent text-[#E6EAF2] font-mono text-xs focus:outline-none cursor-pointer max-w-[200px] truncate"
          >
            <option value="latest-phone" className="bg-[#111826] text-[#38BDF8]">
              [PHONE] Live latest PHONE
            </option>
            {sessionsList.map((s) => {
              const isSim = isSimulatorSession(s);
              const tag = isSim ? '[SIM]' : '[PHONE]';
              return (
                <option key={s.id} value={s.id} className="bg-[#111826] text-[#E6EAF2]">
                  {tag} {s.name} ({s.sampleCount} pts)
                </option>
              );
            })}
          </select>
          <button
            onClick={fetchSessions}
            className="text-[#8A97AD] hover:text-[#38BDF8] p-0.5 transition-colors"
            title="Refresh sessions"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Zone 2: Status Pill, T+ Clock, Metrics */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        {/* Status Pill */}
        {isLive ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold text-[#34D399] border-[#34D399]/40 bg-[#34D399]/10">
            <Radio className="w-3 h-3 text-[#34D399] animate-pulse" />
            <span>LIVE</span>
          </div>
        ) : isSignalLost ? (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold text-[#F87171] border-[#F87171]/40 bg-[#F87171]/10"
            title={`Signal lost at sample time. T+ is frozen.`}
          >
            <WifiOff className="w-3 h-3 text-[#F87171]" />
            <span>SIGNAL LOST ({formatTimer(signalLostElapsedSec)} ago)</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold text-[#FBBF24] border-[#FBBF24]/40 bg-[#FBBF24]/10">
            <Radio className="w-3 h-3 text-[#FBBF24]" />
            <span>WAITING FOR PHONE</span>
          </div>
        )}

        {/* T+ Clock (Frozen at last sample time if signal lost) */}
        <div
          className={`flex items-center gap-1.5 bg-[#0B0F17] border px-2.5 py-1 rounded-lg font-bold tabular-nums ${
            isSignalLost ? 'border-[#F87171]/40 text-[#F87171]' : 'border-[#243049] text-[#38BDF8]'
          }`}
          title={isSignalLost ? 'T+ frozen at last received telemetry timestamp' : 'T+ duration of current session'}
        >
          <Clock className="w-3.5 h-3.5 text-[#8A97AD]" />
          <span>{formatTPlus(missionElapsedSec)}</span>
          {isSignalLost && <span className="text-[10px] text-[#8A97AD] font-normal uppercase">FROZEN</span>}
        </div>

        {/* Rate (Hz) */}
        <div className="hidden sm:flex items-center gap-1 bg-[#0B0F17] border border-[#243049] px-2 py-1 rounded-lg text-[#E6EAF2] tabular-nums">
          <span className="text-[#8A97AD]">RATE:</span>
          <span className="text-[#34D399] font-bold">{ratePerSec}</span>
          <span className="text-[#8A97AD] text-[10px]">Hz</span>
        </div>

        {/* Link Latency */}
        <div
          className="hidden sm:flex items-center gap-1 bg-[#0B0F17] border border-[#243049] px-2 py-1 rounded-lg text-[#E6EAF2] tabular-nums"
          title="Phone-to-server ingest latency with clock offset removed"
        >
          <span className="text-[#8A97AD]">LINK:</span>
          <span className="text-[#38BDF8] font-bold">
            {linkLatencyMs !== null ? `${linkLatencyMs}ms` : 'n/a'}
          </span>
        </div>

        {/* GPS Fix Age & Satellites */}
        <div className="hidden md:flex items-center gap-1 bg-[#0B0F17] border border-[#243049] px-2 py-1 rounded-lg text-[#E6EAF2] tabular-nums">
          <Satellite className="w-3 h-3 text-[#38BDF8]" />
          <span>SATS {satsText}</span>
          {gpsFixAgeSec !== null && (
            <span className="text-[#8A97AD] text-[10px]">({gpsFixAgeSec}s ago)</span>
          )}
        </div>

        {/* Battery */}
        <div className="hidden lg:flex items-center gap-1 bg-[#0B0F17] border border-[#243049] px-2 py-1 rounded-lg text-[#E6EAF2] tabular-nums">
          <Battery className="w-3 h-3 text-[#34D399]" />
          <span>{latestSample?.batt !== undefined ? `${latestSample.batt}%` : '--'}</span>
        </div>
      </div>

      {/* Zone 3: Controls, Role Badge, Watch Mode & Device Link */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Role Badge */}
        {role === 'viewer' ? (
          <span className="px-2 py-0.5 rounded bg-[#172033] border border-[#243049] text-[10px] text-[#8A97AD] font-bold tracking-wider">
            VIEW ONLY
          </span>
        ) : role === 'admin' ? (
          <span className="px-2 py-0.5 rounded bg-[#38BDF8]/20 border border-[#38BDF8]/40 text-[10px] text-[#38BDF8] font-bold tracking-wider">
            ADMIN
          </span>
        ) : null}

        {/* Admin-only "Copy viewer link" */}
        {role === 'admin' && (
          <button
            onClick={copyViewerLink}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[#243049] bg-[#172033] hover:bg-[#243049] hover:border-[#38BDF8] text-[11px] text-[#38BDF8] transition-colors"
            title="Copy viewer link (https://<host>/#key=...)"
          >
            <Share2 className="w-3 h-3" />
            <span className="hidden xl:inline">SHARE LINK</span>
          </button>
        )}

        {/* Watch Mode Toggle */}
        <button
          onClick={() => setWatchMode(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#243049] bg-[#172033] hover:bg-[#243049] hover:border-[#38BDF8] text-[11px] text-[#E6EAF2] font-semibold transition-colors"
          title="Open Watch Mode (Big numbers & simple trail map for field observers)"
        >
          <Eye className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="hidden sm:inline">WATCH</span>
        </button>

        {/* Vehicle Type Toggle */}
        <div className="flex items-center bg-[#0B0F17] p-0.5 rounded-lg border border-[#243049]">
          <button
            onClick={() => setVehicleType('ground')}
            className={`px-2 py-1 rounded text-xs transition-colors font-medium ${
              vehicleType === 'ground'
                ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40'
                : 'text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
            title="Ground Vehicle Mode (Arrow pointer along heading)"
          >
            GROUND
          </button>
          <button
            onClick={() => setVehicleType('rocket')}
            className={`px-2 py-1 rounded text-xs transition-colors font-medium ${
              vehicleType === 'rocket'
                ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40'
                : 'text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
            title="Rocket Mode (3D rocket model oriented by phone attitude)"
          >
            ROCKET
          </button>
        </div>

        {/* Device Link Button (Admin only or when not strictly viewer) */}
        {role !== 'viewer' && (
          <button
            onClick={() => setDeviceLinkOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-[#172033] hover:bg-[#243049] border-[#243049] hover:border-[#38BDF8] text-xs font-mono font-medium text-[#E6EAF2] transition-colors"
            title="Open Device Link & Phone Connection Panel"
          >
            <Smartphone className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span className="hidden sm:inline">DEVICE LINK</span>
            <span
              className={`w-2 h-2 rounded-full ${
                deviceOnline ? 'bg-[#34D399] animate-pulse' : 'bg-[#FBBF24]'
              }`}
            />
          </button>
        )}

        {/* Audio Mute */}
        <button
          onClick={() => setSoundMuted(!isSoundMuted)}
          className="p-1.5 rounded-lg border border-[#243049] bg-[#0B0F17] text-[#8A97AD] hover:text-[#38BDF8] transition-colors"
          title={isSoundMuted ? 'Sound is muted (Click to unmute)' : 'Sound is active (Click to mute)'}
        >
          {isSoundMuted ? <VolumeX className="w-3.5 h-3.5 text-[#F87171]" /> : <Volume2 className="w-3.5 h-3.5 text-[#38BDF8]" />}
        </button>

        {/* Settings */}
        <button
          onClick={() => setAccessModalOpen(true)}
          className="p-1.5 rounded-lg border border-[#243049] bg-[#0B0F17] text-[#8A97AD] hover:text-[#38BDF8] transition-colors"
          title="Ground Station Access Settings"
        >
          <KeyRound className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
