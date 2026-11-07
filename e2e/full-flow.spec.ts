import { expect, test, type Page } from "@playwright/test";

import { E2E_ADMIN_PASSWORD, E2E_BASE_URL } from "./env";

// 全流程验收（MVP 规格 §13 关键联动场景）：建赛 → 邀请 → 启动 → 解锁项目 →
// 评分 → 大屏进度 → 首次公开 → 解锁改分 → 闭幕 → 揭晓 → 导出。
// 三视口：管理端桌面、评委手机（390×844）、大屏（1920×1080）。

test.describe.configure({ mode: "serial" });

const criteria = [
  { name: "创新性", weight: 30, scoreA: [8, 9], scoreB: [7, 6] },
  { name: "完成度", weight: 30, scoreA: [9, 9], scoreB: [8, 7] },
  { name: "表达力", weight: 40, scoreA: [8, 8], scoreB: [9, 8] },
];


/** InputNumber 在 blur 时才提交模型：fill 后补 Tab 触发 commit。 */
async function setScore(page: import("@playwright/test").Page, name: string, value: number) {
  await page.locator(`input[aria-label="${name}"]`).first().fill(String(value));
  await page.locator(`input[aria-label="${name}"]`).first().press("Tab");
}

async function adminGoto(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel("用户名", { exact: false }).fill("admin");
  await page.getByLabel("密码", { exact: false }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(path);
}

test("完整流程：建赛到闭幕导出", async ({ browser }) => {
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const judgeA = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const judgeB = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const display = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  const adminPage = await admin.newPage();
  
  // 1. 建赛
  await adminGoto(adminPage, `${E2E_BASE_URL}/admin`);
  await adminPage.getByRole("button", { name: "新建比赛" }).click();
  await adminPage.getByLabel("比赛名称", { exact: false }).fill("E2E 路演赛");
  await adminPage.getByLabel("URL slug", { exact: false }).fill("e2e-demo");
  await adminPage.getByRole("button", { name: "确认" }).click();
  await adminPage.waitForURL(/\/admin\/events\/.+\/settings/);
  
  // 2. 评分项
  await adminPage.getByRole("button", { name: "评分规则" }).click();
  for (const criterion of criteria) {
    await adminPage.getByRole("button", { name: "添加评分项" }).click();
    await adminPage.getByLabel("评分项名称").last().fill(criterion.name);
    await adminPage.getByLabel("权重 %").last().fill(String(criterion.weight));
    await adminPage.getByRole("button", { name: "保存", exact: true }).last().click();
  }
  await expect(adminPage.getByText("权重合计 100%")).toBeVisible();
  
  // 3. 项目
  await adminPage.getByRole("button", { name: "项目" }).click();
  for (const project of ["智能写作", "语音笔记", "文献图谱"]) {
    await adminPage.getByRole("button", { name: "添加项目" }).click();
    await adminPage.getByPlaceholder("项目名称").last().fill(project);
    await adminPage.getByRole("button", { name: "保存", exact: true }).last().click();
  }
  
  // 4. 评委（拿邀请链接）
  await adminPage.getByRole("button", { name: "评委与分享" }).click();
  const judgeLinks: string[] = [];
  for (const judge of ["张评委", "李评委"]) {
    await adminPage.getByRole("button", { name: "添加评委" }).click();
    await adminPage.getByPlaceholder("评委姓名").last().fill(judge);
    await adminPage.getByRole("button", { name: "保存", exact: true }).last().click();
    await adminPage.locator("code").last().waitFor();
    judgeLinks.push(await adminPage.locator("code").last().textContent() ?? "");
    await adminPage.locator(".mw-dialog__close").last().click();
  }
  expect(judgeLinks).toHaveLength(2);
  expect(judgeLinks[0]).toContain("/judge/e2e-demo#");
  
  // 5. 启动
  await adminPage.getByRole("button", { name: "启动检查" }).click();
  await adminPage.getByRole("button", { name: "启动比赛" }).first().click();
  await adminPage.getByRole("button", { name: "启动比赛" }).last().click(); // 确认框的接受按钮
  await adminPage.waitForURL(/\/control/);
  await expect(adminPage.getByText("现场控制")).toBeVisible();
  
  // 6. 大屏链接
  await adminPage.getByRole("button", { name: "打开大屏" }).click();
  await adminPage.locator("code").last().waitFor();
  const displayLink = (await adminPage.locator("code").last().textContent()) ?? "";
  expect(displayLink).toContain("/display/e2e-demo#");
  await adminPage.locator(".mw-dialog__close").last().click();
  
  // 7. 解锁第一个项目（从无当前项目点「下一项目」）
  await adminPage.getByRole("button", { name: "下一项目" }).click();
  await expect(adminPage.getByText("智能写作").first()).toBeVisible();

  const displayPage = await display.newPage();
  await displayPage.goto(displayLink);
  await expect(displayPage.getByText("智能写作")).toBeVisible({ timeout: 15_000 });
  await expect(displayPage.getByText("已提交 0 / 2")).toBeVisible();
  
  // 8. 评委 A 完整评分并提交；评委 B 存草稿
  const judgeAPage = await judgeA.newPage();
  await judgeAPage.goto(judgeLinks[0]!);
  await expect(judgeAPage.getByText("张评委")).toBeVisible({ timeout: 15_000 });
  await judgeAPage.getByRole("button", { name: /智能写作/ }).click();
  for (let i = 0; i < criteria.length; i++) {
    await setScore(judgeAPage, criteria[i]!.name, criteria[i]!.scoreA[0]!);
  }
  await expect(judgeAPage.getByRole("button", { name: "确认提交" })).toBeVisible({ timeout: 10_000 });
  await judgeAPage.getByRole("button", { name: "确认提交" }).click();
  // 新 Dialog 标题会同时渲染可见 h2 与 sr-only 描述，getByText 会 strict 撞双元素
  await expect(judgeAPage.getByRole("heading", { name: "确认提交评分" })).toBeVisible();
  await judgeAPage.getByRole("button", { name: "确认" }).last().click();
  await expect(judgeAPage.getByText("提交成功")).toBeVisible({ timeout: 10_000 });

  const judgeBPage = await judgeB.newPage();
  await judgeBPage.goto(judgeLinks[1]!);
  await expect(judgeBPage.getByText("李评委")).toBeVisible({ timeout: 15_000 });
  await judgeBPage.getByRole("button", { name: /智能写作/ }).click();
  await setScore(judgeBPage, criteria[0]!.name, criteria[0]!.scoreB[0]!);
  await expect(judgeBPage.getByText("已保存", { exact: false })).toBeVisible({ timeout: 10_000 });
  
  // 9. 大屏进度更新为 1 / 2（草稿不计入）
  await expect(displayPage.getByText("已提交 1 / 2")).toBeVisible({ timeout: 10_000 });
  
  // 10. 首次公开排行（确认对话框）
  await adminPage.getByRole("button", { name: "实时排行" }).click();
  await adminPage.getByRole("button", { name: "确认" }).last().click();
  await expect(displayPage.getByText("实时结果 · 非最终成绩")).toBeVisible({ timeout: 10_000 });
  // 评委 A 总分 = (8×30 + 9×30 + 8×40)/100 = 8.30
  await expect(displayPage.getByText("8.30")).toBeVisible();
  
  // 11. 评委 A 改分需解锁；解锁后重交、自动再锁
  await judgeAPage.goBack();
  await expect(judgeAPage.getByText("已锁定")).toBeVisible();
  await judgeAPage.getByRole("button", { name: /智能写作/ }).click();
  await expect(judgeAPage.getByText("已提交并锁定")).toBeVisible();

  await adminPage.locator("table tbody tr").first().click(); // 展开第一行（智能写作）
  await adminPage.getByRole("button", { name: "解锁改分" }).first().click();
  await adminPage.getByRole("button", { name: "解锁改分" }).last().click(); // 确认框接受按钮

  // 评委 A 收到解锁（SSE）后修改并重新提交
  await judgeAPage.goBack();
  await judgeAPage.getByRole("button", { name: /智能写作/ }).click();
  await expect(judgeAPage.getByText("主办方已解锁该评分")).toBeVisible({ timeout: 10_000 });
  await judgeAPage.locator(`input[aria-label="${criteria[0]!.name}"]`).first().fill(String(criteria[0]!.scoreA[1]));
  await judgeAPage.getByRole("button", { name: "提交修改" }).click();
  await judgeAPage.getByRole("button", { name: "确认" }).last().click();
  await expect(judgeAPage.getByText("提交成功")).toBeVisible({ timeout: 10_000 });
  // 大屏按新版本更新：(9×30 + 9×30 + 8×40)/100 = 8.60
  await expect(displayPage.getByText("8.60")).toBeVisible({ timeout: 10_000 });
  
  // 12. 评委 B 首次提交不受解锁限制（仍在评分页，补全后提交）
  for (let i = 1; i < criteria.length; i++) {
    await setScore(judgeBPage, criteria[i]!.name, criteria[i]!.scoreB[0]!);
  }
  await judgeBPage.getByRole("button", { name: "确认提交" }).click();
  await judgeBPage.getByRole("button", { name: "确认" }).last().click();
  await expect(judgeBPage.getByText("提交成功")).toBeVisible({ timeout: 10_000 });
  
  // 13. 闭幕（有缺评：语音笔记/文献图谱 2 评委未评，直接通过页面按钮闭幕）
  await adminPage.getByRole("button", { name: "结果" }).click();
  await expect(adminPage.getByText("实时结果，非最终成绩")).toBeVisible();
  await adminPage.getByRole("button", { name: /导出总榜/ }).click();
  await adminPage.getByRole("button", { name: "闭幕并锁定成绩" }).first().click();
  await adminPage.getByRole("button", { name: "闭幕并锁定成绩" }).last().click();
  await expect(adminPage.getByText("最终结果")).toBeVisible({ timeout: 10_000 });
  
  // 14. 大屏等待揭晓 → 最终榜
  await adminPage.getByRole("button", { name: "现场控制" }).click();
  await adminPage.getByRole("button", { name: "进度模式" }).click();
  await expect(displayPage.getByText("评审已结束，结果待揭晓")).toBeVisible({ timeout: 10_000 });
  await adminPage.getByRole("button", { name: "实时排行" }).click(); // 已公开过，无需再确认
  await expect(displayPage.getByText("最终结果")).toBeVisible({ timeout: 10_000 });
  
  // 15. 闭幕后评分全锁
  await judgeBPage.goto("/judge/e2e-demo/projects");
  await judgeBPage.getByRole("button", { name: /智能写作/ }).click();
  await expect(judgeBPage.getByText("比赛已闭幕，评分已锁定")).toBeVisible();
  
  // 16. 导出与快照一致（API 直接断言）
  const eventId = await eventIdOf(adminPage);
  const resultsCsv = await adminPage.request.get(`/api/admin/events/${eventId}/export/results.csv`);
  expect(resultsCsv.ok()).toBeTruthy();
  const resultsText = await resultsCsv.text();
  expect(resultsText).toContain("final");
  // A: 8.60；B: (7×30+8×30+9×40)/100 = 8.10 → 项目均分 8.35
  expect(resultsText).toContain("8.35");
  const scoresCsv = await adminPage.request.get(`/api/admin/events/${eventId}/export/scores.csv`);
  const scoresText = await scoresCsv.text();
  expect(scoresText).toContain("创新性(30%)");
  expect(scoresText).toContain("missing");
});

async function eventIdOf(adminPage: Page): Promise<string> {
  const list = await adminPage.request.get("/api/admin/events");
  const body = (await list.json()) as { events: { id: string; slug: string }[] };
  return body.events.find((event) => event.slug === "e2e-demo")!.id;
}

/** 登录页填表并提交。 */
async function loginAs(page: Page, username: string, password: string) {
  await page.getByLabel("用户名", { exact: false }).fill(username);
  await page.getByLabel("密码", { exact: false }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}

test("账户系统：建管理员、停用启用、改密与权限边界", async ({ browser }) => {
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await admin.newPage();
  const BASE = E2E_BASE_URL;

  // 登录限流是按 IP 全局 5 次/分钟（与上一用例共享），本用例把登录控制在 4 次。
  await adminGoto(page, `${BASE}/admin/accounts`);

  // 1. 超管新建管理员，随即停用（确认框）再启用（直接生效）
  await page.getByRole("button", { name: "新建管理员" }).click();
  await page.getByLabel("用户名").fill("ops01");
  await page.getByLabel("姓名").fill("运营一号");
  await page.getByLabel("初始密码").fill("ops-password-123456");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("运营一号")).toBeVisible();

  // 列表按创建时间排序：超管自己那行的停用键在首位且被禁用，nth(1) 才是 ops01
  await page.getByRole("button", { name: "停用", exact: true }).nth(1).click();
  // 确认框接受：点击后按钮随弹窗同步卸载，click 的事后重定位会落到超管行那个永久 disabled 的
  // 同名按钮上（enabled 检查永远不过，click 挂死）——用键盘触发并断言结果，绕开重定位竞态
  const confirmAccept = page.getByRole("dialog").getByRole("button", { name: "停用", exact: true });
  await confirmAccept.focus();
  await page.keyboard.press("Enter");
  // exact：成功 toast 文案「账号已停用」含「已停用」子串，会撞 strict
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(page.getByText("已停用", { exact: true })).toBeHidden();

  // 2. 登出 → 新管理员登录；普通管理员无账户管理入口、直连账户页被弹回
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL(/\/admin\/login/);
  await loginAs(page, "ops01", "ops-password-123456");
  await page.waitForURL(`${BASE}/admin`);
  await expect(page.getByRole("button", { name: "账户管理" })).toBeHidden();
  await page.goto(`${BASE}/admin/accounts`);
  await page.waitForURL(`${BASE}/admin`);

  // 3. 自己改密码：确认新密码不一致先拦，正确后成功
  await page.getByRole("button", { name: "修改密码" }).click();
  await page.getByLabel("当前密码").fill("ops-password-123456");
  await page.getByLabel("新密码", { exact: true }).fill("ops-password-654321");
  await page.getByLabel("确认新密码").fill("ops-password-000000");
  await page.getByRole("button", { name: "修改密码" }).last().click();
  await expect(page.getByText("两次输入的新密码不一致")).toBeVisible();
  await page.getByLabel("确认新密码").fill("ops-password-654321");
  await page.getByRole("button", { name: "修改密码" }).last().click();
  await expect(page.getByText("密码已修改")).toBeVisible({ timeout: 10_000 });

  // 4. 旧密码登录失败，新密码成功
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL(/\/admin\/login/);
  await loginAs(page, "ops01", "ops-password-123456");
  await expect(page.getByText("用户名或密码错误")).toBeVisible({ timeout: 10_000 });
  await loginAs(page, "ops01", "ops-password-654321");
  await page.waitForURL(`${BASE}/admin`);
});
