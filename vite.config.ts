import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";

function buildSha(command: string): string {
  if (command === "serve") return "dev";
  const fromCi =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF ?? process.env.CF_PAGES_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: { __LUMON_BUILD__: JSON.stringify(buildSha(command)) },
  build: { target: "es2022" },
}));
