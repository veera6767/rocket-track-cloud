import React from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import { Compass } from 'lucide-react';

export const AttitudeIndicator: React.FC = () => {
  const { interpolatedSamples, isReplayMode, replayIndex } = useTelemetryStore();

  const activeIdx = isReplayMode
    ? Math.min(replayIndex, interpolatedSamples.length - 1)
    : interpolatedSamples.length - 1;

  const current = interpolatedSamples[activeIdx];
  const roll = current?.roll ?? 0;
  const pitch = current?.pitch ?? 0;
  const yaw = current?.yaw ?? 0;

  // Pitch ladder offset: each degree shifts horizon by 1.6px (clamped)
  const pitchOffset = Math.max(-36, Math.min(36, pitch * 1.6));

  return (
    <div className="bg-[#111826] border border-[#243049] rounded-xl p-3.5 flex flex-col items-center justify-between h-full shadow-sm">
      {/* Title */}
      <div className="w-full flex items-center justify-between text-xs font-mono text-[#8A97AD] border-b border-[#243049] pb-2">
        <span className="font-medium uppercase tracking-wider text-[#E6EAF2]">ATTITUDE // ADI</span>
        <span className="text-[11px] text-[#8A97AD]">FUSED IMU</span>
      </div>

      {/* Artificial Horizon Instrument Circle */}
      <div className="relative w-36 h-36 rounded-full border border-[#243049] overflow-hidden my-2 bg-[#0B0F17] shadow-inner">
        {/* Sky / Ground Horizon Disk (Rotated by Roll and Shifted by Pitch) */}
        <div
          className="absolute inset-[-50%] w-[200%] h-[200%] transition-transform duration-75"
          style={{
            transform: `translateY(${pitchOffset}px) rotate(${-roll}deg)`,
            background: 'linear-gradient(to bottom, #17253D 50%, #2A2016 50%)',
          }}
        >
          {/* Horizon Line */}
          <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-[#38BDF8]" />

          {/* Pitch Ladder Marks */}
          {[-20, -10, 10, 20].map((deg) => (
            <div
              key={deg}
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-[8px] font-mono text-[#E6EAF2]/70"
              style={{ top: `calc(50% - ${deg * 1.6}px)` }}
            >
              <div className="w-3 h-[1px] bg-[#E6EAF2]/40" />
              <span>{Math.abs(deg)}</span>
              <div className="w-3 h-[1px] bg-[#E6EAF2]/40" />
            </div>
          ))}
        </div>

        {/* Fixed Aircraft Reticle (Center crosshair) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-12 h-6 flex items-center justify-center">
            <div className="w-3.5 h-[1.5px] bg-[#FBBF24]" />
            <div className="w-2 h-2 rounded-full border border-[#FBBF24] bg-transparent" />
            <div className="w-3.5 h-[1.5px] bg-[#FBBF24]" />
          </div>
        </div>

        {/* Roll Pointer at Top */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-[#FBBF24]" />
      </div>

      {/* Numerical Attitude Readouts (Roll, Pitch, Yaw) */}
      <div className="w-full grid grid-cols-3 gap-2 text-center text-xs font-mono tabular-nums border-t border-[#243049] pt-2">
        <div className="bg-[#0B0F17] p-1.5 rounded border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD]">ROLL</div>
          <div className="text-[#38BDF8] font-bold">{roll.toFixed(1)}°</div>
        </div>
        <div className="bg-[#0B0F17] p-1.5 rounded border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD]">PITCH</div>
          <div className="text-[#F472B6] font-bold">{pitch.toFixed(1)}°</div>
        </div>
        <div className="bg-[#0B0F17] p-1.5 rounded border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD]">YAW</div>
          <div className="text-[#FBBF24] font-bold">{yaw.toFixed(1)}°</div>
        </div>
      </div>
    </div>
  );
};
