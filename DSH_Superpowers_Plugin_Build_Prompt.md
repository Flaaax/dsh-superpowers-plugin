# 任务：为 DeepSeek Harness 制作一键安装的 Superpowers 插件

你正在一个新的空项目中工作。请在当前项目内完整设计、实现、测试并交付一个 DeepSeek Harness（DSH）原生插件，使用户只需把插件安装到 DSH 的 `desktop` profile，就能开箱即用地获得 `obra/superpowers`。

不要只给出方案或代码片段；请实际创建项目文件、实现功能、运行测试并完成本地端到端验证。遇到普通技术问题时自行调查和解决，不要把本可自行完成的步骤转交给用户。

## 开始前必须完成的调查

1. 阅读当前项目及其父级目录中所有适用的 `AGENTS.md`，并遵守其中的环境规则。
2. 核对本机 DSH 的版本、安装位置、`desktop` profile 路径以及当前 profile 状态。本机主要使用 DeepSeek Harness 桌面应用，因此目标 profile 是 `desktop`，不是 `web`。
3. 阅读当前版本 DeepSeek Harness 的官方插件、技能注册和 system prompt API，必要时检查本机已安装代码。不要仅凭旧示例猜测 API。
4. 检查以下上游资料及其当前状态：
   - `https://github.com/obra/superpowers`
   - `https://github.com/obra/superpowers/blob/main/docs/porting-to-a-new-harness.md`
   - `https://github.com/obra/superpowers/pull/2144`
5. 检查最新稳定的 Superpowers release/tag。选择开始实现时最新的稳定 tag，并固定 tag 和完整 commit SHA；不要追踪浮动的 `main`。
6. 可以参考已有社区 DSH 适配的架构，但不要直接复制未经审计的发布包，也不要把 OpenCode 插件当作 DSH 插件使用。重点理解 `ctx.skills`、`ctx.systemPrompt` 和 `dsh.bundle`。

在调查后先向用户简短报告选定的上游版本、当前 DSH 版本和实现策略，然后继续实现，不要停下来等待不必要的确认。

## 目标体验

最终用户的安装体验应当尽量接近一条命令：

```powershell
dsh plugin --profile desktop add <插件包、GitHub 地址或本地目录>
```

重启 DeepSeek Harness 桌面应用后：

- 全部 Superpowers skills 出现在 DSH 原生技能目录中；
- 每个 skill 都能通过 DSH 原生 `skill` 工具按需加载；
- 每个新会话都会自动获得 `using-superpowers` bootstrap；
- 模型会先判断并加载适用技能，而不是直接开始实现；
- 上下文压缩后 bootstrap 仍然有效；
- 不需要用户手工复制技能、编辑个人配置或安装 OpenCode 插件。

“自动加载”只针对 `using-superpowers` bootstrap。不要在每个会话中注入全部技能正文；其他技能必须按需加载，以控制 token 消耗。

## 技术约束

- 使用现代 JavaScript（Node.js ESM）实现运行时代码。
- 使用 DSH 原生 Cordis 插件体系。
- 优先直接提交可运行的 `.js`，不引入 TypeScript 编译步骤，除非调查后有明确且可验证的必要性。
- 运行时尽量只使用 Node.js 内置模块，不增加不必要依赖。
- 插件必须通过 DSH 自己的安装机制进入 profile；不得手工修改用户的全局提示词、个人 `AGENTS.md`、DSH 内置文件或 OpenCode 配置。
- 不使用 `postinstall` 或其他安装钩子在用户安装时动态下载 GitHub 内容。
- 将经过固定和校验的 Superpowers skills 随插件包一起发布，使安装可重复、可审计并尽可能离线工作。
- 不要发布 npm 包、创建 GitHub 仓库、推送代码或创建 PR，除非用户随后明确要求。
- 不要读取、打印或提交凭据、API key、DSH credentials、会话内容或其他秘密。
- 不要删除或覆盖用户已有的 DSH 插件和 profile 配置。

## 必须实现的功能

### 1. DSH bundle

提供正确的 `package.json` 与 `cordis.patch.yml`：

- `package.json` 必须声明 ESM 入口；
- 必须通过 `dsh.bundle.patch` 声明 Cordis patch；
- npm/package 文件白名单必须包含运行所需的插件代码、skills、许可证、文档及必要脚本；
- 不应包含临时文件、测试输出、上游 Git 仓库或凭据；
- bundle patch 应把插件挂载为一个明确且稳定的 row id。

### 2. Skill provider

通过当前 DSH API 向 `ctx.skills` 注册一个 provider：

- 从插件包内部的 `skills/<name>/SKILL.md` 发现技能；
- 正确解析 YAML frontmatter 中的 `name`、`description` 和可选字段；
- 使用懒加载：列目录时不必把所有正文长期放进上下文，调用技能时才返回正文；
- 返回正确的 `resourceBase`，使 skill 内相对引用的脚本、模板或参考资料可以解析；
- 处理缺失文件、非法 frontmatter、重复技能名和取消信号；
- provider 名称、来源和优先级必须合理，不应意外覆盖用户的本地同名技能；如 DSH 当前优先级语义不同，以实测和官方代码为准。

### 3. 会话 bootstrap

通过当前 DSH 的 system-prompt 扩展接口注入 `using-superpowers`：

- 从随包携带的 `skills/using-superpowers/SKILL.md` 读取正文并去除 YAML frontmatter；
- 按 Superpowers 上游移植指南要求加入明确的 bootstrap 包装与说明；
- 注入为稳定、可缓存且会在上下文压缩后继续存在的 prompt section；
- section 顺序应位于 persona 之后、沙箱/工具指导之前。历史实现使用 `order: 50`，但必须结合当前 DSH 的 section order 常量验证；
- 不得每一轮向聊天历史重复追加同一段消息；
- 支持配置开关，例如 `skills`、`bootstrap`、`toolMapping` 和 `order`，同时提供安全合理的默认值。

### 4. DSH 工具映射

在 bootstrap 中附加 DSH 专用工具映射。映射必须依据本机当前 DSH 实际工具名称生成或编写，至少覆盖：

- 调用技能；
- 读取、创建、编辑文件；
- 搜索文件和文本；
- PowerShell/命令执行；
- todo/goal 或工作流管理；
- 子代理及并行代理；
- 用户提问；
- Git worktree 能力（若当前 DSH 有原生能力则优先原生能力）。

DSH 的技能通常使用裸名称。必须明确告诉模型：当上游文档出现 `superpowers:<name>` 时，在 DSH 中调用裸名称 `<name>`，例如：

```text
skill("brainstorming")
```

不要为了替换工具名或技能前缀而批量改写上游技能正文；这类差异应由 DSH 工具映射统一解决。只有上游明确允许的、用于指向 DSH reference 的最小改动才可考虑，并必须记录和测试。

### 5. 上游同步与可追溯性

插件必须记录：

- 上游仓库 URL；
- 固定的 Superpowers tag；
- 完整 commit SHA；
- 同步日期；
- skills 文件清单及校验信息。

提供维护者使用的显式同步脚本，例如 `scripts/sync-upstream.mjs`：

- 参数必须要求明确 tag 或 commit，不允许默认跟随 `main`；
- 下载或复制前后进行校验；
- 同步到临时目录后再替换目标内容，失败时不能留下半更新状态；
- 同步时保留并更新许可证；
- 同步后自动运行完整验证；
- 能报告新增、删除和发生变化的技能；
- 普通用户安装插件时不会自动运行该脚本。

再提供一个只读的验证脚本，确认 vendored skills 与记录的上游版本一致。若为了 DSH 增加了允许的最小差异，应把差异列入明确的 allowlist，不能静默忽略。

### 6. 文档

至少提供：

- `README.md`：优先以中文说明安装、卸载、更新、验证、配置和故障排查；
- 清楚标注默认目标是 `desktop` profile；
- 给出本地目录、GitHub URL 和未来 npm 包三种安装形式，但不要声称尚未实际发布的渠道已经可用；
- 说明重启桌面应用的要求；
- 说明全部技能是按需加载的；
- 记录固定的上游版本和许可证来源；
- 说明如何关闭 bootstrap 或只保留技能目录；
- 说明如何确认 profile 中已经出现插件 row；
- 提供干净的卸载方法，只删除本插件，不影响其他插件。

## 建议的项目结构

可以根据当前 DSH API 调整，但至少应达到同等清晰度：

```text
.
├─ package.json
├─ cordis.patch.yml
├─ README.md
├─ LICENSE
├─ LICENSE.superpowers
├─ lib/
│  └─ index.js
├─ skills/
│  ├─ using-superpowers/
│  │  └─ SKILL.md
│  └─ ...
├─ scripts/
│  ├─ sync-upstream.mjs
│  └─ verify-upstream.mjs
├─ test/
│  ├─ provider.test.mjs
│  ├─ bootstrap.test.mjs
│  └─ package.test.mjs
└─ upstream-lock.json
```

## 测试要求

使用 Node.js 内置 `node:test` 或同等轻量方案。至少覆盖：

- manifest 和 bundle patch 正确；
- 包入口可以被 Node 解析和导入；
- provider 注册成功；
- 所有 vendored skills 都能列出并逐个加载；
- frontmatter 解析，包括 quoted scalar、literal/folded block scalar 等实际可能出现的形式；
- `resourceBase` 指向正确目录；
- 缺失或非法 skill 的错误可诊断；
- bootstrap 已去除 frontmatter且只包含一次；
- bootstrap 包含 DSH 工具映射和裸技能名规则；
- bootstrap section 顺序正确；
- 配置开关有效；
- npm package 文件清单完整，没有漏掉 skills、references、scripts 或许可证；
- `npm pack --dry-run` 或实际生成到临时目录的 tarball 可以被解包并独立加载；
- vendored skills 与 `upstream-lock.json` 一致。

不得以“单元测试通过”代替真实 DSH 验证。

## 本地集成和端到端验收

在不破坏用户现有配置的前提下完成以下验证：

1. 优先创建隔离的临时 DSH profile，或使用 DSH 官方支持的本地插件测试方式。若当前 DSH 无法让临时 profile 复刻 `desktop`，再把本地插件安装到真实 `desktop` profile；本提示词已授权为完成该插件测试而安装当前项目的本地插件，但不得移除、升级或修改其他插件。
2. 安装应使用 DSH 自己的命令和当前项目的绝对路径。
3. 执行配置 dump，确认插件 bundle row 存在且无重复。
4. 启动可自动化的 DSH 会话进行 smoke test，确认：
   - 模型知道自己拥有 Superpowers；
   - 面对一个需要设计的新功能时，首个相关工具调用是裸名称的 `skill("brainstorming")`，而不是先写文件；
   - 对调试任务能加载 `systematic-debugging`；
   - 不会尝试 `skill("superpowers:brainstorming")`；
   - 日志中没有 provider、prompt section 或 bundle 加载错误。
5. 若桌面 UI 的最终重启必须由用户完成，可以在其余自动验证完成后清楚说明只剩这个人工步骤；不要强制关闭用户正在运行的桌面应用。
6. 保留插件安装状态供用户使用。只清理本任务创建的临时 profile、临时包和测试文件，不要卸载最终的 `desktop` 插件。

## 完成标准

只有满足以下条件才算完成：

- 一条 DSH 安装命令即可把插件装入 `desktop` profile；
- 插件不依赖 OpenCode；
- skills、bootstrap 和 DSH 工具映射三部分均工作；
- 技能正文按需加载；
- 固定并记录了上游 tag 和 commit；
- 自动测试全部通过；
- 打包检查通过；
- 在真实 DSH 上完成了至少一次可复现的 smoke test；
- README 中的命令与实际验证过的命令一致；
- 没有修改当前项目以外的源文件，除 DSH 官方插件安装机制对目标/临时 profile 所做的预期变更。

## 最终汇报格式

完成后简洁汇报：

1. 实现结果和选定的上游版本；
2. 主要文件及其职责；
3. 实际运行过的测试和结果；
4. DSH `desktop` profile 的安装与验证结果；
5. 用户日后安装、更新、配置和卸载所需的准确命令；
6. 仍存在的限制或必须由用户完成的桌面重启步骤。

不要把未执行的检查描述为已验证，也不要把候选方案描述为正式发布版本。
