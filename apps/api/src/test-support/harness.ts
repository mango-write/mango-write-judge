// 测试装配：真实测试库 + 直连 app.fetch 的客户端。
import { expect } from "vitest";

import { buildApp } from "../app";
import type { AppConfig } from "../config";
import { TEST_ADMIN_PASSWORD, resetDb, testSql } from "./db";
import { TestClient } from "./app";

export interface Harness {
  sql: Awaited<ReturnType<typeof testSql>>;
  admin: TestClient;
  freshClient: () => TestClient;
}

export async function createHarness(withReset = true): Promise<Harness> {
  const sql = await testSql();
  if (withReset) await resetDb(sql);
  const config: AppConfig = {
    databaseUrl: "",
    adminPassword: TEST_ADMIN_PASSWORD,
    publicBaseUrl: "http://localhost:3200",
    inviteBaseUrl: "http://localhost:3200",
    port: 3200,
    secureCookies: false,
    webDistDir: null,
  };
  const app = buildApp({ sql, config });
  const admin = new TestClient(app);
  const login = await admin.post("/api/admin/login", { password: TEST_ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  return { sql, admin, freshClient: () => new TestClient(app) };
}

export interface SeedInput {
  name?: string;
  slug?: string;
  criteria: [string, number][];
  projects: string[];
  judges: string[];
}

export interface Seed {
  eventId: string;
  slug: string;
  criteriaIds: string[];
  projectIds: string[];
  judges: { id: string; inviteUrl: string; token: string }[];
  displayToken: string;
  revision: number;
}

export async function seedEvent(harness: Harness, input: SeedInput): Promise<Seed> {
  const { admin } = harness;
  const created = await admin.post<{ id: string; slug: string; revision: number }>("/api/admin/events", {
    name: input.name ?? "测试比赛",
    slug: input.slug,
    description: "",
  });
  expect(created.status).toBe(201);
  const eventId = created.body.id;
  const slug = created.body.slug;
  let revision = created.body.revision ?? 0;

  const criteriaIds: string[] = [];
  for (const [name, weight] of input.criteria) {
    const res = await admin.post<{ revision: number }>(`/api/admin/events/${eventId}/criteria`, {
      name,
      weightPercent: weight,
      expectedRevision: revision,
    });
    expect(res.status).toBe(201);
    revision = res.body.revision;
  }
  const detail = await admin.get<{ criteria: { id: string }[]; revision: number }>(`/api/admin/events/${eventId}`);
  criteriaIds.push(...detail.body.criteria.map((c) => c.id));
  revision = detail.body.revision;

  for (const name of input.projects) {
    const res = await admin.post<{ revision: number }>(`/api/admin/events/${eventId}/projects`, {
      name,
      expectedRevision: revision,
    });
    expect(res.status).toBe(201);
    revision = res.body.revision;
  }
  const judges: Seed["judges"] = [];
  for (const name of input.judges) {
    const res = await admin.post<{ id: string; inviteUrl: string; revision?: number }>(
      `/api/admin/events/${eventId}/judges`,
      { name, expectedRevision: revision },
    );
    expect(res.status).toBe(201);
    revision = res.body.revision ?? revision;
    judges.push({ id: res.body.id, inviteUrl: res.body.inviteUrl, token: res.body.inviteUrl.split("#")[1]! });
  }
  const display = await admin.post<{ inviteUrl: string }>(`/api/admin/events/${eventId}/display-token/rotate`);
  expect(display.status).toBe(200);

  const final = await admin.get<{ revision: number; projects: { id: string }[] }>(`/api/admin/events/${eventId}`);
  return {
    eventId,
    slug,
    criteriaIds,
    projectIds: final.body.projects.map((p) => p.id),
    judges,
    displayToken: display.body.inviteUrl.split("#")[1]!,
    revision: final.body.revision,
  };
}

export async function judgeClient(harness: Harness, token: string): Promise<TestClient> {
  const client = harness.freshClient();
  const res = await client.post("/api/judge/session", { token });
  expect(res.status).toBe(200);
  return client;
}

export async function displayClient(harness: Harness, token: string): Promise<TestClient> {
  const client = harness.freshClient();
  const res = await client.post("/api/display/session", { token });
  expect(res.status).toBe(200);
  return client;
}

export async function startEvent(harness: Harness, seed: Seed): Promise<void> {
  const detail = await harness.admin.get<{ revision: number }>(`/api/admin/events/${seed.eventId}`);
  const res = await harness.admin.post(`/api/admin/events/${seed.eventId}/start`);
  expect(res.status).toBe(200);
  void detail;
}

export async function unlockProject(harness: Harness, seed: Seed, projectId: string): Promise<void> {
  const res = await harness.admin.post(`/api/admin/events/${seed.eventId}/active-project`, { projectId });
  expect(res.status).toBe(200);
}

export async function submit(
  client: TestClient,
  seed: Seed,
  projectId: string,
  scores: Record<string, number>,
  expectedVersion: number,
  operationId: string,
): Promise<{ status: number; body: { version?: number; revision?: number } & Record<string, unknown> }> {
  return client.post(`/api/judge/projects/${projectId}/submit`, {
    scores,
    expectedVersion,
    operationId,
  });
}
