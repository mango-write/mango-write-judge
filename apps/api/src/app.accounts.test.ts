import { beforeEach, describe, expect, it } from "vitest";

import { errorOf } from "./test-support/app";
import { TEST_ADMIN_PASSWORD } from "./test-support/db";
import { createHarness, loggedInClient, type Harness } from "./test-support/harness";
import { ensureSuperAdmin } from "./services/accounts";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

const STAFF = { username: "staff", name: "现场管理员", password: "staff-password-123456" };

describe("账户系统", () => {
  it("超管播种幂等：重复调用不新建，session 返回身份", async () => {
    await ensureSuperAdmin(harness.sql, TEST_ADMIN_PASSWORD);
    const accounts = await harness.admin.get<{ accounts: { username: string; role: string }[] }>("/api/admin/accounts");
    expect(accounts.status).toBe(200);
    expect(accounts.body.accounts).toHaveLength(1);
    expect(accounts.body.accounts[0]).toMatchObject({ username: "admin", role: "super" });

    const me = await harness.admin.get<{ username: string; name: string; role: string }>("/api/admin/session");
    expect(me.body).toMatchObject({ ok: true, username: "admin", role: "super" });
  });

  it("超管可建管理员；管理员全权管赛事但进不了账户管理", async () => {
    const created = await harness.admin.post<{ id: string; role: string }>("/api/admin/accounts", STAFF);
    expect(created.status).toBe(201);
    expect(created.body.role).toBe("admin");

    const staff = await loggedInClient(harness, { username: STAFF.username, password: STAFF.password });
    expect((await staff.get("/api/admin/events")).status).toBe(200);
    const denied = await staff.get("/api/admin/accounts");
    expect(denied.status).toBe(403);
    expect(errorOf(denied).code).toBe("forbidden");
    expect((await staff.post("/api/admin/accounts", { ...STAFF, username: "other" })).status).toBe(403);
  });

  it("用户名重复 409；密码不足 12 位 400", async () => {
    const dup = await harness.admin.post("/api/admin/accounts", { ...STAFF, username: "admin" });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe("username_taken");

    const weak = await harness.admin.post("/api/admin/accounts", { ...STAFF, password: "short-pass" });
    expect(weak.status).toBe(400);
    expect(errorOf(weak).code).toBe("validation_error");
  });

  it("重置密码：旧会话立即失效，新密码可登录、旧密码失效", async () => {
    const created = await harness.admin.post<{ id: string }>("/api/admin/accounts", STAFF);
    const staff = await loggedInClient(harness, { username: STAFF.username, password: STAFF.password });
    expect((await staff.get("/api/admin/session")).status).toBe(200);

    const reset = await harness.admin.post(`/api/admin/accounts/${created.body.id}/reset-password`, {
      password: "reset-password-654321",
    });
    expect(reset.status).toBe(200);
    expect((await staff.get("/api/admin/session")).status).toBe(401);

    const oldLogin = await harness.freshClient();
    expect(
      (await oldLogin.post("/api/admin/login", { username: STAFF.username, password: STAFF.password })).status,
    ).toBe(401);
    const staff2 = await loggedInClient(harness, { username: STAFF.username, password: "reset-password-654321" });
    expect((await staff2.get("/api/admin/session")).status).toBe(200);
  });

  it("自己改密码：当前密码错 422；成功后新密码可登录", async () => {
    const wrong = await harness.admin.post("/api/admin/account/password", {
      currentPassword: "not-the-password",
      newPassword: "new-admin-password-123",
    });
    expect(wrong.status).toBe(422);
    expect(errorOf(wrong).code).toBe("current_password_mismatch");

    const ok = await harness.admin.post("/api/admin/account/password", {
      currentPassword: TEST_ADMIN_PASSWORD,
      newPassword: "new-admin-password-123",
    });
    expect(ok.status).toBe(200);

    const oldLogin = await harness.freshClient();
    expect((await oldLogin.post("/api/admin/login", { username: "admin", password: TEST_ADMIN_PASSWORD })).status).toBe(401);
    const newLogin = await harness.freshClient();
    expect((await newLogin.post("/api/admin/login", { username: "admin", password: "new-admin-password-123" })).status).toBe(200);
    // 已有会话不吊销，改密后当前客户端仍可用
    expect((await harness.admin.get("/api/admin/session")).status).toBe(200);
  });

  it("不能停用自己；停用/启用循环后可重新登录", async () => {
    const me = await harness.admin.get<{ id: string }>("/api/admin/session");
    const self = await harness.admin.post(`/api/admin/accounts/${me.body.id}/disabled`, { disabled: true });
    expect(self.status).toBe(403);
    expect(errorOf(self).code).toBe("forbidden");

    const created = await harness.admin.post<{ id: string }>("/api/admin/accounts", STAFF);
    await harness.admin.post(`/api/admin/accounts/${created.body.id}/disabled`, { disabled: true });
    const reEnable = await harness.admin.post(`/api/admin/accounts/${created.body.id}/disabled`, { disabled: false });
    expect(reEnable.status).toBe(200);
    const staff = await loggedInClient(harness, { username: STAFF.username, password: STAFF.password });
    expect((await staff.get("/api/admin/session")).status).toBe(200);
  });

  it("重置不存在的账号 404", async () => {
    const res = await harness.admin.post("/api/admin/accounts/no-such-id/reset-password", {
      password: "whatever-pass-123",
    });
    expect(res.status).toBe(404);
  });
});
