import React, { useEffect, useState } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import { Rocket, RefreshCw, Server, AlertCircle } from 'lucide-react';

export const ServerWakingUpScreen: React.FC = () => {
  const { serverStatus, serverUrl, setServerStatus, checkAuthAndRole, fetchSessions } = useTelemetryStore();
  const [countdown, setCountdown] = useState(5);
  const [isRetrying, setIsRetrying] = useState(false);

  const retryNow = async () => {
    setIsRetrying(true);
    try {
      const res = await fetch(`${serverUrl}/api/health`);
      if (res.ok) {
        setServerStatus('online');
        await checkAuthAndRole();
        await fetchSessions();
      }
    } catch {
      // Still asleep
      setCountdown(5);
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (serverStatus !== 'waking_up') return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          retryNow();
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [serverStatus, serverUrl]);

  if (serverStatus !== 'waking_up') return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0F17] flex flex-col items-center justify-center p-6 text-center select-none font-mono">
      {/* Background ambient gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#172033]/40 via-[#0B0F17] to-[#0B0F17] pointer-events-none" />

      <div className="relative z-10 max-w-md w-full bg-[#111826] border border-[#243049] rounded-2xl p-8 shadow-2xl flex flex-col items-center">
        {/* Animated Rocket Icon */}
        <div className="relative mb-6">
          <div className="absolute -inset-4 rounded-full bg-[#38BDF8]/10 blur-md animate-pulse" />
          <div className="w-16 h-16 rounded-2xl bg-[#172033] border border-[#243049] flex items-center justify-center text-[#38BDF8] shadow-inner">
            <Rocket className="w-8 h-8 animate-bounce" />
          </div>
        </div>

        {/* Title & Description */}
        <h2 className="text-lg font-bold text-[#E6EAF2] tracking-wider uppercase mb-2">
          Server Waking Up
        </h2>
        <p className="text-xs text-[#8A97AD] leading-relaxed mb-6">
          Free cloud instances (such as Render) sleep after periods of inactivity.
          The backend service is booting up now; this typically takes 20–40 seconds.
        </p>

        {/* Server Target */}
        <div className="w-full bg-[#0B0F17] border border-[#243049] rounded-lg px-3 py-2 flex items-center justify-center gap-2 text-xs text-[#8A97AD] mb-6">
          <Server className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="truncate">{serverUrl}</span>
        </div>

        {/* Countdown & Action */}
        <div className="flex flex-col items-center gap-3 w-full">
          <div className="text-xs text-[#8A97AD] flex items-center gap-2">
            <RefreshCw className={`w-3.5 h-3.5 text-[#38BDF8] ${isRetrying ? 'animate-spin' : ''}`} />
            <span>
              {isRetrying ? 'Checking connection...' : `Auto-retrying in ${countdown}s`}
            </span>
          </div>

          <button
            onClick={retryNow}
            disabled={isRetrying}
            className="w-full py-2.5 px-4 bg-[#38BDF8] hover:bg-[#0EA5E9] text-[#0B0F17] font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>Retry Connection Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};
