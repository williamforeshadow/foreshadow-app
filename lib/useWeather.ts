'use client';

// Lightweight client-side weather hook. Open-Meteo is free and key-less; both
// the geocoding and forecast endpoints are CORS-open. City + last snapshot are
// persisted to localStorage so reloads show stale-but-instant data while a
// fresh fetch runs in the background. Refreshes after a 30-minute TTL.

import { useCallback, useEffect, useState } from 'react';

export type WeatherCity = {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  admin1?: string;
};

export type WeatherIcon = 'sun' | 'cloud' | 'rain' | 'snow' | 'wind';

export type WeatherSnapshot = {
  temperature: number; // already rounded, °F
  condition: string;
  icon: WeatherIcon;
};

const CITY_KEY = 'foreshadow_weather_city';
const TTL_MS = 30 * 60 * 1000;
const cacheKey = (c: WeatherCity) => `foreshadow_weather_cache:${c.lat},${c.lon}`;

// WMO weather codes → display condition + matching icon for `WeatherWidget`.
function mapCode(code: number): { condition: string; icon: WeatherIcon } {
  if (code === 0) return { condition: 'Sunny', icon: 'sun' };
  if (code === 1) return { condition: 'Mostly Sunny', icon: 'sun' };
  if (code === 2) return { condition: 'Partly Cloudy', icon: 'cloud' };
  if (code === 3) return { condition: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { condition: 'Fog', icon: 'cloud' };
  if (code >= 51 && code <= 57) return { condition: 'Drizzle', icon: 'rain' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { condition: 'Rain', icon: 'rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { condition: 'Snow', icon: 'snow' };
  if (code >= 95) return { condition: 'Thunderstorm', icon: 'wind' };
  return { condition: '—', icon: 'cloud' };
}

export async function searchCities(q: string): Promise<WeatherCity[]> {
  if (!q.trim()) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const json = await res.json();
  return (json.results || []).map((r: any) => ({
    name: r.name as string,
    lat: r.latitude as number,
    lon: r.longitude as number,
    country: r.country as string | undefined,
    admin1: r.admin1 as string | undefined,
  }));
}

async function fetchCurrent(city: WeatherCity): Promise<WeatherSnapshot> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const json = await res.json();
  const temp = Math.round((json.current?.temperature_2m as number | undefined) ?? 0);
  const { condition, icon } = mapCode((json.current?.weather_code as number | undefined) ?? 0);
  return { temperature: temp, condition, icon };
}

export function useWeather() {
  const [city, setCityState] = useState<WeatherCity | null>(null);
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial mount: hydrate city + cached snapshot from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CITY_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as WeatherCity;
      setCityState(c);
      const cachedRaw = localStorage.getItem(cacheKey(c));
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as WeatherSnapshot & { fetchedAt: number };
        setSnapshot({
          temperature: cached.temperature,
          condition: cached.condition,
          icon: cached.icon,
        });
      }
    } catch {
      // ignore storage / parse errors
    }
  }, []);

  // Fetch on city change; serve cache when fresh, else refetch.
  useEffect(() => {
    if (!city) return;
    let cancelled = false;
    (async () => {
      try {
        const cachedRaw = localStorage.getItem(cacheKey(city));
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as WeatherSnapshot & { fetchedAt: number };
          if (Date.now() - cached.fetchedAt < TTL_MS) {
            if (!cancelled) {
              setSnapshot({
                temperature: cached.temperature,
                condition: cached.condition,
                icon: cached.icon,
              });
            }
            return;
          }
        }
        if (!cancelled) setLoading(true);
        const snap = await fetchCurrent(city);
        if (cancelled) return;
        setSnapshot(snap);
        try {
          localStorage.setItem(
            cacheKey(city),
            JSON.stringify({ ...snap, fetchedAt: Date.now() }),
          );
        } catch {
          // storage full — ignore
        }
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load weather');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [city?.lat, city?.lon]);

  const setCity = useCallback((c: WeatherCity | null) => {
    setCityState(c);
    try {
      if (c) localStorage.setItem(CITY_KEY, JSON.stringify(c));
      else localStorage.removeItem(CITY_KEY);
    } catch {
      // ignore
    }
    if (!c) setSnapshot(null);
    setError(null);
  }, []);

  return { city, setCity, snapshot, loading, error };
}
