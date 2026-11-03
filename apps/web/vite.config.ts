// Judge 前端装配：dev 期 /api 反代到本机 API（PORT 与 .env 同源，默认 3200）。
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    // 与 @mango-write/ui 共享同一运行时实例，provide/inject 与 Toast 上下文才成立
    dedupe: ["vue", "vue-router", "vue-i18n", "primevue"],
  },
  server: {
    port: Number(process.env.WEB_PORT) || 5181,
    proxy: {
      "/api": { target: `http://localhost:${process.env.PORT || 3200}` },
    },
  },
  build: {
    outDir: "dist",
  },
});
