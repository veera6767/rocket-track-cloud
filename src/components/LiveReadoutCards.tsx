import React, { useMemo } from 'react';
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
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-5 overflow-visible">
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
  const { interpolatedSamples, isReplayMode, replayIndex, useGForce, useDegPerSec } =
    useTelemetryStore();

  const activeIdx = isReplayMode
    ? Math.min(replayIndex, interpolatedSamples.length - 1)
    : interpolatedSamples.length - 1;

  const current = interpolatedSamples[activeIdx];

  // Rolling history for sparklines (last 30 samples)
  const sparklineHistory = useMemo(() => {
    const slice = interpolatedSamples.slice(Math.max(0, activeIdx - 30), activeIdx + 1);
    return {
      speed: slice.map((s) => s.speed || 0),
      alt: slice.map((s) => s.gps_alt || 0),
      accel: slice.map((s) => s.accelMag || 9.81),
      gyro: slice.map((s) => s.gyroMag || 0),
      sats: slice.map((s) => s.sats || 0),
      batt: slice.map((s) => s.batt || 0),
      bearing: slice.map((s) => s.bearing || 0),
    };
  }, [interpolatedSamples, activeIdx]);

  const speedKmh = current?.speed !== null && current?.speed !== undefined ? (current.speed * 3.6).toFixed(1) : '--';
  const speedMps = current?.speed !== null && current?.speed !== undefined ? current.speed.toFixed(1) : '--';
  const gpsAlt = current?.gps_alt !== null && current?.gps_alt !== undefined ? current.gps_alt.toFixed(1) : '--';

  const accelMag = current?.accelMag ?? 0;
  const accelVal =
    current?.accelMag !== undefined
      ? useGForce
        ? (current.accelMag / 9.80665).toFixed(2)
        : current.accelMag.toFixed(1)
      : '--';
  const accelUnit = useGForce ? 'g' : 'm/s²';

  const gyroMag = current?.gyroMag ?? 0;
  const gyroVal =
    current?.gyroMag !== undefined
      ? useDegPerSec
        ? ((current.gyroMag * 180) / Math.PI).toFixed(1)
        : current.gyroMag.toFixed(2)
      : '--';
  const gyroUnit = useDegPerSec ? '°/s' : 'rad/s';

  const satsUsed = current?.sats ?? null;
  const satsVis = current?.sats_visible ?? null;
  const satsText = satsUsed !== null ? (satsVis !== null ? `${satsUsed}/${satsVis}` : `${satsUsed}`) : '--';
  const cn0Text = current?.gps_cn0 !== null && current?.gps_cn0 !== undefined ? `${current.gps_cn0.toFixed(1)} dB-Hz` : null;

  const batt = current?.batt;
  const battTemp = current?.batt_temp;

  // Anomaly checks for coloring values ONLY when something is abnormal:
  // Normal colors: #E6EAF2 (bright white/slate)
  // Low battery: amber/red
  // High temp: red
  // High accel (> 4g): amber
  // Satellite count < 4: amber
  const isBattLow = batt !== undefined && batt < 20;
  const isBattCrit = batt !== undefined && batt < 10;
  const isTempHigh = battTemp !== undefined && battTemp > 45;
  const isHighAccel = accelMag > 39.2; // > 4g
  const isPoorGps = satsUsed !== null && satsUsed < 4;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 w-full">
      {/* 1. Speed */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">SPEED</span>
          <Gauge className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span className="text-xl font-mono font-bold text-[#E6EAF2] tabular-nums">
            {speedKmh}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD] uppercase">km/h</span>
        </div>
        <Sparkline data={sparklineHistory.speed} color="#38BDF8" />
        <div className="text-[10px] font-mono text-[#8A97AD] tabular-nums">
          {speedMps} m/s
        </div>
      </div>

      {/* 2. Altitude */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">ALTITUDE</span>
          <TrendingUp className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span className="text-xl font-mono font-bold text-[#E6EAF2] tabular-nums">
            {gpsAlt}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD] uppercase">m MSL</span>
        </div>
        <Sparkline data={sparklineHistory.alt} color="#38BDF8" />
        <div className="text-[10px] font-mono text-[#8A97AD]">
          GPS BARO N/A
        </div>
      </div>

      {/* 3. Total Acceleration |a| */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">TOTAL |a|</span>
          <Zap className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span
            className={`text-xl font-mono font-bold tabular-nums ${
              isHighAccel ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
            }`}
          >
            {accelVal}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD] uppercase">{accelUnit}</span>
        </div>
        <Sparkline data={sparklineHistory.accel} color={isHighAccel ? '#FBBF24' : '#38BDF8'} />
        <div className="text-[10px] font-mono text-[#8A97AD] tabular-nums">
          Z: {current?.accel_z?.toFixed(1) ?? '--'}
        </div>
      </div>

      {/* 4. Angular Rate */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">ANG. RATE</span>
          <Radio className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span className="text-xl font-mono font-bold text-[#E6EAF2] tabular-nums">
            {gyroVal}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD] uppercase">{gyroUnit}</span>
        </div>
        <Sparkline data={sparklineHistory.gyro} color="#38BDF8" />
        <div className="text-[10px] font-mono text-[#8A97AD] tabular-nums">
          |B|: {current?.magMag?.toFixed(0) ?? '--'} µT
        </div>
      </div>

      {/* 5. Satellites (used/visible & fix quality) */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">SATELLITES</span>
          <Satellite className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span
            className={`text-xl font-mono font-bold tabular-nums ${
              isPoorGps ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
            }`}
          >
            {satsText}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD]">FIXED</span>
        </div>
        <Sparkline data={sparklineHistory.sats} color={isPoorGps ? '#FBBF24' : '#38BDF8'} />
        <div className="text-[10px] font-mono text-[#8A97AD] truncate">
          {cn0Text || (current?.gps_acc ? `±${current.gps_acc.toFixed(1)}m` : '3D LOCK')}
        </div>
      </div>

      {/* 6. Battery & Thermal */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">BATTERY</span>
          <Battery
            className={`w-3.5 h-3.5 ${
              isBattCrit ? 'text-[#F87171]' : isBattLow ? 'text-[#FBBF24]' : 'text-[#34D399]'
            }`}
          />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span
            className={`text-xl font-mono font-bold tabular-nums ${
              isBattCrit ? 'text-[#F87171]' : isBattLow ? 'text-[#FBBF24]' : 'text-[#E6EAF2]'
            }`}
          >
            {batt !== undefined ? `${batt}%` : '--'}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD]">
            {battTemp !== undefined ? `${battTemp}°C` : ''}
          </span>
        </div>
        <Sparkline
          data={sparklineHistory.batt}
          color={isBattCrit ? '#F87171' : isBattLow ? '#FBBF24' : '#34D399'}
        />
        <div
          className={`text-[10px] font-mono ${
            isTempHigh ? 'text-[#F87171] font-bold' : 'text-[#8A97AD]'
          }`}
        >
          {isTempHigh ? 'TEMP WARN' : 'HEALTH OK'}
        </div>
      </div>

      {/* 7. Heading */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">HEADING</span>
          <Compass className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex items-baseline gap-1">
          <span className="text-xl font-mono font-bold text-[#E6EAF2] tabular-nums">
            {current?.bearing !== null && current?.bearing !== undefined ? `${current.bearing.toFixed(0)}°` : '--'}
          </span>
          <span className="text-[10px] font-mono text-[#8A97AD]">TRUE</span>
        </div>
        <Sparkline data={sparklineHistory.bearing} color="#38BDF8" />
        <div className="text-[10px] font-mono text-[#8A97AD]">
          PROX: {current?.prox !== null && current?.prox !== undefined ? `${current.prox}cm` : 'N/A'}
        </div>
      </div>

      {/* 8. Coordinates */}
      <div className="bg-[#111826] border border-[#243049] rounded-xl p-3 flex flex-col justify-between h-[108px] shadow-sm">
        <div className="flex items-center justify-between text-[#8A97AD] text-xs font-mono">
          <span className="uppercase text-[11px] font-medium tracking-wider">COORDINATES</span>
          <Crosshair className="w-3.5 h-3.5 text-[#38BDF8]" />
        </div>
        <div className="my-0.5 flex flex-col text-[11px] font-mono text-[#E6EAF2] tabular-nums leading-tight">
          <div>{current?.lat !== null && current?.lat !== undefined ? current.lat.toFixed(5) : '--'}</div>
          <div>{current?.lon !== null && current?.lon !== undefined ? current.lon.toFixed(5) : '--'}</div>
        </div>
        <div className="text-[10px] font-mono text-[#8A97AD]">
          WGS-84 GNSS
        </div>
      </div>
    </div>
  );
};
