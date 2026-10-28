import React, { useEffect } from 'react';
import { useTelemetryStore } from '../store/telemetryStore.js';
import { Smartphone, Zap, X, Info } from 'lucide-react';

export const HudToast: React.FC = () => {
  const { lastToast, setToast } = useTelemetryStore();

  useEffect(() => {
    if (!lastToast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [lastToast, setToast]);

  if (!lastToast) return null;

  const isPhone = lastToast.type === 'phone';

  return (
    <div className="fixed top-16 right-4 z-50 max-w-sm w-full pointer-events-auto">
      <div
        className={`p-4 rounded-xl border backdrop-blur-md shadow-lg flex items-start gap-3 relative transition-all ${
          isPhone
            ? 'bg-[#111826] border-[#34D399]/50'
            : 'bg-[#111826] border-[#38BDF8]/40'
        }`}
      >
        <div
          className={`p-2 rounded-lg border shrink-0 ${
            isPhone
              ? 'bg-[#34D399]/15 border-[#34D399]/40 text-[#34D399]'
              : 'bg-[#38BDF8]/15 border-[#38BDF8]/40 text-[#38BDF8]'
          }`}
        >
          {isPhone ? <Smartphone className="w-4 h-4" /> : <Info className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0 pr-6">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-xs font-semibold tracking-wider uppercase font-mono ${
                isPhone ? 'text-[#34D399]' : 'text-[#38BDF8]'
              }`}
            >
              {lastToast.title}
            </span>
          </div>
          <p className="text-xs font-mono text-[#E6EAF2] break-words leading-relaxed">
            {lastToast.message}
          </p>
        </div>

        <button
          onClick={() => setToast(null)}
          className="absolute top-3 right-3 text-[#8A97AD] hover:text-[#E6EAF2] p-1 rounded transition-colors"
          title="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
