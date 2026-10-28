import React, { useMemo, useState } from 'react';
import { useTelemetryStore, XAxisType, TimeWindow } from '../store/telemetryStore.js';
import { lttbDownsample } from '../../shared/math.js';
import { InterpolatedSample } from '../../shared/types.js';
import {
  Activity,
  Zap,
  Radio,
  Compass,
  Satellite,
  AlertCircle,
  Eye,
  EyeOff,
  Filter,
} from 'lucide-react';

interface ChartPoint {
  rawIndex: number;
  xVal: number;
  yVals: number[];
  t: number;
  lat: number | null;
  lon: number | null;
  isInterpolated?: boolean;
}

// Compute moving average for smoothing
function movingAverage(data: number[], windowSize: number): number[] {
  if (windowSize <= 1 || data.length === 0) return data;
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= windowSize) {
      sum -= data[i - windowSize];
      result.push(sum / windowSize);
    } else {
      result.push(sum / (i + 1));
    }
  }
  return result;
}

export const SensorCharts: React.FC = () => {
  const {
    interpolatedSamples,
    xAxis,
    setXAxis,
    useGForce,
    setUseGForce,
    useDegPerSec,
    setUseDegPerSec,
    hoveredIndex,
    setHoveredIndex,
    chartSmoothing,
    setChartSmoothing,
    hideMagnitude,
    setHideMagnitude,
    timeWindow,
    setTimeWindow,
    followLive,
    setFollowLive,
    setReplayIndex,
  } = useTelemetryStore();

  const [activeTab, setActiveTab] = useState<'accel' | 'gyro' | 'mag' | 'gps'>('accel');
  const [tooltipPoint, setTooltipPoint] = useState<ChartPoint | null>(null);

  // Time window filtering
  const windowFilteredSamples = useMemo(() => {
    if (interpolatedSamples.length === 0) return [];
    if (timeWindow === 'all') return interpolatedSamples;

    const lastT = interpolatedSamples[interpolatedSamples.length - 1].t;
    let windowMs = 30000;
    if (timeWindow === '2m') windowMs = 120000;
    else if (timeWindow === '10m') windowMs = 600000;

    const cutoff = lastT - windowMs;
    return interpolatedSamples.filter((s) => s.t >= cutoff);
  }, [interpolatedSamples, timeWindow]);

  // Extract X-axis coordinate
  const getXVal = (s: InterpolatedSample, startTime: number): number => {
    if (xAxis === 'lat') return s.lat ?? 0;
    if (xAxis === 'lon') return s.lon ?? 0;
    if (xAxis === 'distance') return s.distanceMeters || 0;
    return (s.t - startTime) / 1000; // Time in seconds
  };

  // Prepare and smooth series data
  const chartData = useMemo(() => {
    if (windowFilteredSamples.length === 0) return [];
    const startTime = interpolatedSamples[0]?.t || windowFilteredSamples[0].t;

    let filtered = windowFilteredSamples;
    if (xAxis === 'lat' || xAxis === 'lon') {
      filtered = windowFilteredSamples.filter((s) => s.lat !== null && s.lon !== null);
      if (filtered.length < 2) return [];
    }

    const gFactor = useGForce ? 1 / 9.80665 : 1;
    const degFactor = useDegPerSec ? 180 / Math.PI : 1;

    // Build raw arrays
    const rawArrays: number[][] = [];
    if (activeTab === 'accel') {
      rawArrays.push(filtered.map((s) => s.accel_x * gFactor));
      rawArrays.push(filtered.map((s) => s.accel_y * gFactor));
      rawArrays.push(filtered.map((s) => s.accel_z * gFactor));
      if (!hideMagnitude) {
        rawArrays.push(filtered.map((s) => (s.accelMag || 0) * gFactor));
      }
    } else if (activeTab === 'gyro') {
      rawArrays.push(filtered.map((s) => s.gyro_x * degFactor));
      rawArrays.push(filtered.map((s) => s.gyro_y * degFactor));
      rawArrays.push(filtered.map((s) => s.gyro_z * degFactor));
      if (!hideMagnitude) {
        rawArrays.push(filtered.map((s) => (s.gyroMag || 0) * degFactor));
      }
    } else if (activeTab === 'mag') {
      rawArrays.push(filtered.map((s) => s.mag_x));
      rawArrays.push(filtered.map((s) => s.mag_y));
      rawArrays.push(filtered.map((s) => s.mag_z));
      if (!hideMagnitude) {
        rawArrays.push(filtered.map((s) => s.magMag || 0));
      }
    } else if (activeTab === 'gps') {
      rawArrays.push(filtered.map((s) => s.speed || 0));
      rawArrays.push(filtered.map((s) => s.gps_alt || 0));
      rawArrays.push(filtered.map((s) => s.sats || 0));
      rawArrays.push(filtered.map((s) => s.gps_acc || 0));
    }

    // Apply smoothing if enabled
    const smoothedArrays = chartSmoothing > 0
      ? rawArrays.map((arr) => movingAverage(arr, chartSmoothing))
      : rawArrays;

    const mapped: ChartPoint[] = filtered.map((s, idx) => ({
      rawIndex: idx,
      xVal: getXVal(s, startTime),
      yVals: smoothedArrays.map((arr) => arr[idx]),
      t: s.t,
      lat: s.lat,
      lon: s.lon,
      isInterpolated: s.isInterpolated,
    }));

    // Downsample using LTTB for performance (max ~1000 points)
    return lttbDownsample(
      mapped,
      1000,
      (d) => d.xVal,
      (d) => d.yVals[0] || 0
    );
  }, [windowFilteredSamples, xAxis, activeTab, useGForce, useDegPerSec, hideMagnitude, chartSmoothing, interpolatedSamples]);

  // Compute nice symmetric bounds
  const { minX, maxX, minY, maxY, yTicks } = useMemo(() => {
    if (chartData.length === 0) {
      return { minX: 0, maxX: 1, minY: -10, maxY: 10, yTicks: [-10, -5, 0, 5, 10] };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const pt of chartData) {
      if (pt.xVal < minX) minX = pt.xVal;
      if (pt.xVal > maxX) maxX = pt.xVal;
      for (const y of pt.yVals) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (minX === maxX) maxX = minX + 1;

    // Symmetric zero baseline for accel, gyro, mag offsets
    if (activeTab === 'accel' || activeTab === 'gyro' || activeTab === 'mag') {
      const maxAbs = Math.max(Math.abs(minY), Math.abs(maxY), 1);
      // Round up to nice number
      const niceLimit = Math.ceil(maxAbs * 1.1);
      minY = -niceLimit;
      maxY = niceLimit;
      const step = niceLimit / 2;
      return {
        minX,
        maxX,
        minY,
        maxY,
        yTicks: [-niceLimit, -step, 0, step, niceLimit],
      };
    } else {
      // GPS altitude and speed
      minY = Math.min(0, minY);
      const span = maxY - minY || 10;
      maxY = Math.ceil(maxY + span * 0.1);
      const step = (maxY - minY) / 4;
      return {
        minX,
        maxX,
        minY,
        maxY,
        yTicks: [minY, minY + step, minY + 2 * step, minY + 3 * step, maxY],
      };
    }
  }, [chartData, activeTab]);

  // SVG dimensions
  const svgWidth = 840;
  const svgHeight = 240;
  const padLeft = 52;
  const padRight = 20;
  const padTop = 16;
  const padBottom = 32;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const toSvgX = (x: number) => padLeft + ((x - minX) / (maxX - minX)) * plotW;
  const toSvgY = (y: number) => padTop + plotH - ((y - minY) / (maxY - minY)) * plotH;

  // Series details
  const seriesMeta = useMemo(() => {
    if (activeTab === 'accel') {
      const list = [
        { name: 'X', color: '#38BDF8', dashed: false },
        { name: 'Y', color: '#F472B6', dashed: false },
        { name: 'Z', color: '#FBBF24', dashed: false },
      ];
      if (!hideMagnitude) {
        list.push({ name: '|A|', color: '#E6EAF2', dashed: true });
      }
      return list;
    } else if (activeTab === 'gyro') {
      const list = [
        { name: 'X', color: '#38BDF8', dashed: false },
        { name: 'Y', color: '#F472B6', dashed: false },
        { name: 'Z', color: '#FBBF24', dashed: false },
      ];
      if (!hideMagnitude) {
        list.push({ name: '|Ω|', color: '#E6EAF2', dashed: true });
      }
      return list;
    } else if (activeTab === 'mag') {
      const list = [
        { name: 'X', color: '#38BDF8', dashed: false },
        { name: 'Y', color: '#F472B6', dashed: false },
        { name: 'Z', color: '#FBBF24', dashed: false },
      ];
      if (!hideMagnitude) {
        list.push({ name: '|B|', color: '#E6EAF2', dashed: true });
      }
      return list;
    } else {
      return [
        { name: 'Speed (m/s)', color: '#38BDF8', dashed: false },
        { name: 'Alt (m)', color: '#34D399', dashed: false },
        { name: 'Sats', color: '#FBBF24', dashed: false },
        { name: 'Accuracy (m)', color: '#A78BFA', dashed: false },
      ];
    }
  }, [activeTab, hideMagnitude]);

  const linePaths = useMemo(() => {
    if (chartData.length < 2) return [];
    const numSeries = seriesMeta.length;
    const paths: string[] = [];

    for (let sIdx = 0; sIdx < numSeries; sIdx++) {
      let d = '';
      for (let i = 0; i < chartData.length; i++) {
        const pt = chartData[i];
        const val = pt.yVals[sIdx];
        if (val === undefined || isNaN(val)) continue;
        const x = toSvgX(pt.xVal);
        const y = toSvgY(val);
        if (d === '') d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        else d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      paths.push(d);
    }
    return paths;
  }, [chartData, seriesMeta, minX, maxX, minY, maxY]);

  // Handle cursor interaction
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (chartData.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;
    const dataX = minX + ((mouseX - padLeft) / plotW) * (maxX - minX);

    // Find nearest point
    let closest = chartData[0];
    let minDiff = Infinity;
    for (const pt of chartData) {
      const diff = Math.abs(pt.xVal - dataX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = pt;
      }
    }
    setTooltipPoint(closest);
    setHoveredIndex(closest.rawIndex);
  };

  const handleSvgMouseLeave = () => {
    setTooltipPoint(null);
    setHoveredIndex(null);
  };

  const handleSvgClick = () => {
    if (tooltipPoint) {
      setReplayIndex(tooltipPoint.rawIndex);
    }
  };

  const unitLabel =
    activeTab === 'accel'
      ? useGForce ? 'g' : 'm/s²'
      : activeTab === 'gyro'
      ? useDegPerSec ? '°/s' : 'rad/s'
      : activeTab === 'mag'
      ? 'µT'
      : 'Telemetry Units';

  const isLoopingWarning = xAxis === 'lat' || xAxis === 'lon';

  return (
    <div className="bg-[#111826] border border-[#243049] rounded-xl p-4 flex flex-col gap-3 shadow-sm w-full">
      {/* Top Header & Tab Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243049] pb-3">
        {/* Sensor Tabs */}
        <div className="flex items-center gap-1 bg-[#0B0F17] p-1 rounded-lg border border-[#243049]">
          <button
            onClick={() => setActiveTab('accel')}
            className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
              activeTab === 'accel' ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
          >
            ACCELEROMETER
          </button>
          <button
            onClick={() => setActiveTab('gyro')}
            className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
              activeTab === 'gyro' ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
          >
            GYROSCOPE
          </button>
          <button
            onClick={() => setActiveTab('mag')}
            className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
              activeTab === 'mag' ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
          >
            MAGNETOMETER
          </button>
          <button
            onClick={() => setActiveTab('gps')}
            className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors ${
              activeTab === 'gps' ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40' : 'text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
          >
            GPS TELEMETRY
          </button>
        </div>

        {/* Chart Settings Toolbar */}
        <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
          {/* X-Axis selector */}
          <div className="flex items-center gap-1 bg-[#0B0F17] px-2 py-1 rounded border border-[#243049]">
            <span className="text-[#8A97AD]">X:</span>
            <select
              value={xAxis}
              onChange={(e) => setXAxis(e.target.value as XAxisType)}
              className="bg-transparent text-[#38BDF8] focus:outline-none cursor-pointer"
            >
              <option value="time" className="bg-[#111826] text-[#E6EAF2]">Time (s)</option>
              <option value="distance" className="bg-[#111826] text-[#E6EAF2]">Distance (m)</option>
              <option value="lat" className="bg-[#111826] text-[#E6EAF2]">Latitude</option>
              <option value="lon" className="bg-[#111826] text-[#E6EAF2]">Longitude</option>
            </select>
          </div>

          {/* Time Window selector */}
          <div className="flex items-center gap-1 bg-[#0B0F17] px-2 py-1 rounded border border-[#243049]">
            <span className="text-[#8A97AD]">WINDOW:</span>
            <select
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
              className="bg-transparent text-[#38BDF8] focus:outline-none cursor-pointer"
            >
              <option value="30s" className="bg-[#111826] text-[#E6EAF2]">30 s</option>
              <option value="2m" className="bg-[#111826] text-[#E6EAF2]">2 min</option>
              <option value="10m" className="bg-[#111826] text-[#E6EAF2]">10 min</option>
              <option value="all" className="bg-[#111826] text-[#E6EAF2]">All</option>
            </select>
          </div>

          {/* Smoothing toggle */}
          <div className="flex items-center gap-1 bg-[#0B0F17] px-2 py-1 rounded border border-[#243049]">
            <span className="text-[#8A97AD]">SMOOTH:</span>
            <select
              value={chartSmoothing}
              onChange={(e) => setChartSmoothing(parseInt(e.target.value, 10) as any)}
              className="bg-transparent text-[#38BDF8] focus:outline-none cursor-pointer"
            >
              <option value={0} className="bg-[#111826] text-[#E6EAF2]">Off</option>
              <option value={5} className="bg-[#111826] text-[#E6EAF2]">5 pts</option>
              <option value={10} className="bg-[#111826] text-[#E6EAF2]">10 pts</option>
              <option value={20} className="bg-[#111826] text-[#E6EAF2]">20 pts</option>
            </select>
          </div>

          {/* Magnitude toggle */}
          {activeTab !== 'gps' && (
            <button
              onClick={() => setHideMagnitude(!hideMagnitude)}
              className={`px-2 py-1 rounded border transition-colors ${
                hideMagnitude
                  ? 'border-[#243049] text-[#8A97AD]'
                  : 'bg-[#38BDF8]/15 border-[#38BDF8]/40 text-[#38BDF8]'
              }`}
              title="Toggle Magnitude series visibility"
            >
              {hideMagnitude ? 'Mag Hidden' : 'Mag Shown'}
            </button>
          )}

          {/* Follow Live toggle */}
          <button
            onClick={() => setFollowLive(!followLive)}
            className={`px-2 py-1 rounded border transition-colors ${
              followLive
                ? 'bg-[#34D399]/15 border-[#34D399]/40 text-[#34D399]'
                : 'border-[#243049] text-[#8A97AD]'
            }`}
            title="Auto-follow live sensor data"
          >
            {followLive ? 'Live Track' : 'Static'}
          </button>
        </div>
      </div>

      {/* Looping Route Hint */}
      {isLoopingWarning && (
        <div className="flex items-center gap-2 bg-[#FBBF24]/10 border border-[#FBBF24]/30 px-3 py-1.5 rounded-lg text-xs font-mono text-[#FBBF24]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Notice: On looping or reversing circuits, Lat/Lon is not monotonic. Time or Distance X-axis is recommended.</span>
        </div>
      )}

      {/* Legend & Unit Label */}
      <div className="flex items-center justify-between text-xs font-mono text-[#8A97AD]">
        <div className="flex items-center gap-4">
          <span className="text-[#E6EAF2] font-semibold">{activeTab.toUpperCase()} ({unitLabel})</span>
          {seriesMeta.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className="w-3 h-0.5 inline-block"
                style={{
                  backgroundColor: s.color,
                  borderTop: s.dashed ? '1px dashed #E6EAF2' : undefined,
                }}
              />
              <span className="text-xs text-[#E6EAF2]">{s.name}</span>
            </div>
          ))}
        </div>

        {tooltipPoint && (
          <div className="flex items-center gap-3 text-xs tabular-nums text-[#38BDF8] bg-[#0B0F17] px-2 py-0.5 rounded border border-[#243049]">
            <span>X: {tooltipPoint.xVal.toFixed(2)}</span>
            {tooltipPoint.yVals.map((v, i) => (
              <span key={i} style={{ color: seriesMeta[i]?.color }}>
                {seriesMeta[i]?.name}: {v.toFixed(1)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* SVG Plot Canvas */}
      <div className="relative w-full overflow-hidden bg-[#0B0F17] rounded-lg border border-[#243049]">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-[220px] select-none cursor-crosshair"
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={handleSvgMouseLeave}
          onClick={handleSvgClick}
        >
          {/* Subtle Grid Lines */}
          {yTicks.map((tickVal) => {
            const yPos = toSvgY(tickVal);
            return (
              <g key={tickVal}>
                <line
                  x1={padLeft}
                  y1={yPos}
                  x2={svgWidth - padRight}
                  y2={yPos}
                  stroke={tickVal === 0 ? '#334366' : '#1A2436'}
                  strokeWidth={tickVal === 0 ? 1.5 : 1}
                />
                <text
                  x={padLeft - 8}
                  y={yPos + 3.5}
                  fill="#8A97AD"
                  fontSize="9"
                  fontFamily="JetBrains Mono"
                  textAnchor="end"
                >
                  {tickVal.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* Series Polylines */}
          {linePaths.map((pathStr, idx) => (
            <path
              key={idx}
              d={pathStr}
              fill="none"
              stroke={seriesMeta[idx]?.color || '#38BDF8'}
              strokeWidth="1.5"
              strokeDasharray={seriesMeta[idx]?.dashed ? '4 4' : undefined}
              strokeOpacity={seriesMeta[idx]?.dashed ? 0.7 : 1}
            />
          ))}

          {/* Interactive Hover Crosshair */}
          {tooltipPoint && (
            <g>
              <line
                x1={toSvgX(tooltipPoint.xVal)}
                y1={padTop}
                x2={toSvgX(tooltipPoint.xVal)}
                y2={svgHeight - padBottom}
                stroke="#38BDF8"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              {tooltipPoint.yVals.map((v, i) => (
                <circle
                  key={i}
                  cx={toSvgX(tooltipPoint.xVal)}
                  cy={toSvgY(v)}
                  r="3.5"
                  fill={seriesMeta[i]?.color || '#38BDF8'}
                  stroke="#0B0F17"
                  strokeWidth="1"
                />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
