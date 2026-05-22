import { useState, useRef, useEffect, useCallback } from "react";
import type { KakaoPlaceSearchResult } from "../types/type_kakao";

interface Options {
  isServicesReady:  boolean;
  onConfirm?:       (result: KakaoPlaceSearchResult) => void;
  onFocusResult?:   (result: KakaoPlaceSearchResult) => void;
  getDisplayValue?: (result: KakaoPlaceSearchResult) => string;
}

export interface PlaceSearchState {
  query:           string;
  setQuery:        (q: string) => void;
  overrideQuery:   (q: string) => void;
  results:         KakaoPlaceSearchResult[];
  showDropdown:    boolean;
  setShowDropdown: (v: boolean) => void;
  focusedResult:   KakaoPlaceSearchResult | null;
  handleSelect:    (result: KakaoPlaceSearchResult) => void;
  handleClear:     () => void;
}

export function usePlaceSearch({ isServicesReady, onConfirm, onFocusResult, getDisplayValue }: Options): PlaceSearchState {
  const [query,         setQueryRaw]      = useState<string>("");
  const [results,       setResults]       = useState<KakaoPlaceSearchResult[]>([]);
  const [showDropdown,  setShowDropdown]  = useState<boolean>(false);
  const [focusedResult, setFocusedResult] = useState<KakaoPlaceSearchResult | null>(null);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSearchRef = useRef<boolean>(false);
  const onConfirmRef      = useRef(onConfirm);
  const onFocusRef        = useRef(onFocusResult);
  const getDisplayRef     = useRef(getDisplayValue);

  useEffect(() => { onConfirmRef.current  = onConfirm;      }, [onConfirm]);
  useEffect(() => { onFocusRef.current    = onFocusResult;  }, [onFocusResult]);
  useEffect(() => { getDisplayRef.current = getDisplayValue; }, [getDisplayValue]);

  // 사용자 입력 — 검색 트리거
  const setQuery = useCallback((q: string) => {
    skipSearchRef.current = false;
    setQueryRaw(q);
    setFocusedResult(null);
  }, []);

  // 외부 주입 (swap, 현재위치, 확정 등) — 검색 건너뜀
  const overrideQuery = useCallback((q: string) => {
    skipSearchRef.current = true;
    setQueryRaw(q);
    setResults([]);
    setShowDropdown(false);
    setFocusedResult(null);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    if (!query.trim() || !isServicesReady) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const places = new window.kakao.maps.services.Places();
      places.keywordSearch(query, (res, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          setResults(res);
          setShowDropdown(true);
        } else {
          setResults([]);
          setShowDropdown(false);
        }
      });
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isServicesReady]);

  const handleSelect = useCallback((result: KakaoPlaceSearchResult) => {
    if (focusedResult?.id === result.id) {
      // 2번째 클릭: 확정
      const displayValue = getDisplayRef.current ? getDisplayRef.current(result) : result.place_name;
      overrideQuery(displayValue);
      onConfirmRef.current?.(result);
    } else {
      // 1번째 클릭: 강조만 (드롭다운 유지)
      setFocusedResult(result);
      onFocusRef.current?.(result);
    }
  }, [focusedResult, overrideQuery]);

  const handleClear = useCallback(() => {
    overrideQuery("");
  }, [overrideQuery]);

  return {
    query, setQuery, overrideQuery,
    results, showDropdown, setShowDropdown,
    focusedResult, handleSelect, handleClear,
  };
}
