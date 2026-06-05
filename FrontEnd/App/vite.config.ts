import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // 현재 mode(development, production 등)를 기반으로 환경 변수를 로드
  // process.cwd()는 현재 작업 디렉토리
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/vite-proxy/tripadvisor": {
          target: "https://api.content.tripadvisor.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/vite-proxy\/tripadvisor/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              // import.meta.env 대신 loadEnv로 가져온 env 객체를 사용
              const domainUrl = env.VITE_DOMAIN_URL || "http://localhost:5173";
              
              proxyReq.setHeader("Origin", domainUrl);
              proxyReq.setHeader("Referer", domainUrl);
              
              const ua = req.headers["user-agent"];
              if (ua) proxyReq.setHeader("User-Agent", ua);
            });
          },
        },
      },
    },
  };
});