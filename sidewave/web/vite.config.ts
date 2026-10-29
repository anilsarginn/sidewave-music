import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  // Gelistirirken API'yi calisan sunucuya yolla
  server: {
    proxy: { "/api": process.env.SIDEWAVE_API_URL || "http://127.0.0.1:4444" },
  },
});
