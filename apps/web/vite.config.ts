import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // resolve workspace package straight to TS source
      "@teacher/stroke-engine": path.resolve(
        __dirname,
        "../../packages/stroke-engine/src/index.ts"
      ),
    },
  },
});
