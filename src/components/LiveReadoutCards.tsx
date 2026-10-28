import React, { useMemo, useState, useEffect } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import {
  Gauge,
  TrendingUp,
  Zap,
  Radio,
  Satellite,
  Battery,
  Compass,
  Crosshair,
  ShieldAlert,
} from 'lucide-react';

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

const Sparkline: React.FC<SparklineProps> = ({ data, color = '#38BDF8', height = 24 }) => {
  if (data.length < 2) {
    return <div style={{ height }} className="w-full" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 120;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-4 overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

export const LiveReadoutCards: React.FC = () => {
  const {
    interpolatedSamples,
    isReplayMode,
    replayIndex,
    useGForce,
    useDegPerSec,
    startGpsAlt,
    lastSampleAt,
    lastBatchReceivedAt,
    wsStatus,
  } = useTelemetryStore();

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const activeIdx = isReplayMode
    ? Math.min(replayIndex, interpolatedSamples.length - 1)
    : interpolatedSamples.length - 1;

  const current = interpolatedSamples[activeIdx];

  // Rolling history for sparklines (last 30 samples)
  const sparklineHistory = useMemo(() => {
    const slice = interpolatedSamples.slice(Math.max(0, activeIdx - 30), activeIdx + 1);
    return {
      speed: slice.map((s) => s.speed || 0),
      alt: slice.map((s) => s.heightAboveStart || (s.gps_alt && startGpsAlt ? s.gps_alt - startGpsAlt : 0)),
      accel: slice.map((s) => s.accelMag || 9.81),
      gyro: slice.map((s) => s.gyroMag || 0),
      sats: slice.map((s) => s.sats || 0),
      batt: slice.map((s) => s.batt || 0),
      bearing: slice.map((s) => s.bearing || 0),
    };
  }, [interpolatedSamples, activeIdx, startGpsAlt]);

  // Staleness calculations:
  // GPS fix is stale if older than 3 seconds
  // Sensors are stale if older than 1 second
  const gpsAgeMs = current?.gps_fix_t ? Math.max(0, now - current.gps_fix_t) : null;
  const isGpsStale = gpsAgeMs === null || gpsAgeMs > 3000;
  const gpsUpdatedText =
    gpsAgeMs !== null
      ? gpsAgeMs < 1000
        ? 'updated <1s ago'
        : `updated ${(gpsAgeMs / 1000).toFixed(0)}s ago`
      : 'no GPS fix';

  const sensorAgeMs = current?.t ? Math.max(0, now - current.t) : null;
  const isSensorStale = sensorAgeMs === null || sensorAgeMs > 1000;
  const sensorUpdatedText =
    sensorAgeMs !== null
      ? sensorAgeMs < 1000
        ? 'updated <1s ago'
        : `updated ${(sensorAgeMs / 1000).toFixed(0)}s ago`
      : 'no sensor data';

  // Speed
  const isStationary = current?.speed === null || current?.speed === undefined || current.speed < 0.5;
  const speedKmh = current?.speed !== null && current?.speed !== undefined ? (current.speed * 3.6).toFixed(1) : '--';
  const speedMps = current?.speed !== null && current?.speed !== undefined ? current.speed.toFixed(1) : '--';

  // Height above start (default) and raw ellipsoid
  const heightAboveStart =
    current?.heightAboveStart !== null && current?.heightAboveStart !== undefined
      ? current.heightAboveStart
      : current?.gps_alt !== null && current?.gps_alt !== undefined && startGpsAlt !== null
      ? current.gps_alt - startGpsAlt
      : null;
  const heightStr = heightAboveStart !== null ? heightAboveStart.toFixed(1) : '--';
  const rawEllipsoidStr = current?.gps_alt !== null && current?.gps_alt !== undefined ? `${current.gps_alt.toFixed(1)}m` : '--';
  const mslStr = current?.gps_msl_alt !== null && current?.gps_msl_alt !== undefined ? `${current.gps_msl_alt.toFixed(1)}m MSL` : null;

  // Accel
  const accelMag = current?.accelMag ?? 0;
  const accelVal =
    current?.accelMag !== undefined
      ? useGForce
        ? (current.accelMag / 9.80665).toFixed(2)
        : current.accelMag.toFixed(1)
      : '--';
  const accelUnit = useGForce ? 'g' : 'm/s²';

  // Gyro
  const gyroVal =
    current?.gyroMag !== undefined
      ? useDegPerSec
        ? ((current.gyroMag * 180) / Math.PI).toFixed(1)
        : current.gyroMag.toFixed(2)
      : '--';
  const gyroUnit = useDegPerSec ? '°/s' : 'rad/s';

  // Satellites
  const sats = current?.sats ?? null;
  const satsVis = current?.sats_visible ?? null;
  let satsDisplay: string;
  if (sats === null) {
    satsDisplay = 'not sent by phone';
  } else if (sats === 0) {
    satsDisplay = '0 (searching)';
  } else {
    satsDisplay = satsVis !== null ? `${sats}/${satsVis}` : `${sats}`;
  }

  // Heading
  const headingDisplay = isStationary
    ? 'stationary'
    : current?.bearing !== null && current?.bearing !== undefined
    ? `${current.bearing.toFixed(0)}°`
    : '--';

  // Weak GPS condition
  const isWeakGps =
    (current?.gps_acc !== null && current?.gps_acc !== undefined && current.gps_acc > 20) ||
    (current?.gps_provider !== null && current?.gps_provider !== undefined && current.gps_provider !== 'gps');

  // Socket connected but no batch arrived for 3s
  const isWaitingForData =
    wsStatus === 'connected' &&
    (now - lastBatchReceivedAt > 3000 || lastBatchReceivedAt === 0);

  return (
    <div className="w-full space-y-2.5">
      {/* Connected, waiting for data notice */}
      {isWaitingForData && (
        <div className="flex items-center justify-between px-3.5 py-1.5 rounded-lg border border-[#FBBF24]/50 bg-[#FBBF24]/10 text-[#FBBF24] text-xs font-mono">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span className="font-bold">Connected, waiting for data...</span>
          </div>
          <span className="text-[11px] text-[#8A97AD]">
            {lastBatchReceivedAt > 0
              ? `Last batch ${(Math.max(0, now - lastBatchReceivedAt) / 1000).toFixed(0)}s ago`
              : 'Awaiting incoming WebSocket stream'}
          </span>
        </div>
      )}

      {/* Weak GPS Warning Banner */}
      {isWeakGps && current && (
        <div className="flex items-center justify-between px-3.5 py-1.5 rounded-lg border border-[#FBBF24]/50 bg-[#FBBF24]/10 text-[#FBBF24] text-xs font-mono">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="font-bold">Weak GPS fix: go outdoors with a clear sky</span>
          </div>
          <span className="text-[11px] text-[#8A97AD] hidden sm:inline">
            Accuracy {current.gps_acc ? `±${current.gps_acc.toFixed(1)}m` : 'poor'}
            {current.gps_provider ? ` (${current.gps_provider})` : ''}
          </span>
        </div>
      )}

      {/* 8 Metric Readout Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 w-full">
        {/* 1. Speed */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isGpsStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">SPEED</span>
            <Gauge className={`w-3.5 h-3.5 ${isGpsStale ? 'text-[#FBBF24]' : 'text-[#38BDF8]'}`} />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-xl font-mono font-bold tabular-nums ${
                isGpsStale ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {speedKmh}
            </span>
            <span className="text-[10px] font-mono text-[#8A97AD] uppercase">km/h</span>
          </div>
          <Sparkline data={sparklineHistory.speed} color={isGpsStale ? '#FBBF24' : '#38BDF8'} />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD] tabular-nums">
            <span>{speedMps} m/s</span>
            <span className={isGpsStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{gpsUpdatedText}</span>
          </div>
        </div>

        {/* 2. Height Above Start (never labeled MSL) */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isGpsStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[10px] font-medium tracking-wider">HEIGHT (START)</span>
            <TrendingUp className={`w-3.5 h-3.5 ${isGpsStale ? 'text-[#FBBF24]' : 'text-[#34D399]'}`} />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-xl font-mono font-bold tabular-nums ${
                isGpsStale ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {heightStr}
            </span>
            <span className="text-[10px] font-mono text-[#8A97AD] uppercase">m</span>
          </div>
          <Sparkline data={sparklineHistory.alt} color={isGpsStale ? '#FBBF24' : '#34D399'} />
          <div className="flex flex-col text-[9px] font-mono text-[#8A97AD] leading-tight">
            <span className="truncate">GPS ellipsoid: {rawEllipsoidStr}</span>
            {mslStr && <span className="text-[#38BDF8] truncate">{mslStr}</span>}
          </div>
        </div>

        {/* 3. Total Acceleration |a| */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isSensorStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">TOTAL |a|</span>
            <Zap className={`w-3.5 h-3.5 ${isSensorStale ? 'text-[#FBBF24]' : 'text-[#38BDF8]'}`} />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-xl font-mono font-bold tabular-nums ${
                isSensorStale ? 'text-[#FBBF24]' : accelMag > 39.2 ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {accelVal}
            </span>
            <span className="text-[10px] font-mono text-[#8A97AD] uppercase">{accelUnit}</span>
          </div>
          <Sparkline data={sparklineHistory.accel} color={isSensorStale ? '#FBBF24' : '#38BDF8'} />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD] tabular-nums">
            <span>Z: {current?.accel_z?.toFixed(1) ?? '--'}</span>
            <span className={isSensorStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{sensorUpdatedText}</span>
          </div>
        </div>

        {/* 4. Angular Rate */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isSensorStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">ANG. RATE</span>
            <Radio className={`w-3.5 h-3.5 ${isSensorStale ? 'text-[#FBBF24]' : 'text-[#38BDF8]'}`} />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-xl font-mono font-bold tabular-nums ${
                isSensorStale ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {gyroVal}
            </span>
            <span className="text-[10px] font-mono text-[#8A97AD] uppercase">{gyroUnit}</span>
          </div>
          <Sparkline data={sparklineHistory.gyro} color={isSensorStale ? '#FBBF24' : '#38BDF8'} />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD] tabular-nums">
            <span>|B|: {current?.magMag?.toFixed(0) ?? '--'}µT</span>
            <span className={isSensorStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{sensorUpdatedText}</span>
          </div>
        </div>

        {/* 5. Satellites */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isGpsStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">SATELLITES</span>
            <Satellite className={`w-3.5 h-3.5 ${isGpsStale ? 'text-[#FBBF24]' : 'text-[#38BDF8]'}`} />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-sm md:text-base font-mono font-bold tabular-nums leading-tight ${
                isGpsStale || sats === 0 ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {satsDisplay}
            </span>
          </div>
          <Sparkline data={sparklineHistory.sats} color={isGpsStale ? '#FBBF24' : '#38BDF8'} />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD] truncate">
            <span>{current?.gps_acc ? `±${current.gps_acc.toFixed(1)}m` : 'GNSS'}</span>
            <span className={isGpsStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{gpsUpdatedText}</span>
          </div>
        </div>

        {/* 6. Battery */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isSensorStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">BATTERY</span>
            <Battery className="w-3.5 h-3.5 text-[#34D399]" />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-xl font-mono font-bold tabular-nums ${
                isSensorStale ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {current?.batt !== undefined ? `${current.batt}%` : '--'}
            </span>
            <span className="text-[10px] font-mono text-[#8A97AD]">
              {current?.batt_temp !== undefined ? `${current.batt_temp}°C` : ''}
            </span>
          </div>
          <Sparkline data={sparklineHistory.batt} color="#34D399" />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD]">
            <span>HEALTH OK</span>
            <span className={isSensorStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{sensorUpdatedText}</span>
          </div>
        </div>

        {/* 7. Heading (Stationary badge when < 0.5 m/s) */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isGpsStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">HEADING</span>
            <Compass className={`w-3.5 h-3.5 ${isGpsStale ? 'text-[#FBBF24]' : 'text-[#38BDF8]'}`} />
          </div>
          <div className="my-0.5 flex items-baseline gap-1">
            <span
              className={`text-lg md:text-xl font-mono font-bold tabular-nums ${
                isStationary ? 'text-[#FBBF24]' : isGpsStale ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
              }`}
            >
              {headingDisplay}
            </span>
            {!isStationary && <span className="text-[10px] font-mono text-[#8A97AD]">TRUE</span>}
          </div>
          <Sparkline data={sparklineHistory.bearing} color={isStationary ? '#FBBF24' : '#38BDF8'} />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD]">
            <span>{isStationary ? 'V < 0.5m/s' : 'BEARING'}</span>
            <span className={isGpsStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{gpsUpdatedText}</span>
          </div>
        </div>

        {/* 8. Coordinates (6 decimals) */}
        <div
          className={`bg-[#111826] border rounded-xl p-3 flex flex-col justify-between h-[112px] shadow-sm transition-colors ${
            isGpsStale ? 'border-[#FBBF24]/40 bg-[#172033]/90' : 'border-[#243049]'
          }`}
        >
          <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
            <span className="uppercase text-[11px] font-medium tracking-wider">COORDINATES</span>
            <Crosshair className={`w-3.5 h-3.5 ${isGpsStale ? 'text-[#FBBF24]' : 'text-[#38BDF8]'}`} />
          </div>
          <div className="my-0.5 flex flex-col text-[11px] font-mono text-[#E6EAF2] tabular-nums leading-tight">
            <div>{current?.lat !== null && current?.lat !== undefined ? current.lat.toFixed(6) : '--'}</div>
            <div>{current?.lon !== null && current?.lon !== undefined ? current.lon.toFixed(6) : '--'}</div>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-[#8A97AD]">
            <span>WGS-84</span>
            <span className={isGpsStale ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}>{gpsUpdatedText}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
