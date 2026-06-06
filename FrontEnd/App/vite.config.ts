import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // TripAdvisor · Directions · 경로추천: idfriend.kr (VITE_BACKEND_URL) 직접 호출
      // 도보 경로(tmap) · 직접입력 ML 호출: 아래 프록시를 통해 로컬 FastAPI로 전달
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});