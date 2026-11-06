import { createRouter, createWebHistory } from "vue-router";

import { ApiError } from "./lib/api";
import { fetchMe, invalidateMe } from "./lib/session";

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
        { path: "accounts", component: () => import("./admin/AccountsPage.vue"), meta: { requiresSuper: true } },
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
    const me = await fetchMe();
    if (to.meta.requiresSuper && me.role !== "super") return { path: "/admin" };
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      invalidateMe();
      return { path: "/admin/login", query: { redirect: to.fullPath } };
    }
    return true;
  }
});
