import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import StatusTag from "./StatusTag.vue";
import { mountOptions } from "../test-support/mount";

describe("StatusTag", () => {
  it("三种比赛状态各有文案与配色", () => {
    expect(mount(StatusTag, mountOptions({ props: { status: "draft" } })).text()).toBe("草稿");
    expect(mount(StatusTag, mountOptions({ props: { status: "judging" } })).text()).toBe("评审中");
    expect(mount(StatusTag, mountOptions({ props: { status: "closed" } })).text()).toBe("已闭幕");
  });
});
