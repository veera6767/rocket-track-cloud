import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useTelemetryStore, TileSource } from '../store/telemetryStore.js';
import { calculateDeadReckoning } from '../../shared/math.js';
import { Navigation, Layers, Compass, Focus } from 'lucide-react';

// Calm color scale helper (sky blue to violet/magenta/amber)
function getTrailColorHex(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.33) {
    return '#38BDF8'; // Sky blue
  } else if (clamped < 0.66) {
    return '#818CF8'; // Indigo/violet
  } else if (clamped < 0.85) {
    return '#F472B6'; // Pink
  } else {
    return '#FBBF24'; // Amber
  }
}

export const TrailMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const ghostLayerRef = useRef<L.LayerGroup | null>(null);
  const currentMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);

  const {
    interpolatedSamples,
    ghostSamples,
    colorMetric,
    isAutoFollow,
    setAutoFollow,
    setHoveredIndex,
    isReplayMode,
    replayIndex,
    tileSource,
    setTileSource,
    setToast,
  } = useTelemetryStore();

  const [tileErrorCount, setTileErrorCount] = useState(0);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [13.0827, 80.2707],
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const polyGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);
    const ghostGroup = L.layerGroup().addTo(map);

    polylinesLayerRef.current = polyGroup;
    markersLayerRef.current = markersGroup;
    ghostLayerRef.current = ghostGroup;
    mapRef.current = map;

    // Current position marker with heading arrow
    const currentIcon = L.divIcon({
      className: 'vehicle-heading-icon',
      html: `
        <div id="vehicle-marker-wrapper" style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
          <div style="position:absolute; width:28px; height:28px; border-radius:50%; background:rgba(56,189,248,0.25); border:1px solid #38BDF8;"></div>
          <div id="vehicle-arrow-elem" style="width:0; height:0; border-left:5px solid transparent; border-right:5px solid transparent; border-bottom:11px solid #38BDF8; transform:rotate(0deg); filter:drop-shadow(0 0 2px #0EA5E9);"></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const marker = L.marker([13.0827, 80.2707], { icon: currentIcon }).addTo(map);
    const accuracyCircle = L.circle([13.0827, 80.2707], {
      radius: 5,
      color: '#38BDF8',
      weight: 1,
      fillColor: '#38BDF8',
      fillOpacity: 0.12,
    }).addTo(map);

    currentMarkerRef.current = marker;
    accuracyCircleRef.current = accuracyCircle;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
    };
  }, []);

  // Update Tile Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const container = mapContainerRef.current;
    if (tileSource === 'canvas') {
      if (container) container.classList.add('tactical-grid-bg');
      return;
    }

    if (container) container.classList.remove('tactical-grid-bg');

    let newTileLayer: L.TileLayer;
    let errors = 0;

    if (tileSource === 'osm_dark') {
      newTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        className: 'osm-dark-tiles',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      });
    } else {
      // Carto Dark (Free, fast, no API key watermark)
      newTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
      });
    }

    newTileLayer.on('tileerror', () => {
      errors++;
      if (errors >= 4) {
        console.warn('Map tiles failed to load, falling back to tactical grid.');
        setTileSource('canvas');
        setToast({
          type: 'warning',
          message: 'Tiles unavailable: fallback to tile-free grid',
        });
      }
    });

    newTileLayer.addTo(map);
    tileLayerRef.current = newTileLayer;
  }, [tileSource]);

  // Update Polylines, Distance Markers and Vehicle Position
  useEffect(() => {
    const map = mapRef.current;
    const polyGroup = polylinesLayerRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !polyGroup || !markersGroup) return;

    polyGroup.clearLayers();
    markersGroup.clearLayers();

    const validSamples = interpolatedSamples.filter((s) => s.lat !== null && s.lon !== null);
    if (validSamples.length < 1) return;

    // Metric bounds
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const s of validSamples) {
      let v = s.speed || 0;
      if (colorMetric === 'alt') v = s.gps_alt || 0;
      else if (colorMetric === 'accel') v = s.accelMag || 9.81;
      else if (colorMetric === 'gyro') v = s.gyroMag || 0;
      else if (colorMetric === 'mag') v = s.magMag || 40;
      else if (colorMetric === 'time') v = s.t;

      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const range = maxVal > minVal ? maxVal - minVal : 1;

    // Draw trail polyline segments
    for (let i = 0; i < validSamples.length - 1; i++) {
      const s1 = validSamples[i];
      const s2 = validSamples[i + 1];

      let v = s1.speed || 0;
      if (colorMetric === 'alt') v = s1.gps_alt || 0;
      else if (colorMetric === 'accel') v = s1.accelMag || 9.81;
      else if (colorMetric === 'gyro') v = s1.gyroMag || 0;
      else if (colorMetric === 'mag') v = s1.magMag || 40;
      else if (colorMetric === 'time') v = s1.t;

      const norm = (v - minVal) / range;
      const color = getTrailColorHex(norm);
      const isGap = s2.t - s1.t > 4000; // Offline gap

      const poly = L.polyline(
        [
          [s1.lat!, s1.lon!],
          [s2.lat!, s2.lon!],
        ],
        {
          color,
          weight: 3.5,
          opacity: 0.9,
          dashArray: isGap ? '4, 8' : undefined,
        }
      );

      poly.on('mouseover', () => setHoveredIndex(i));
      polyGroup.addLayer(poly);
    }

    // Start Flag Marker
    if (validSamples.length > 0) {
      const first = validSamples[0];
      const startIcon = L.divIcon({
        className: 'start-marker-flag',
        html: `
          <div style="background:#34D399; color:#0B0F17; font-weight:700; font-family:'JetBrains Mono',monospace; font-size:9px; padding:2px 5px; border-radius:4px; border:1px solid #E6EAF2; box-shadow:0 1px 4px rgba(0,0,0,0.5);">
            START
          </div>
        `,
        iconSize: [42, 18],
        iconAnchor: [21, 9],
      });
      const startMarker = L.marker([first.lat!, first.lon!], { icon: startIcon });
      markersGroup.addLayer(startMarker);
    }

    // Distance Markers every 100 meters
    let nextDistanceMark = 100;
    for (const s of validSamples) {
      const dist = s.distanceMeters || 0;
      if (dist >= nextDistanceMark) {
        const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)}k` : `${Math.round(dist)}m`;
        const distIcon = L.divIcon({
          className: 'dist-tick-icon',
          html: `
            <div style="background:#172033; color:#8A97AD; font-family:'JetBrains Mono',monospace; font-size:8px; padding:1px 3px; border-radius:3px; border:1px solid #243049; white-space:nowrap;">
              ${distLabel}
            </div>
          `,
          iconSize: [28, 14],
          iconAnchor: [14, 7],
        });
        const distMarker = L.marker([s.lat!, s.lon!], { icon: distIcon });
        markersGroup.addLayer(distMarker);
        nextDistanceMark += 100;
      }
    }

    // Active Vehicle Marker with Dead-Reckoning smoothing
    const activeIdx = isReplayMode
      ? Math.min(replayIndex, validSamples.length - 1)
      : validSamples.length - 1;
    const currentSample = validSamples[activeIdx];

    if (currentSample && currentMarkerRef.current && accuracyCircleRef.current) {
      let markerLat = currentSample.lat!;
      let markerLon = currentSample.lon!;
      let isEstimated = false;

      if (!isReplayMode && currentSample.gps_fix_t) {
        const dr = calculateDeadReckoning(
          {
            lat: currentSample.lat!,
            lon: currentSample.lon!,
            fixTime: currentSample.gps_fix_t,
            speed: currentSample.speed,
            bearing: currentSample.bearing,
            gps_acc: currentSample.gps_acc,
          },
          Date.now()
        );
        if (dr.isEstimated) {
          markerLat = dr.lat;
          markerLon = dr.lon;
          isEstimated = true;
        }
      }

      const pos: L.LatLngTuple = [markerLat, markerLon];
      currentMarkerRef.current.setLatLng(pos);
      accuracyCircleRef.current.setLatLng(pos);
      accuracyCircleRef.current.setRadius(currentSample.gps_acc || 4);

      // Rotate heading arrow inside divIcon and update estimated status
      const arrowElem = document.getElementById('vehicle-arrow-elem');
      const wrapperElem = document.getElementById('vehicle-marker-wrapper');
      if (arrowElem) {
        const bearing = currentSample.bearing ?? 0;
        arrowElem.style.transform = `rotate(${bearing}deg)`;
        if (isEstimated) {
          arrowElem.style.borderBottomColor = '#FBBF24'; // Amber for estimated dead reckoning
        } else {
          arrowElem.style.borderBottomColor = '#38BDF8'; // Sky blue for real fix
        }
      }

      if (wrapperElem) {
        wrapperElem.title = isEstimated ? 'Position estimated via dead-reckoning' : 'GPS position locked';
      }

      if (isAutoFollow) {
        map.panTo(pos, { animate: true, duration: 0.3 });
      }
    }
  }, [interpolatedSamples, colorMetric, isAutoFollow, isReplayMode, replayIndex]);

  // Fit trail bounds handler
  const handleFitTrail = () => {
    if (!mapRef.current) return;
    const valid = interpolatedSamples.filter((s) => s.lat !== null && s.lon !== null);
    if (valid.length > 0) {
      const bounds = L.latLngBounds(valid.map((s) => [s.lat!, s.lon!]));
      mapRef.current.fitBounds(bounds, { padding: [30, 30] });
    }
  };

  return (
    <div className="relative w-full h-full min-h-[360px] bg-[#0B0F17] rounded-xl overflow-hidden border border-[#243049] flex flex-col shadow-sm">
      {/* Map Header Overlay */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex items-center gap-2 bg-[#111826]/90 border border-[#243049] px-3 py-1.5 rounded-lg text-xs font-mono pointer-events-auto backdrop-blur shadow-sm">
          <Navigation className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="text-[#E6EAF2] font-semibold uppercase tracking-wider">GNSS TRAIL</span>
          <span className="text-[#8A97AD]">|</span>
          <select
            value={tileSource}
            onChange={(e) => setTileSource(e.target.value as TileSource)}
            className="bg-transparent text-[#8A97AD] font-mono text-xs focus:outline-none cursor-pointer"
            title="Map Tile Provider"
          >
            <option value="carto" className="bg-[#111826] text-[#E6EAF2]">Carto Dark (Clean)</option>
            <option value="osm_dark" className="bg-[#111826] text-[#E6EAF2]">OSM Dark</option>
            <option value="canvas" className="bg-[#111826] text-[#E6EAF2]">Tactical Grid (Offline)</option>
          </select>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setAutoFollow(!isAutoFollow)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
              isAutoFollow
                ? 'bg-[#38BDF8]/20 border-[#38BDF8]/50 text-[#38BDF8]'
                : 'bg-[#111826]/80 border-[#243049] text-[#8A97AD] hover:text-[#E6EAF2]'
            }`}
          >
            {isAutoFollow ? 'Following' : 'Free Map'}
          </button>
          <button
            onClick={handleFitTrail}
            className="px-2.5 py-1.5 rounded-lg border bg-[#111826]/80 hover:bg-[#172033] border-[#243049] text-[#E6EAF2] text-xs font-mono transition-colors cursor-pointer"
            title="Fit Entire Trail into View"
          >
            Fit Trail
          </button>
        </div>
      </div>

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="w-full flex-1 z-0" />

      {/* Color Scale Legend */}
      <div className="absolute bottom-3 left-3 z-10 pointer-events-auto bg-[#111826]/90 border border-[#243049] px-3 py-1.5 rounded-lg text-[11px] font-mono flex items-center gap-2 backdrop-blur shadow-sm">
        <span className="text-[#8A97AD] uppercase">{colorMetric}:</span>
        <div className="flex items-center gap-1">
          <span className="text-[#8A97AD] text-[10px]">Min</span>
          <div className="w-16 h-2 rounded bg-gradient-to-r from-[#38BDF8] via-[#818CF8] to-[#FBBF24]" />
          <span className="text-[#8A97AD] text-[10px]">Max</span>
        </div>
      </div>
    </div>
  );
};
