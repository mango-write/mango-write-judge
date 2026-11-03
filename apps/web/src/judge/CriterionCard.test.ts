import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import CriterionCard from "./CriterionCard.vue";
import { mountOptions } from "../test-support/mount";

describe("CriterionCard", () => {
  it("展示名称、权重与当前分数（十分位 → 一位小数）", () => {
    const wrapper = mount(CriterionCard, mountOptions({
      props: { name: "创新性", weightPercent: 30, modelValue: 87 },
    }));
    expect(wrapper.text()).toContain("创新性");
    expect(wrapper.text()).toContain("30%");
    expect(wrapper.text()).toContain("8.7");
  });

  it("未评分显示 —，缺失高亮加 danger 边框", () => {
    const normal = mount(CriterionCard, mountOptions({
      props: { name: "A", weightPercent: 10, modelValue: undefined },
    }));
    expect(normal.text()).toContain("—");
    expect(normal.classes()).not.toContain("tw:border-danger");

    const highlighted = mount(CriterionCard, mountOptions({
      props: { name: "A", weightPercent: 10, modelValue: undefined, highlight: true },
    }));
    expect(highlighted.classes()).toContain("tw:border-danger");
  });

  it("disabled 状态下输入通道禁用", () => {
    const wrapper = mount(CriterionCard, mountOptions({
      props: { name: "A", weightPercent: 10, modelValue: 50, disabled: true },
    }));
    const input = wrapper.find("input");
    expect(input.attributes("disabled")).toBeDefined();
  });

  it("commit 通道：合法值更新为十分位整数，非法值忽略", async () => {
    const wrapper = mount(CriterionCard, mountOptions({
      props: { name: "A", weightPercent: 10, modelValue: 50 },
    }));
    const vm = wrapper.vm as unknown as { commit: (v: number | null) => void };
    vm.commit(8.7);
    vm.commit(null);
    vm.commit(11);
    const updates = wrapper.emitted("update");
    expect(updates).toEqual([[87]]);
  });
});
