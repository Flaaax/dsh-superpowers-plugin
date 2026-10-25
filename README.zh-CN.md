# DSH Superpowers Plugin

[English](./README.md)

这是一个轻量的 DeepSeek Harness（DSH）原生 Cordis bundle：安装到 `desktop` profile 后，它会把固定版本的 [obra/superpowers](https://github.com/obra/superpowers) 注册到 DSH 原生技能目录，并在每个会话的 system prompt 中自动注入 `using-superpowers` bootstrap。

- 默认 profile：`desktop`
- 已验证 DSH：`0.2.1-rc.3`
- Superpowers：`v7.0.1`，commit `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`
- 其余技能按需通过原生 `skill` 工具加载；不会把所有技能正文塞进每轮上下文
- 无 OpenCode 依赖、无 `postinstall`、运行时仅使用 Node.js 内置模块

## 安装

安装固定的 GitHub 正式版本：

```powershell
dsh plugin --profile desktop add "https://github.com/Flaaax/dsh-superpowers-plugin.git#v0.1.1"
```

本地开发目录安装：

```powershell
dsh plugin --profile desktop add "E:\Projects\JavaScript\dsh-superpowers-plugin"
```

安装后重启 DeepSeek Harness 桌面应用。安装命令不会主动关闭正在运行的桌面应用。

本项目目前没有发布 npm 包。未来若发布，应同样固定明确版本：

```powershell
# npm 包发布后，固定到明确版本
dsh plugin --profile desktop add "<npm-package-name>@<version>"
```

## 验证

```powershell
dsh plugin --profile desktop list --depth 0
npm test
npm run verify:upstream
npm pack --dry-run
```

在桌面应用中新建会话后，可以先问“你有哪些 Superpowers？”；面对“设计一个新功能”时，模型应先调用裸技能名 `skill("brainstorming")`，而不是 `skill("superpowers:brainstorming")`。调试任务应先加载 `systematic-debugging`。

bundle row 的稳定 id 是 `dsh-superpowers`。可在桌面应用的插件页确认该插件已启用；对于允许 CLI dump 的非桌面 profile，也可用 `dsh --profile <name> --dump-config` 搜索这个 id。当前 DSH 将真实 `desktop` profile 交由 Electron 独占管理，因此 CLI 对它执行 `--dump-config` 会明确拒绝；这不代表插件未安装。

## 配置

默认配置如下：

```yaml
- id: dsh-superpowers
  config:
    skills: true
    bootstrap: true
    toolMapping: true
    order: 50
```

配置项：

- `skills`：注册随包技能目录；关闭后不再提供这些技能。
- `bootstrap`：自动注入 `using-superpowers`；设为 `false` 可只保留技能目录。
- `toolMapping`：在 bootstrap 后附加 DSH 工具映射。
- `order`：system prompt section 顺序。DSH `0.2.1-rc.3` 的 persona 是 `0`，工具指导从 `1000` 开始，默认 `50` 位于二者之间。

如需覆盖配置，在目标 profile 自己的 `cordis.patch.yml` 中添加对应 row patch；无需改本插件或 DSH 内置文件。例如只保留技能目录：

```yaml
- id: dsh-superpowers
  config:
    bootstrap: false
```

改完后重启桌面应用。不要在同一 profile 重复安装多个本插件副本。

## 更新

更新正式版本时安装新的明确 tag，再重启桌面应用：

```powershell
dsh plugin --profile desktop add "https://github.com/Flaaax/dsh-superpowers-plugin.git#v0.1.1"
```

本地开发目录更新后可重新安装本地链接：

```powershell
dsh plugin --profile desktop add "E:\Projects\JavaScript\dsh-superpowers-plugin"
```

维护者同步上游时必须显式指定稳定 tag 或完整 commit；脚本拒绝 `main`、`dev` 等浮动分支：

```powershell
npm run sync:upstream -- --ref v7.0.1
```

同步脚本先在临时目录检出上游，更新 skills、上游许可证和 `upstream-lock.json`，再执行校验和完整测试。失败会恢复原 payload。它会报告新增、删除和变化的文件；普通安装不会运行该脚本。

`upstream-lock.json` 记录仓库、tag/ref、完整 SHA、同步时间以及每个 vendored 文件的 SHA-256。当前没有修改任何上游 skill，`allowedDifferences` 为空。

## 一键卸载

```powershell
dsh plugin --profile desktop remove dsh-superpowers-plugin
```

重启桌面应用即可。该命令只移除本插件，不会删除或升级其他插件，也不会改用户的技能和个人配置。

## 故障排查

- 技能未出现：确认安装命令的 profile 是 `desktop`，运行 `dsh plugin --profile desktop list --depth 0`，然后完整重启桌面应用。
- bootstrap 不生效：检查 profile overlay 是否把 `bootstrap` 设成了 `false`，并新建会话测试。
- 同名技能行为不同：插件 provider 使用 rank `550`，且 desktop 的 scoped 本地 provider 会覆盖全局同名项；项目或用户技能可能有意遮蔽 vendored 版本。
- provider 警告：运行 `npm test` 和 `npm run verify:upstream`；缺失、非法 frontmatter 和重复技能名都会产生带路径的诊断。
- 上游校验失败：不要手改 `skills/`；用显式 ref 重新运行同步脚本。

## 实现结构

- `lib/index.js`：Cordis 插件、懒加载 skill provider、bootstrap 与工具映射。
- `lib/frontmatter.js`：零依赖 frontmatter 解析和校验。
- `skills/`：固定、校验过的 Superpowers payload。
- `scripts/sync-upstream.mjs`：维护者显式同步与事务式回滚。
- `scripts/verify-upstream.mjs`：只读校验。
- `cordis.patch.yml`：稳定 row `dsh-superpowers`。
- `test/`：provider、bootstrap、打包与独立加载测试。

## 许可证

插件代码使用 [MIT License](./LICENSE)。Vendored Superpowers 内容保留其上游许可证，见 [LICENSE.superpowers](./LICENSE.superpowers)；来源为 `https://github.com/obra/superpowers` 的上述固定 tag/commit。完整中英文第三方声明见 [NOTICE.md](./NOTICE.md)。
