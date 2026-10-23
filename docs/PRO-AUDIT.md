# Pro 能力与服务边界审计（v1.20.0）

入口检索覆盖 `src` 的 `isDyadProEnabled`、`enableDyadPro`、`ctx.isDyadPro`、`usesEngineEndpoint`、`engineFetch`、预算/key 检查及主要 UI 入口。逐行索引在 [PRO-GATE-INVENTORY.txt](PRO-GATE-INVENTORY.txt)。该索引是审查入口，不能把文本命中数视为功能数；测试文件不计入生产入口。

| 能力 | 入口与调用链 | 依赖/原授权 | Personal 处理与替代 |
| --- | --- | --- | --- |
| Agent 模式、Basic 试用 | schemas.isBasicAgentMode → chat_stream_handlers admission → local_agent_handler → buildAgentToolSet | 本地试用计数；Pro 开启另行取 Engine 模型 | 独立 enablePersonalMode，直连自有模型；不宣称 Pro，不调用试用服务；官方路径原样保留 |
| BYOK / 本地推理 | model picker → resolve_subscription_model → preflightSubscriptionTurn → get_model_client | 官方 Pro Agent 原本还包装 external_model_usage 进行独立 Engine 计费 | Personal 强制 api-key connection，排除官方 key/计费包装；支持内置 API provider、自定义 OpenAI-compatible、Ollama、LM Studio；模型供应商自己收费 |
| Shell | ShellExperimentSwitch → shell_capability → tool_definitions → run_shell → shell_review → tool_safety_reviewer → shell_process | 本机进程；入口 Pro；审查原固定官方辅助模型 | 开放独立本地能力；审查当前模型；永远逐次确认；保留五分钟上限、64K 实时展示上限及底层有界缓冲、取消/清理、读模式限制、变更检查 |
| 编译器代码探索 | settings.enableCodeExplorer → explore_code availability → subagent_tools.exploreCodeTool → explore_code_raw → code_explorer utility process → workers/code_explorer | 编译器在本地；原仅 Pro Explorer 子 Agent 暴露 | Personal 根 Agent 直接暴露同一只读工具；不依赖官方子 Agent；TypeScript/tsconfig 必须可用，执行时再次检查 |
| 文件、grep、Git、测试、构建、依赖、预览、规划、SQL、MCP、sandbox scripts | tool_definitions 与各 tools；app_operation_coordinator / 既有 IPC | 大部分本地或用户自己配置的外部 provider，普通工具并不要求 Pro | 保留实现与安全协调，继续可用；SQL/部署需要用户自己的账号和确认，不改变其鉴权 |
| MCP 安全自动分类 | AutoApproveMcpSwitch → mcp_auto_consent → tool_safety_reviewer | 原 Pro + 固定辅助模型 | Personal 可使用所选模型分类，错误保留人工 consent；可关闭自动分类；Shell 无论分类结果仍逐次确认 |
| 上下文压缩 | compaction_handler → getAuxiliarySettings → get_model_client | Pro 时固定官方辅助模型，非 Pro 用用户模型 | Personal 始终用该聊天模型，不选择 Pro 辅助模型 |
| 语义代码搜索 code_search | tool → engineFetch `/tools/code-search` | 官方 Engine 服务与 key | 未复刻语义检索服务；Personal 不暴露该工具；可用本地 grep + 编译器 explore_code，或用户配置本地语义索引 MCP |
| 联网搜索 web_search | tool → engineFetch `/tools/web-search` | 官方检索供应链、官方额度 | Personal 不暴露；替代为自建 SearXNG + MCP 或自己购买检索 API 的 MCP；未内置新服务和新密钥 |
| 抓取网页 web_fetch / web_crawl | tools → engineFetch 相应端点 | 官方抓取/浏览器服务 | Personal 不暴露；替代为自建 Playwright/Firecrawl MCP；不直接移除 SSRF/鉴权保护来代替 |
| 图片生成 | generate_image → image_generation_service → Engine | 官方图像引擎/额度/key | Personal 工具过滤且 service 明确拒绝；替代 ComfyUI 或自有图像 API 的 MCP。未配置此类服务，不假报完成 |
| 聊天历史 Explorer | explore_chat_history → explore_chat_history_subagent → Engine 模型 | Pro key 和专用模型 | 未迁移子 Agent；本地 search_chats/read_chat 保留，MCP 可另行补充检索 |
| Explorer / Implementer / Reviewer / advanced subagents / 自动审查 | subagent_tools → subagent_manager → model defaults/Engine fetch | 固定官方角色模型、Pro 生命周期和预算 | Personal 隐藏/过滤相关工具与设置，禁止自动 Review barrier；单个本地 Agent 的编译器探索和自检保留。完整并发编排的 BYOK 模型映射暂未实现 |
| Turbo/lazy edits、Smart Context、Pro web 开关、Saver | schemas、get_model_client、codebase、llm_engine_provider | 部分为遗留配置，当前原生工具模式已不发送其中 Build 优化参数 | 不将遗留配置冒充可用功能；Personal 关闭 Engine 参数路径，使用本地工具按需读文件与 search_replace |
| AI 主题（图片/URL） | themes_handlers generate-theme-prompt / generate-theme-from-url | 图片主题原强制 Pro 与固定模型别名；URL 另依赖官方抓取 | 本期未迁移专用主题生成 UI/模型映射；Personal 拒绝官方生成入口，手写/导入主题仍保留。替代：把参考图交给自有视觉模型生成主题提示再手动保存 |
| 云沙箱 | RuntimeModeSelector → runtime cloud API → app_runtime_service | 官方 cloud key、订阅与持续计费 | 不绕过服务授权；Personal 不开放官方 cloud option，Host 和自有 Docker 保留；Shell 仅 Host |
| 视觉组件编辑/截图标注 | PreviewIframe → 本地 Annotator / AST；UI 以实际 userBudget 启用 | 本地实现的 Pro UI gating | 本期未迁移这组 UI 的全部调用点；不填假预算。可附截图手工描述或普通选择组件，再用本地 Agent 修改；后续可建立独立本地 UI 能力 |
| Security review、移动端/包管理升级 | security_handlers、app_upgrade_handlers → 既有模型/本地变更 | 原有流程按配置使用模型；不是所有 Pro 命名文件都调用付费服务 | 通过统一 get_model_client 保留自有模型路径，未删除原有功能；不更改部署账户/外部服务授权 |
| 官方 Help Bot、预算、配额、Pro 回调、订阅状态、云统计 | help_bot_handlers/pro_handlers、user_budget_service、external_model_usage | 官方独立服务及真实令牌 | 不伪造；Personal Agent 运行不依赖它们。官方帮助/账户入口仍属官方服务；自有模型问题可在普通聊天提出 |
| ChatGPT / Claude Code 订阅连接 | resolve_subscription_model、subscription adapters、subscription preflight | 各供应商真实订阅及 CLI/OAuth | Personal 使用 API/本地模型；需使用订阅适配器时关闭 Personal mode；没有修改供应商鉴权/额度 |
| 应用发布与更新 | Electron Forge / release workflow / main.ts updater | 上游 workflow 依赖官方签名/发布账号，更新馈送指向官方 | 替换为个人 tag workflow + Actions GITHUB_TOKEN；数据/二进制名隔离，官方自动更新禁用；本期未实现个人自动更新服务，采用手动 Releases 更新 |

`isDyadProEnabled` 和 `hasDyadProKey` 的原始订阅含义保持不变。只有独立的 `enablePersonalMode` 控制本地分支。Engine 工具在工具选择与 `engineFetch` 两层阻止 Personal 调用；不会让一个自带 key 冒充官方 key。审计范围以此上游 tag 为界，未来升级需要重新检查新增工具及 endpoint。
