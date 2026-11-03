<script setup lang="ts">
// AGPL 网络部署源码提供（LICENSING.md）：低干扰展示，链接由构建环境注入。
const sourceUrl = import.meta.env.VITE_JUDGING_SOURCE_URL as string | undefined;
</script>

<template>
  <footer class="tw:mt-8 tw:flex tw:items-center tw:gap-2 tw:py-4 tw:text-xs tw:text-faint">
    <span>MangoWrite Judge · AGPL-3.0-or-later</span>
    <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener" class="tw:underline hover:tw:text-muted">
      源代码
    </a>
  </footer>
</template>
