import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Serves /api/gallery in dev with the same handler Netlify runs in production.
function galleryApiDev() {
  return {
    name: "gallery-api-dev",
    configureServer(server) {
      server.middlewares.use("/api/gallery", async (req, res) => {
        const { default: handler } = await server.ssrLoadModule("/netlify/functions/flaphoto-gallery.mjs");
        const response = await handler(new Request(new URL(req.originalUrl, "http://localhost")));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), galleryApiDev()],
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
