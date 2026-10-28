import React, { useState } from 'react';
import { useTelemetryStore, deriveSessionStats, isSimulatorSession } from '../store/telemetryStore.js';
import {
  Trash2,
  FileSpreadsheet,
  FileCode,
  Layers,
  AlertTriangle,
  Clock,
} from 'lucide-react';

export const SessionStatsPanel: React.FC = () => {
  const {
    interpolatedSamples,
    currentSession,
    currentSessionId,
    serverUrl,
    viewerKey,
    sessionsList,
    ghostSessionId,
    loadGhostSession,
    deleteCurrentSession,
    role,
  } = useTelemetryStore();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const stats = deriveSessionStats(interpolatedSamples);

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleExportCsv = () => {
    if (!currentSessionId) return;
    const url = `${serverUrl}/api/sessions/${currentSessionId}/export.csv?key=${encodeURIComponent(
      viewerKey
    )}`;
    window.location.href = url;
  };

  const handleExportJson = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(interpolatedSamples, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `session_${currentSessionId}_telemetry.json`;
    a.click();
  };

  return (
    <div className="w-full bg-[#111826] border border-[#243049] p-4 rounded-xl flex flex-col gap-4 shadow-sm">
      {/* Header & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243049] pb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#38BDF8]" />
          <span className="font-semibold text-[#E6EAF2] text-xs uppercase tracking-wide">
            MISSION SUMMARY & STATS
          </span>
          <span className="text-[#8A97AD] font-mono text-xs">
            [{currentSession?.name || currentSessionId}]
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Ghost Track Selector */}
          <div className="flex items-center gap-1.5 bg-[#0B0F17] px-2.5 py-1.5 rounded-lg border border-[#243049] text-xs font-mono">
            <Layers className="w-3.5 h-3.5 text-[#F472B6]" />
            <span className="text-[#8A97AD]">Ghost:</span>
            <select
              value={ghostSessionId || ''}
              onChange={(e) => loadGhostSession(e.target.value || null)}
              className="bg-transparent text-[#F472B6] text-xs focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-[#111826] text-[#8A97AD]">
                None (Off)
              </option>
              {sessionsList
                .filter((s) => s.id !== currentSessionId)
                .map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#111826] text-[#E6EAF2]">
                    {isSimulatorSession(s) ? '[SIM]' : '[PHONE]'} {s.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Export CSV */}
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#172033] hover:bg-[#243049] border border-[#243049] text-[#E6EAF2] hover:text-[#38BDF8] rounded-lg text-xs font-mono transition-colors cursor-pointer"
            title="Download Telemetry CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>CSV</span>
          </button>

          {/* Export JSON */}
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#172033] hover:bg-[#243049] border border-[#243049] text-[#E6EAF2] hover:text-[#38BDF8] rounded-lg text-xs font-mono transition-colors cursor-pointer"
            title="Download Telemetry JSON"
          >
            <FileCode className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>JSON</span>
          </button>

          {/* Delete Session (Admin Only) */}
          {role === 'admin' && currentSessionId && currentSessionId !== 'latest' && currentSessionId !== 'latest-phone' && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#F87171]/10 border border-[#F87171]/30 text-[#F87171] hover:bg-[#F87171]/20 rounded-lg text-xs font-mono transition-colors cursor-pointer"
              title="Delete Session (Admin only)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid of Key Mission Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3 font-mono tabular-nums text-xs">
        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">DURATION</div>
          <div className="text-base font-bold text-[#E6EAF2]">
            {formatDuration(stats.durationSeconds)}
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">DISTANCE</div>
          <div className="text-base font-bold text-[#E6EAF2]">
            {(stats.distanceMeters / 1000).toFixed(2)}{' '}
            <span className="text-[10px] font-normal text-[#8A97AD]">km</span>
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">MAX SPEED</div>
          <div className="text-base font-bold text-[#E6EAF2]">
            {stats.maxSpeedKmh.toFixed(1)}{' '}
            <span className="text-[10px] font-normal text-[#8A97AD]">km/h</span>
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">MAX ACCEL</div>
          <div className="text-base font-bold text-[#E6EAF2]">
            {stats.maxAccelG.toFixed(2)}{' '}
            <span className="text-[10px] font-normal text-[#8A97AD]">g</span>
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">MAX ALTITUDE</div>
          <div className="text-base font-bold text-[#E6EAF2]">
            {stats.maxAltitudeMeters.toFixed(1)}{' '}
            <span className="text-[10px] font-normal text-[#8A97AD]">m</span>
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">TOTAL SAMPLES</div>
          <div className="text-base font-bold text-[#E6EAF2]">
            {stats.sampleCount}
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">AVG RATE</div>
          <div className="text-base font-bold text-[#34D399]">
            {stats.avgRateHz}{' '}
            <span className="text-[10px] font-normal text-[#8A97AD]">Hz</span>
          </div>
        </div>

        <div className="bg-[#0B0F17] p-2.5 rounded-lg border border-[#243049]">
          <div className="text-[10px] text-[#8A97AD] uppercase">DROPPED PKTS</div>
          <div className={`text-base font-bold ${stats.packetsLost > 0 ? 'text-[#FBBF24]' : 'text-[#8A97AD]'}`}>
            {stats.packetsLost}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#111826] border border-[#F87171]/40 p-5 rounded-xl max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-[#F87171] font-bold">
              <AlertTriangle className="w-5 h-5" />
              <span>DELETE SESSION</span>
            </div>
            <p className="text-xs text-[#E6EAF2]">
              Are you sure you want to permanently delete session{' '}
              <span className="font-mono text-[#38BDF8] font-bold">{currentSessionId}</span>? All
              telemetry samples will be permanently removed.
            </p>
            <div className="flex justify-end gap-2 text-xs font-mono">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 rounded border border-[#243049] text-[#8A97AD] hover:bg-[#172033]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  await deleteCurrentSession();
                }}
                className="px-3 py-1.5 rounded bg-[#F87171] text-[#0B0F17] font-bold hover:bg-[#F87171]/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
