import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ADMIN_USER = process.env.OPENHUB_ADMIN_USERNAME ?? "admin";
const ADMIN_PASS = process.env.OPENHUB_ADMIN_PASSWORD ?? "admin123";
const ADMIN_AUTH = "Basic " + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/admin": {
        target: "http://localhost:3000",
        changeOrigin: true,
        bypass: (req) =>
          req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (!proxyReq.getHeader("Authorization")) {
              proxyReq.setHeader("Authorization", ADMIN_AUTH);
            }
          });
        },
      },
    },
  },
});
