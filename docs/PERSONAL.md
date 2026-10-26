# Dyad Personal

个人内部使用的独立定制发行版，基于官方稳定版 **v1.20.0**（上游提交 `0b988ac4ecceb5bd9326367d97661ef779d116db`，2026-10-19 发布）。保留完整上游 Git 历史及许可证。此发行版与官方订阅服务分别配置，不声明拥有官方 Pro 权益。

## 日常使用

1. 从本仓库 Releases 下载 Windows x64 安装 EXE 或便携 ZIP。按个人使用要求，后续自动发行仅构建 Windows；旧版已完成的其他平台产物保留。
2. 打开 Settings → Model Providers，添加自己的 API key，或配置自建 OpenAI-compatible provider、Ollama、LM Studio，然后在模型选择器选择实际模型。使用支持工具调用的模型；图像附件还需要模型支持视觉输入。
3. Personal mode 默认开启，模型直接请求上述 provider。该模式的本地 Agent 不使用 Basic Agent 的本地试用计数，也不发送 Engine 计费请求；模型供应商自己的鉴权、付费和限流照常适用。
4. Settings → Experiments 中可启用 Shell（默认关闭）。每条命令先由当前模型安全审查，再对准确命令请求一次性用户确认；即使保存 Always 也不能跳过确认。默认超时 60 秒、上限 300 秒，保留输出截断、取消、进程树清理、环境变量过滤、工作区协调和部分编辑提示。仅 Host 模式、可写根 Agent 可用。
5. TypeScript 项目可使用本地 `explore_code` 编译器代码图；项目必须安装 TypeScript 并具备可发现的 tsconfig。普通读文件、grep、Git、类型检查、测试、构建、预览及 MCP 沿用原有实现。
6. MCP 可连接自建网页检索、爬虫、图像等服务，密钥通过服务配置提供。MCP 安全分类也使用当前模型，分类失败仍回退到人工确认。

从 `personal.2` 起，可在 Settings → Model Providers → **Safety review model / 安全审查模型** 单独配置审查模型、推理强度和 Shell 审查超时，保存后点击 **测试已保存的审查连接**。测试会调用模型而不执行 Shell 命令。详见 [审查故障原因与修复](SAFETY-REVIEW-FIX.md)。

Personal mode 下不暴露官方付费 Engine 工具。需要官方服务时可关闭 Personal mode 并配置真实官方凭据；不会代填 key、伪造订阅或修改官方配额。已存在的官方订阅设置不会被改写。暂未迁移的功能见 [PRO-AUDIT.md](PRO-AUDIT.md)。

应用名 `Dyad Personal`，可执行文件 `dyad-personal`，macOS bundle ID `dev.selfcommand.dyad-personal`。使用独立的 Electron 用户数据目录，默认项目目录为 `~/dyad-personal-apps`。不自动复制官方配置或已有项目。官方自动更新入口被禁用，更新从个人 Releases 手动安装。

## 开发 / 手动构建（仅在有足够网络和明确需要时）

要求 Node.js `>=24 <26`；CI 固定 Node 24.13.1 / npm 11.8.0。Electron 40、React、TypeScript、Vite、Electron Forge 沿用上游。

```sh
npm ci
npm ci --prefix testing/fake-llm-server
npm run init-precommit
mkdir userData
npm start
```

`userData` 存在时跳过 mkdir。`npm run package` 生成未压缩应用；`npm run make` 在本平台生成安装包；`npm run build` 是上游 E2E 专用 package，正式发行使用 make。macOS 无 Apple 凭据默认不签名，有 `APPLE_TEAM_ID`、`APPLE_ID`、`APPLE_PASSWORD` 与安装好的证书时保留上游签名能力。Windows 默认不签名，既有 `WINDOWS_SIGN` 与 Azure 签名配置继续可用。

本次遵循用户后续要求：**本地仅编辑源码，不在本机运行安装、应用或构建；全部新增验证由 Actions 执行**。最初原始要求下启动的 npm ci 已在停止指令到达前结束，此后没有继续使用本机依赖。

## 自动检查与发行

`.github/workflows/release.yml`：

- 推送 `personal/**` 分支：在云端安装依赖、actionlint 校验工作流、严格格式检查、lint、tsgo/worker 类型检查、回归测试。分支提交仅检查；标签或手动触发才构建 Windows x64。
- 推送 `vX.Y.Z-personal.N` 标签：相同检查全部通过后，收集 Windows 安装 EXE 和便携 ZIP、创建草稿 Release、逐个流式上传并核对 GitHub 返回的 SHA256/字节数，完整复核后才公开 Release。package.json/package-lock.json 版本必须与标签一致。
- 可用 workflow_dispatch 手动验证当前 ref；只有标签 ref 才公开发行。仅分支构建不会发布 Release。
- Windows 使用 windows-2022 x64；自动发行不再调度 Linux 或 macOS 构建。源代码保留上游平台支持与手动 make 能力。
- 产物名统一包含版本、平台、架构；每个平台附 SHA256SUMS 和源提交 manifest。只发布完整目标集合；已有公开 Release 拒绝覆盖；仅允许恢复本工作流相同源提交创建的草稿，且不覆盖不同资产。
- Release job 只使用自动提供的 **Actions Secret `GITHUB_TOKEN`**（映射为 `GH_TOKEN`），权限 `contents: write`；无需把本机 PAT 上传到仓库，不把密钥写进源码。构建 job 只有只读权限。没有签名 Secrets 时产物为未签名版。
- 默认保留本地 make 命令；无需调用官方发布器或配置官方 release 环境。

下一版只需编辑两个 package 文件的版本，提交后打一个新标签并推送：

```sh
git tag v1.20.0-personal.3
git push origin personal/local-tools
git push origin v1.20.0-personal.3
```

示例前提是已将两个版本文件改成 `1.20.0-personal.3`，并提交。不要移动已发布标签。出错会保留未公开草稿，修复代码后应使用新版本；仅网络上传失败可在同一提交上安全重跑。

## 实际验收记录

实际结果以本仓库 Actions 的 job、测试输出和 Releases 资产为准。未执行本机构建，不将 mock 发布回归测试当成真实远端发布成功。代码中 `scripts/personal-release.test.mjs` 用 fake GitHub 覆盖：精确标签、401、Windows 产物集合、文件校验、草稿恢复、已发布版本保护和标签移动保护。源码测试覆盖独立订阅判断、直连模型、辅助模型、Shell 能力边界和逐次确认。

2026-10-24，首轮四平台完整构建在 [Actions run 39993229641](https://github.com/Self-Command/dyad-personal/actions/runs/39993229641) 全部通过，Linux 正式包成功启动并完成真实渲染器与 IPC 检查；随后新增的首次使用引导、官方账号隔离、Host/Cloud 边界回归也通过云端 verify。最终发行以 `v1.20.0-personal.1` 标签的完整流水线为准。没有调用用户真实模型 API，本期模型调用验证使用自定义 HTTP 假服务及真实 IPC/文件/Git/数据库调用链。原始未修改版没有单独启动验收，不将个人版启动结果冒充原版结果。

已保留上游 `dyad://` OAuth 深链兼容性；在同一电脑安装官方版和个人版时，系统可能把该协议交给最后注册的版本。两者的数据和项目目录独立，但登录回调应在需要的版本内发起。

## 许可证

根目录代码遵循 [Apache-2.0](../LICENSE) 与 [NOTICE](../NOTICE)，`src/pro` 遵循 [FSL-1.1-ALv2](../src/pro/LICENSE)，修改不移除原版权声明。Personal 发行针对个人/内部用途；不是官方发行，也不向官方服务提供免费访问。完整源码和许可证随版本标签保留。
