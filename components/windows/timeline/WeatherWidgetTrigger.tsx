'use client';

// Timeline-header weather widget: a compact one-line pill (icon · temp · city)
// so it fits inline alongside the filter pills and other header controls.
// Clicking opens a popover with a debounced Open-Meteo geocoder search. The
// installed `WeatherWidget` (shadcn `@einui/weather-widget`) is kept in the
// repo for future surfaces (forecast / detailed views) but isn't used here.

import { useEffect, useRef, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, Wind } from 'lucide-react';
import { searchCities, useWeather, type WeatherCity, type WeatherIcon } from '@/lib/useWeather';

const ICON_MAP: Record<WeatherIcon, typeof Sun> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  wind: Wind,
};

// Per-condition icon tint — keeps the liquid-glass aesthetic on the pill
// (translucent + backdrop blur + inner sheen) without a colored halo behind.
const ICON_TINT: Record<WeatherIcon, string> = {
  sun: 'text-amber-500 dark:text-amber-300',
  cloud: 'text-slate-500 dark:text-slate-300',
  rain: 'text-cyan-500 dark:text-cyan-300',
  snow: 'text-purple-500 dark:text-purple-300',
  wind: 'text-blue-500 dark:text-blue-300',
};

export function WeatherWidgetTrigger() {
  const { city, setCity, snapshot, loading } = useWeather();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      {city ? (
        (() => {
          const iconName = snapshot?.icon ?? 'sun';
          const Icon = ICON_MAP[iconName];
          const condition = snapshot?.condition ?? (loading ? 'Loading…' : '—');
          return (
            <div className="relative inline-flex">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                title={`${city.name} · ${condition}`}
                className={[
                  'relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                  'text-[12px] font-medium tracking-tight',
                  // Glass surface — translucent in both themes, subtle in
                  // light mode (white on white needs more body) and frosted
                  // in dark.
                  'bg-white/55 dark:bg-white/[0.08] backdrop-blur-xl',
                  'border border-white/70 dark:border-white/20',
                  'shadow-[0_4px_14px_rgba(0,0,0,0.08)] dark:shadow-[0_6px_22px_rgba(0,0,0,0.45)]',
                  'text-neutral-800 dark:text-white',
                  'hover:bg-white/70 dark:hover:bg-white/[0.12] transition-colors',
                  // Inner top highlight (the "liquid glass" sheen).
                  "before:absolute before:inset-0 before:rounded-full",
                  "before:bg-gradient-to-b before:from-white/45 dark:before:from-white/15 before:to-transparent before:pointer-events-none",
                ].join(' ')}
              >
                <Icon className={`w-3.5 h-3.5 ${ICON_TINT[iconName]} drop-shadow-sm`} />
                <span className="tabular-nums">{snapshot ? `${snapshot.temperature}°` : '—°'}</span>
                <span className="text-neutral-400 dark:text-white/40">·</span>
                <span className="truncate max-w-[140px]">{city.name}</span>
              </button>
            </div>
          );
        })()
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] text-neutral-600 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
          </svg>
          Set city
        </button>
      )}

      {open && <CityPicker hasCity={!!city} onPick={(c) => { setCity(c); setOpen(false); }} onClear={() => { setCity(null); setOpen(false); }} />}
    </div>
  );
}

function CityPicker({
  hasCity,
  onPick,
  onClear,
}: {
  hasCity: boolean;
  onPick: (c: WeatherCity) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<WeatherCity[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const id = window.setTimeout(async () => {
      try {
        const r = await searchCities(q);
        if (!cancelled) setResults(r);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [q]);

  return (
    <div className="absolute right-0 top-full mt-1 w-72 z-50 bg-white dark:bg-[var(--timeline-surface-4)] border border-neutral-200 dark:border-[var(--timeline-border-strong)] rounded-md shadow-lg p-2">
      <input
        autoFocus
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="City name…"
        className="w-full px-2 py-1.5 text-[13px] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-md focus:outline-none focus:border-[var(--accent-3)] dark:focus:border-[var(--accent-1)] text-neutral-800 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
      />
      <div className="max-h-56 overflow-y-auto mt-1">
        {results.map((r, i) => (
          <button
            key={`${r.name}-${r.lat}-${r.lon}-${i}`}
            type="button"
            onClick={() => onPick(r)}
            className="w-full text-left px-2 py-1.5 text-[13px] rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]"
          >
            <div className="text-neutral-800 dark:text-[#f0efed]">{r.name}</div>
            <div className="text-[11px] text-neutral-500 dark:text-[#66645f]">
              {[r.admin1, r.country].filter(Boolean).join(', ')}
            </div>
          </button>
        ))}
        {q.trim().length >= 2 && !searching && results.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-neutral-500 dark:text-[#66645f]">No matches</div>
        )}
        {searching && (
          <div className="px-2 py-1.5 text-[12px] text-neutral-400 dark:text-[#66645f]">Searching…</div>
        )}
      </div>
      {hasCity && (
        <div className="mt-2 border-t border-neutral-200 dark:border-[rgba(255,255,255,0.06)] pt-2">
          <button
            type="button"
            onClick={onClear}
            className="w-full text-left px-2 py-1 text-[11px] text-neutral-500 dark:text-[#a09e9a] hover:text-neutral-700 dark:hover:text-[#f0efed]"
          >
            Clear city
          </button>
        </div>
      )}
    </div>
  );
}
