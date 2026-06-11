import { useState, useCallback, useEffect } from "react";
import type { Place } from "../types/type";

const getKey = (email: string | null) =>
  email ? `favorites_${email}` : null;

const load = (key: string): Place[] => {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
};

export const useFavorites = (userEmail: string | null) => {
  const key = getKey(userEmail);
  const [favorites, setFavorites] = useState<Place[]>(() => key ? load(key) : []);

  useEffect(() => {
    setFavorites(key ? load(key) : []);
  }, [key]);

  const toggle = useCallback((place: Place) => {
    if (!key) return;
    setFavorites(prev => {
      const next = prev.some(p => p.id === place.id)
        ? prev.filter(p => p.id !== place.id)
        : [...prev, place];
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  const isFavorited = useCallback(
    (placeId: number) => favorites.some(p => p.id === placeId),
    [favorites],
  );

  return { favorites, toggle, isFavorited };
};
