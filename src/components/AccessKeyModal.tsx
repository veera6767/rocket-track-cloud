import React, { useState } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import { KeyRound, ShieldCheck, Server, AlertCircle, X, Loader2 } from 'lucide-react';

export const AccessKeyModal: React.FC = () => {
  const {
    viewerKey,
    setViewerKey,
    serverUrl,
    setServerUrl,
    isAccessModalOpen,
    setAccessModalOpen,
    setRole,
  } = useTelemetryStore();

  const [inputKey, setInputKey] = useState(viewerKey);
  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isAccessModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = inputKey.trim();
    const url = inputUrl.trim().replace(/\/$/, '');

    if (!key) {
      setError('Please provide a viewer or admin key');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      const res = await fetch(`${url}/api/whoami`, {
        headers: { 'x-viewer-key': key },
      });

      if (res.ok) {
        const data = await res.json();
        setServerUrl(url);
        setRole(data.role);
        setViewerKey(key);
        setAccessModalOpen(false);
      } else if (res.status === 401 || res.status === 403) {
        setError('Unauthorized: Invalid key. Enter a valid viewer or admin key.');
      } else {
        setError(`Server returned status ${res.status}`);
      }
    } catch (err: any) {
      setError(`Cannot reach server at ${url}: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
      onClick={(e) => {
        if (e.target === e.currentTarget && viewerKey) setAccessModalOpen(false);
      }}
    >
      <div
        className="bg-[#111826] border border-[#243049] p-6 rounded-xl max-w-md w-full shadow-2xl relative cursor-default text-xs font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {viewerKey && (
          <button
            onClick={() => setAccessModalOpen(false)}
            className="absolute top-4 right-4 text-[#8A97AD] hover:text-[#E6EAF2] p-1 rounded transition-colors"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#243049] pb-4 mb-5">
          <div className="p-2.5 bg-[#172033] border border-[#243049] rounded-lg text-[#38BDF8]">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-sm text-[#E6EAF2] tracking-wide uppercase">
              Ground Station Access
            </h2>
            <p className="text-[11px] text-[#8A97AD]">
              Enter access key to authenticate live telemetry session
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-[#8A97AD] uppercase mb-1.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Access Key (Viewer or Admin)</span>
            </label>
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="e.g. ground_station_viewer_2026"
              disabled={isVerifying}
              className="w-full bg-[#0B0F17] border border-[#243049] rounded-lg px-3 py-2 text-xs font-mono text-[#E6EAF2] focus:outline-none focus:border-[#38BDF8]"
            />
            <p className="text-[11px] text-[#8A97AD] mt-1">
              Viewer Key: <code className="text-[#38BDF8] font-mono">ground_station_viewer_2026</code>
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono text-[#8A97AD] uppercase mb-1.5 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Server Base URL</span>
            </label>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://localhost:3000"
              disabled={isVerifying}
              className="w-full bg-[#0B0F17] border border-[#243049] rounded-lg px-3 py-2 text-xs font-mono text-[#E6EAF2] focus:outline-none focus:border-[#38BDF8]"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[#F87171] text-xs font-mono bg-[#F87171]/10 p-2.5 rounded border border-[#F87171]/30">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2 text-xs font-mono">
            {viewerKey && (
              <button
                type="button"
                onClick={() => setAccessModalOpen(false)}
                disabled={isVerifying}
                className="px-4 py-2 border border-[#243049] rounded-lg text-[#8A97AD] hover:text-[#E6EAF2] hover:bg-[#172033] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isVerifying}
              className="flex items-center gap-2 px-4 py-2 bg-[#38BDF8] text-[#0B0F17] font-semibold rounded-lg hover:bg-[#0EA5E9] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Connect & Unlock</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
