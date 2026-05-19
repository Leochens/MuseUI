# AGENTS.md — MuseUI Project Team

## 项目概览

**MuseUI** — 一个浏览器端的 AI 界面与图片设计生成器，支持 UI 原型、社交图形、封面、信息图、Logo、贴纸等视觉内容生成。

- 仓库: `https://github.com/Leochens/MuseUI`
- 技术栈: React 19 + TypeScript + Vite + Vitest
- AI 能力: Google Gemini API / OpenAI Compatible API
- 存储: IndexedDB (idb) + 文件系统服务

## 核心愿景

MuseUI 将 AI 画图能力工程化为"点点点"的图形交互形式，把优质开源 Skill 整合进工具中，供用户直观使用。

## 源代码结构

```
src/
├── components/          # UI 组件 (CanvasBoard, ImageEditor, PromptInput 等)
├── services/           # 业务服务 (aiService, geminiService, db, idbHistoryService 等)
├── studios/            # 设计工作室 (uiDesigner, mediaStudio, gameStudio)
├── skills/             # 设计技能模块 (article-illustrator, cover-image, logo, sticker-design 等)
├── hooks/              # React Hooks (useAppLogic, useGenerationLogic 等)
├── data/               # 静态数据 (changelog, recommended-proxies)
├── types/              # TypeScript 类型定义
├── tests/              # E2E 测试 (Playwright)
└── constants.ts        # 常量
```

## 已有 Skill 模块

`article-illustrator`, `comic`, `cover-image`, `designs`, `infographic`, `layouts`, `logo`, `slide-deck`, `sticker-design`, `xhs-images`

## 团队角色

| Reins | 职责 |
|---|---|
| **pm-analyst** | 需求分析、任务规划、进度跟踪 |
| **skill-analyzer** | 分析外部 Skill，输出工程化方案 |
| **developer** | 功能开发、代码实现 |
| **deployer** | 代码部署、生产验证、Health Check |
| **qa-tester** | 测试验证、质量把控 |

## 开发者指南

- 分支策略: `feature/<name>`, `fix/<name>`
- 构建命令: `npm run build` (tsc + vite build)
- 测试命令: `npm test` (Vitest)
- 开发模式: `npm run dev` (Vite dev server, port 3003)