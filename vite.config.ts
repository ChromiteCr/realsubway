import { defineConfig } from "vite";

export default defineConfig({
  // 相对路径,便于日后发布到 GitHub Pages 子路径
  base: "./",
  server: {
    port: 5180,
  },
});
