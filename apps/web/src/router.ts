import { createRouter, createWebHistory } from "vue-router";

import { api, ApiError } from "./lib/api";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/admin" },
    { path: "/admin/login", component: () => import("./admin/LoginPage.vue") },
    {
      path: "/admin",
      component: () => import("./admin/AdminLayout.vue"),
      meta: { requiresAdmin: true },
      children: [
        { path: "", component: () => import("./admin/EventsPage.vue") },
        {
          path: "events/:id",
          component: () => import("./admin/EventLayout.vue"),
          props: true,
          children: [
            { path: "", redirect: (to) => `/admin/events/${to.params.id}/settings` },
            { path: "settings", component: () => import("./admin/SettingsPage.vue"), props: true },
            { path: "check", component: () => import("./admin/CheckPage.vue"), props: true },
            { path: "control", component: () => import("./admin/ControlPage.vue"), props: true },
            { path: "results", component: () => import("./admin/ResultsPage.vue"), props: true },
          ],
        },
      ],
    },
    {
      path: "/judge/:slug",
      component: () => import("./judge/JudgeShell.vue"),
      props: true,
      children: [
        { path: "", redirect: (to) => `/judge/${to.params.slug}/projects` },
        { path: "projects", component: () => import("./judge/ProjectsView.vue"), props: true },
        { path: "projects/:projectId", component: () => import("./judge/ScoreView.vue"), props: true },
      ],
    },
    { path: "/display/:slug", component: () => import("./display/DisplayView.vue"), props: true },
    { path: "/:pathMatch(.*)*", redirect: "/admin" },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAdmin) return true;
  try {
    await api.get("/admin/session");
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { path: "/admin/login", query: { redirect: to.fullPath } };
    }
    return true;
  }
});
