import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    watch: {
      // Local Claude Code worktrees live here; anchored to the root so a dev
      // server started from inside a worktree still watches its own files.
      ignored: [fileURLToPath(new URL("./.claude/**", import.meta.url))],
    },
    proxy: {
      "/.netlify/functions": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
