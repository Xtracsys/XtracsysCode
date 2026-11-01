import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  root: path.resolve(__dirname, "web"),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist-web"),
    emptyOutDir: true,
    target: "chrome130",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
