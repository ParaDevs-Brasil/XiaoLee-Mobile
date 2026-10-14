import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// `public/assets/*` is served at /assets/* (logos, fonts, the mascot icon, and
// the APK link in the README), so Vite's own bundles go to /static to avoid mixing.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { assetsDir: "static", target: "es2022" },
});
