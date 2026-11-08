import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: { globals: false, environment: "node", fileParallelism: false, testTimeout: 20000, setupFiles: ["./test/env.ts"] },
});
