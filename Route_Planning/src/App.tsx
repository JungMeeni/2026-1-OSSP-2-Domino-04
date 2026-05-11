// ═══════════════════════════════════════════════════════════
// App.tsx
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import RouteScreen  from "./components/RouteScreen";
import SplashScreen from "./components/SplashScreen";
import "./App.css";

// [API] Google OAuth 클라이언트 ID
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

// [CONFIG] 최소 스플래시 노출 시간 (ms)
const MIN_SPLASH_MS = 2000;

function App() {
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // [NOTE] 현재는 타이머 기반 깡통 로딩
    // 실제 구현 시: 카카오맵 SDK 로드 완료, 초기 API 호출 완료 후 setIsLoading(false)
    const timer = setTimeout(() => setIsLoading(false), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
  <>
    <SplashScreen isLoading={isLoading} />
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <RouteScreen />
    </GoogleOAuthProvider>
  </>
);
}

export default App;