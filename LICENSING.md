# 许可说明

## 本仓库

MangoWrite Judge 以 **AGPL-3.0-or-later** 发布（见 [LICENSE](LICENSE)）。

如果你通过网络向用户提供本软件的服务（例如部署一场比赛让评委扫码评分），AGPL 第 13 条要求你向这些用户提供对应版本源码的获取途径。推荐做法：

1. 部署前把 `VITE_JUDGING_SOURCE_URL` 设为该部署版本源码的可达地址（源码树、tag 或完整 tar 归档均可），再执行 `pnpm build`——前端页脚会展示「源代码」链接。
2. 修改过源码的部署必须指向修改后的版本，不能只链接上游原版。
3. 仅自用或局域网内评委无公网访问的场景，同样建议保留链接；完整法律表述以 AGPL-3.0 原文为准。

## 引用的第三方组件

| 组件 | 许可 | 说明 |
|---|---|---|
| [@mango-write/ui](https://github.com/mango-write/mango-write-ui) | Apache-2.0 | 设计 token、PrimeVue 预设与共享组件；以 Git 固定 commit 引用，保留其 LICENSE 与 NOTICE |
| Vue、PrimeVue、Hono、postgres.js、Tailwind CSS 等 | MIT / Apache-2.0 等宽松许可 | 随构建产物分发，完整清单见各自 package.json 与锁文件 |

## 对二次开发者的要求（摘要，非法律建议）

- 分发或网络服务都必须以 AGPL-3.0-or-later 提供完整对应源码。
- 保留版权与许可声明；修改需标注。
- 不附加与 AGPL 冲突的额外限制。
