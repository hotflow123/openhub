import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
      "/admin": {
        target: "http://localhost:3000",
        bypass(req) {
          return req.headers.accept?.includes("text/html") ? "/index.html" : undefined;
        },
      },
    },
  },
});
