# Personal .2：Shell 安全审查修复

## 已确认的问题

2026-10-26 的个人版日志重复记录 `AI_NoOutputGeneratedError`。旧版通过 `stream.text` 读取结果，未捕获流的 `onError` 原始错误，因此用户只能看到 `Tool safety review failed during generation`。这条错误说明审查未产出可用结果，不是安全审查返回了 block，也不能据此确定服务端返回的具体 HTTP 原因。

个人 `.1` 将官方固定审查模型替换成聊天模型，但漏掉了独立审查配置和主 Agent 使用的 provider options、推理强度、输出上限、温度。主聊天能调用工具，不代表这条不同参数的辅助请求一定能成功。这是个人版适配不完整。上游的通用错误和持续手动重试机制被原样继承，放大了问题。

## 官方资料与用户反馈

- [官方 1.18.0 文档](https://www.dyad.sh/docs/releases/1.18.0)：Shell 是实验性 Pro Agent 功能，运行前必须审查。
- [上游 Shell 实现 PR #4625](https://github.com/dyad-sh/dyad/pull/4625)：固定独立 Luna 审查，失败时只允许重新审查；Shell 默认审查预算 45 秒，MCP 为 8 秒。Ask/Always consent 不能跳过必需的 Shell 审查。
- [上游 BYOK PR #4672](https://github.com/dyad-sh/dyad/pull/4672)：主模型使用用户 key 时，审查、压缩等辅助请求仍走官方 Engine 的 Luna。官方没有给个人自建审查模型提供相同配置入口。
- [用户反馈 #4828](https://github.com/dyad-sh/dyad/issues/4828)：涉及同意后被当成拒绝和依赖安装失败，维护者讨论的是五分钟 consent 自动拒绝与 Windows 安装修复；并不是本次 generation/NoOutputGenerated 报错的证据。
- [用户反馈 #4655](https://github.com/dyad-sh/dyad/issues/4655)：维护者针对特定免费模型会话讨论工具能力误判与循环，也不能当成本次自定义模型故障的根因。

检索官方文档、相关 PR 与 Issues 后，未找到与本次 Personal 自定义 endpoint 报错完全一致且已确认的上游修复。不能把普通 Agent 循环反馈冒充本次审查故障的解决方案。

## 修复内容

1. Settings → Model Providers → **Safety review model / 安全审查模型**：可以单独指定审查服务、模型 ID、推理强度，或者继续跟随当前聊天模型。API key 和地址复用同一 provider 的配置，不改动聊天模型。
2. 可配置 Shell 审查超时 15–120 秒，默认仍为 45 秒；不改变命令执行的五分钟上限。MCP 自动分类仍保留原有八秒期限。
3. **保存审查配置 → 测试已保存的审查连接**：使用真实审查调用链发送一次请求，带有不读磁盘的固定 inspection 工具；任何结论都不会执行 Shell。测试可能产生用户模型服务费用。
4. Personal 审查转发模型的 provider options、推理强度、输出上限和温度，官方 Engine 模式保持原参数路径。
5. 通过 SDK `onError` 保留原始错误，再提取 HTTP 状态/网络/协议分类；只显示固定的可操作说明，不输出原始 body、URL、请求数据或 API key。
6. 第一次失败最多提供一次手动重试。再次失败直接结束该工具调用，明确未执行命令，要求修正配置后重新提交，避免重试界面无限循环。修改配置后，当前手动重试会读取新审查模型与凭据。
7. 不降低原有政策审查：没有有效结论就不执行；原有 block 不会变为人工批准；Personal 命令在通过审查后仍需逐次确认，保留取消、输出限制、进程树清理及模式限制。

## 更新后怎么用

安装 `v1.20.0-personal.2` 后先终止旧的卡住操作。打开上述设置，选择已配置的、支持流式工具调用的审查模型；保存并点击测试。测试成功后重新提交原任务。

若测试提示 HTTP 401/403，检查该审查服务的 key/模型权限；404 检查 base URL/模型 ID；429 检查服务额度/限流；400/422 检查模型是否支持工具调用及其参数；网络错误检查 endpoint/代理/TLS。诊断分类不会伪造服务响应，也不会自动更换付费服务。

验证只在 GitHub Actions 运行，覆盖配置保存/IPC allowlist、独立模型参数、实际 OpenAI-compatible HTTP 失败与成功流式响应、敏感信息不泄露、失败重试次数和不执行命令的边界。本次未对用户的真实 endpoint 发起测试，也未在本机安装依赖、启动应用、构建或下载安装包。
