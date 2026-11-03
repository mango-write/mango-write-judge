import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

const staleRef = ref(false);
const revisionCallbacks: Array<(revision: number) => void> = [];

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === "/display/snapshot") return currentSnapshot();
      throw new Error(`unexpected api.get ${path}`);
    }),
    post: vi.fn(async (path: string) => {
      if (path === "/display/session") return { ok: true };
      throw new Error(`unexpected api.post ${path}`);
    }),
  },
  ApiError: class extends Error {},
}));

vi.mock("../lib/sse", () => ({
  useRevisionStream: vi.fn((_path: string, onRevision: (revision: number) => void) => {
    revisionCallbacks.push(onRevision);
    return { revision: 0, stale: staleRef };
  }),
}));

import type { DisplaySnapshotDto } from "@mango-write-judge/contracts";
import DisplayView from "./DisplayView.vue";
import { mountOptions } from "../test-support/mount";

let snapshot: DisplaySnapshotDto;

function currentSnapshot() {
  return snapshot;
}

function mountDisplay() {
  return mount(DisplayView, mountOptions({ props: { slug: "demo" } }));
}

beforeEach(() => {
  staleRef.value = false;
  window.location.hash = "";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DisplayView", () => {
  it("进度模式：展示当前项目与提交进度，不包含任何分数文本", async () => {
    snapshot = {
      revision: 1,
      mode: "progress",
      eventName: "Demo Day",
      status: "judging",
      currentProject: { position: 2, name: "智能写作助手", teamName: "甲队" },
      submittedCount: 3,
      judgeCount: 5,
    };
    const wrapper = mountDisplay();
    await vi.waitFor(() => expect(wrapper.text()).toContain("智能写作助手"));
    expect(wrapper.text()).toContain("3 / 5");
    expect(wrapper.text()).not.toMatch(/\d+\.\d\d/); // 无两位小数分数
    expect(wrapper.text()).not.toContain("rank");
  });

  it("排行模式：渲染名次与分数，实时阶段显示非最终标记", async () => {
    snapshot = {
      revision: 2,
      mode: "ranking",
      eventName: "Demo Day",
      status: "judging",
      final: false,
      resultHash: null,
      judgeCount: 3,
      rows: [
        { projectId: "p1", position: 1, rank: 1, name: "A 项目", teamName: "一队", scoreText: "9.50", submittedCount: 3, judgeCount: 3, complete: true },
        { projectId: "p2", position: 2, rank: 2, name: "B 项目", teamName: "二队", scoreText: "8.00", submittedCount: 2, judgeCount: 3, complete: false },
      ],
    };
    const wrapper = mountDisplay();
    await vi.waitFor(() => expect(wrapper.text()).toContain("A 项目"));
    expect(wrapper.text()).toContain("9.50");
    expect(wrapper.text()).toContain("缺评");
    expect(wrapper.text()).toContain("非最终成绩");
  });

  it("断线 stale：保留最后快照并显示连接中断", async () => {
    snapshot = {
      revision: 3,
      mode: "progress",
      eventName: "Demo Day",
      status: "judging",
      currentProject: { position: 1, name: "项目一", teamName: "" },
      submittedCount: 1,
      judgeCount: 4,
    };
    const wrapper = mountDisplay();
    await vi.waitFor(() => expect(wrapper.text()).toContain("项目一"));
    staleRef.value = true;
    await vi.waitFor(() => expect(wrapper.text()).toContain("连接中断"));
    expect(wrapper.text()).toContain("项目一"); // 快照内容保留
  });

  it("闭幕未揭晓显示等待文案", async () => {
    snapshot = {
      revision: 4,
      mode: "progress",
      eventName: "Demo Day",
      status: "closed",
      currentProject: null,
      submittedCount: 4,
      judgeCount: 4,
    };
    const wrapper = mountDisplay();
    await vi.waitFor(() => expect(wrapper.text()).toContain("评审已结束，结果待揭晓"));
  });
});
