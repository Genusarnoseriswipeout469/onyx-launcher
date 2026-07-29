import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: process.env.VITE_SOURCE_MAP === "true",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("lucide-react")) return "icons";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("scheduler")
          ) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
