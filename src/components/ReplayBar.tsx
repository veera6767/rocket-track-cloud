import React, { useEffect } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import { Play, Pause, Radio } from 'lucide-react';

export const ReplayBar: React.FC = () => {
  const {
    interpolatedSamples,
    isReplayMode,
    isPlaying,
    replayIndex,
    replaySpeed,
    toggleReplayPlay,
    setReplayIndex,
    setReplaySpeed,
    exitReplay,
  } = useTelemetryStore();

  const total = interpolatedSamples.length;
  const currentSample = interpolatedSamples[Math.min(replayIndex, Math.max(0, total - 1))];

  // Replay animation interval
  useEffect(() => {
    if (!isReplayMode || !isPlaying || total === 0) return;

    const interval = setInterval(() => {
      const state = useTelemetryStore.getState();
      const nextIdx = state.replayIndex + state.replaySpeed * 2;
      if (nextIdx >= total - 1) {
        state.setReplayIndex(total - 1);
        state.toggleReplayPlay();
      } else {
        state.setReplayIndex(nextIdx);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isReplayMode, isPlaying, replaySpeed, total]);

  if (total === 0) return null;

  return (
    <div className="w-full bg-[#111826] border border-[#243049] p-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-mono shadow-sm">
      {/* Controls: Play/Pause, Speeds, Live Jump */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleReplayPlay}
          className={`p-2 rounded-lg border transition-colors cursor-pointer ${
            isPlaying
              ? 'bg-[#FBBF24]/20 border-[#FBBF24]/50 text-[#FBBF24]'
              : 'bg-[#38BDF8]/20 border-[#38BDF8]/50 text-[#38BDF8]'
          }`}
          title={isPlaying ? 'Pause Replay' : 'Play Replay'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        {/* Speed selectors */}
        <div className="flex items-center gap-1 bg-[#0B0F17] p-1 rounded-lg border border-[#243049]">
          {[1, 2, 5, 10].map((spd) => (
            <button
              key={spd}
              onClick={() => setReplaySpeed(spd)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors cursor-pointer ${
                replaySpeed === spd
                  ? 'bg-[#38BDF8]/30 text-[#38BDF8]'
                  : 'text-[#8A97AD] hover:text-[#E6EAF2]'
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>

        {/* Jump to Live */}
        <button
          onClick={exitReplay}
          className={`px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            !isReplayMode
              ? 'bg-[#34D399]/20 border-[#34D399]/50 text-[#34D399]'
              : 'border-[#243049] text-[#8A97AD] hover:text-[#34D399] hover:border-[#34D399]/40'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>LIVE TRACK</span>
        </button>
      </div>

      {/* Scrubber Range Slider */}
      <div className="flex-1 min-w-[200px] flex items-center gap-3">
        <input
          type="range"
          min="0"
          max={Math.max(0, total - 1)}
          value={replayIndex}
          onChange={(e) => setReplayIndex(parseInt(e.target.value, 10))}
          className="w-full h-2 bg-[#0B0F17] rounded-lg appearance-none cursor-pointer accent-[#38BDF8]"
        />
        <div className="text-[#8A97AD] tabular-nums shrink-0 text-right w-24">
          <span className="text-[#38BDF8] font-bold">{replayIndex + 1}</span> / {total}
        </div>
      </div>

      {/* Current Scrubber Timestamp */}
      {currentSample && (
        <div className="text-[#8A97AD] tabular-nums shrink-0">
          T: <span className="text-[#E6EAF2]">{new Date(currentSample.t).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};
