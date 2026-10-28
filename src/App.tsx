import React, { useEffect, useState } from 'react';
import { useTelemetryStore } from './store/telemetryStore.js';
import { TopBar } from './components/TopBar.js';
import { ThreeTrailViewer } from './components/ThreeTrailViewer.js';
import { TrailMap } from './components/TrailMap.js';
import { SensorCharts } from './components/SensorCharts.js';
import { AttitudeIndicator } from './components/AttitudeIndicator.js';
import { LiveReadoutCards } from './components/LiveReadoutCards.js';
import { ReplayBar } from './components/ReplayBar.js';
import { SessionStatsPanel } from './components/SessionStatsPanel.js';
import { AccessKeyModal } from './components/AccessKeyModal.js';
import { DeviceLinkModal } from './components/DeviceLinkModal.js';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer.js';
import { HudToast } from './components/HudToast.js';
import { EmptyPhoneState } from './components/EmptyPhoneState.js';
import {
  Box,
  Map as MapIcon,
  Activity,
  Layers,
  Compass,
} from 'lucide-react';
import { ServerWakingUpScreen } from './components/ServerWakingUpScreen.js';
import { WatchMode } from './components/WatchMode.js';

export default function App() {
  const {
    initWebSocket,
    fetchSessions,
    checkAuthAndRole,
    cinemaMode,
    waitingForPhone,
    currentSession,
  } = useTelemetryStore();

  const [booting, setBooting] = useState(true);
  const [activeMobileTab, setActiveMobileTab] = useState<'3d' | 'map' | 'charts' | 'stats' | 'adi'>('3d');
  const [desktopViewMode, setDesktopViewMode] = useState<'3d-primary' | 'split' | 'map-primary'>('3d-primary');

  // Boot sequence
  useEffect(() => {
    checkAuthAndRole();
    fetchSessions();
    initWebSocket();

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setBooting(false), prefersReduced ? 50 : 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#E6EAF2] flex flex-col font-sans antialiased selection:bg-[#38BDF8]/20 selection:text-[#38BDF8]">
      {/* Server Waking Up Screen (Free tier instance spinup handling) */}
      <ServerWakingUpScreen />

      {/* Watch Mode Fullscreen Screen */}
      <WatchMode />

      {/* Toast Notifications */}
      <HudToast />

      {/* Access Key Modal */}
      <AccessKeyModal />

      {/* Device Link Modal */}
      <DeviceLinkModal />

      {/* Diagnostics Drawer */}
      <DiagnosticsDrawer />

      {/* Boot Splash */}
      {booting && (
        <div className="fixed inset-0 z-50 bg-[#0B0F17] flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-10 h-10 mb-4 border-2 border-[#38BDF8] border-t-transparent rounded-full animate-spin" />
          <div className="font-mono font-bold text-[#E6EAF2] tracking-wider text-sm uppercase">
            Connecting Ground Station...
          </div>
          <div className="font-mono text-xs text-[#8A97AD] mt-1">
            Telemetry Stream Ingest v1.0
          </div>
        </div>
      )}

      {/* Top Bar Header */}
      {!cinemaMode && <TopBar />}

      {/* Replay Bar (Time scrubber) */}
      {!cinemaMode && (
        <div className="px-3 md:px-6 pt-3">
          <ReplayBar />
        </div>
      )}

      {/* Main Content Body */}
      <main className="flex-1 px-3 md:px-6 py-4 flex flex-col gap-5 max-w-[1920px] mx-auto w-full">
        {/* Cinema Mode Fullscreen 3D View */}
        {cinemaMode && (
          <div className="w-full h-full flex-1">
            <ThreeTrailViewer />
          </div>
        )}

        {!cinemaMode && (
          <>
            {/* Real Phone Data First Empty State */}
            {waitingForPhone && !currentSession && (
              <EmptyPhoneState />
            )}

            {/* Desktop View Mode Switcher */}
            <div className="hidden lg:flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-[#8A97AD]">
                <span className="text-[#38BDF8] font-bold">VIEWPORT:</span>
                <div className="flex items-center gap-1 bg-[#111826] p-1 rounded-lg border border-[#243049]">
                  <button
                    onClick={() => setDesktopViewMode('3d-primary')}
                    className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                      desktopViewMode === '3d-primary'
                        ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/40 text-[#38BDF8]'
                        : 'text-[#8A97AD] hover:text-[#E6EAF2]'
                    }`}
                  >
                    3D Focus (8/4)
                  </button>
                  <button
                    onClick={() => setDesktopViewMode('split')}
                    className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                      desktopViewMode === 'split'
                        ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/40 text-[#38BDF8]'
                        : 'text-[#8A97AD] hover:text-[#E6EAF2]'
                    }`}
                  >
                    Dual View (6/6)
                  </button>
                  <button
                    onClick={() => setDesktopViewMode('map-primary')}
                    className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                      desktopViewMode === 'map-primary'
                        ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/40 text-[#38BDF8]'
                        : 'text-[#8A97AD] hover:text-[#E6EAF2]'
                    }`}
                  >
                    Map Focus (4/8)
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile Tab Switcher (< 1024px) */}
            <div className="flex lg:hidden items-center justify-between bg-[#111826] p-1.5 rounded-xl border border-[#243049]">
              <button
                onClick={() => setActiveMobileTab('3d')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  activeMobileTab === '3d'
                    ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                    : 'text-[#8A97AD]'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>3D</span>
              </button>
              <button
                onClick={() => setActiveMobileTab('map')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  activeMobileTab === 'map'
                    ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                    : 'text-[#8A97AD]'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>MAP</span>
              </button>
              <button
                onClick={() => setActiveMobileTab('adi')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  activeMobileTab === 'adi'
                    ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                    : 'text-[#8A97AD]'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>ADI</span>
              </button>
              <button
                onClick={() => setActiveMobileTab('charts')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  activeMobileTab === 'charts'
                    ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                    : 'text-[#8A97AD]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>CHARTS</span>
              </button>
              <button
                onClick={() => setActiveMobileTab('stats')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  activeMobileTab === 'stats'
                    ? 'bg-[#38BDF8]/20 border border-[#38BDF8]/50 text-[#38BDF8]'
                    : 'text-[#8A97AD]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>STATS</span>
              </button>
            </div>

            {/* Mobile Viewports Render */}
            <div className="flex lg:hidden flex-col gap-4">
              {activeMobileTab === '3d' && (
                <div className="w-full h-[460px]">
                  <ThreeTrailViewer />
                </div>
              )}
              {activeMobileTab === 'map' && (
                <div className="w-full h-[460px]">
                  <TrailMap />
                </div>
              )}
              {activeMobileTab === 'adi' && (
                <div className="w-full h-[320px]">
                  <AttitudeIndicator />
                </div>
              )}
              {activeMobileTab === 'charts' && (
                <div className="w-full flex flex-col gap-4">
                  <SensorCharts />
                </div>
              )}
              {activeMobileTab === 'stats' && (
                <div className="w-full flex flex-col gap-4">
                  <LiveReadoutCards />
                  <SessionStatsPanel />
                </div>
              )}
            </div>

            {/* Desktop Viewports Render (>= 1024px) */}
            <div className="hidden lg:flex flex-col gap-5">
              {/* Top Viewport Grid (12 Columns) */}
              <div className="grid grid-cols-12 gap-4">
                {/* 3D Trail Viewer Panel */}
                <div
                  className={`h-[520px] ${
                    desktopViewMode === '3d-primary'
                      ? 'col-span-8'
                      : desktopViewMode === 'split'
                      ? 'col-span-6'
                      : 'col-span-4'
                  }`}
                >
                  <ThreeTrailViewer />
                </div>

                {/* Right Side: Map & Attitude Indicator (ADI) Panel */}
                <div
                  className={`h-[520px] flex flex-col gap-4 ${
                    desktopViewMode === '3d-primary'
                      ? 'col-span-4'
                      : desktopViewMode === 'split'
                      ? 'col-span-6'
                      : 'col-span-8'
                  }`}
                >
                  {/* Trail Map */}
                  <div className="flex-1 min-h-[290px]">
                    <TrailMap />
                  </div>

                  {/* Attitude Indicator (Dedicated card with roll/pitch/yaw numbers, never covered) */}
                  <div className="h-[210px] shrink-0">
                    <AttitudeIndicator />
                  </div>
                </div>
              </div>

              {/* Live Status Cards (8 cards) */}
              <LiveReadoutCards />

              {/* Sensor Charts */}
              <SensorCharts />

              {/* Session Stats & Export Panel */}
              <SessionStatsPanel />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
