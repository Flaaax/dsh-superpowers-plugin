# DSH Superpowers Plugin

[简体中文](./README.zh-CN.md)

A lightweight native [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Cordis bundle that brings the pinned [obra/superpowers](https://github.com/obra/superpowers) skill collection to DSH.

- Default target: the DSH `desktop` profile
- Tested with DSH `0.2.1-rc.3`
- Vendored Superpowers `v7.0.1` at commit `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`
- Native lazy-loaded `ctx.skills` provider
- Automatic `using-superpowers` bootstrap through `ctx.systemPrompt`
- Native desktop configuration form for all four plugin options
- DSH-specific tool mapping with bare skill names such as `skill("brainstorming")`
- No OpenCode dependency, install hook, or build step; the only direct runtime dependency is DSH's native `@deepseek-ai/schemastery`

Only the bootstrap is injected into every model request. All other skills are loaded on demand through DSH's native `skill` tool.

## Install

Install the pinned GitHub release into the desktop profile:

```powershell
dsh plugin --profile desktop add "https://github.com/Flaaax/dsh-superpowers-plugin.git#v0.2.0"
```

Fully quit and restart the DeepSeek Harness desktop application, then start a new conversation.

Confirm the installed dependency:

```powershell
dsh plugin --profile desktop list --depth 0
```

For local development:

```powershell
dsh plugin --profile desktop add "E:\Projects\JavaScript\dsh-superpowers-plugin"
```

The project is not currently published to npm. If an npm package is published in the future, pin its exact version just like the Git tag.

## Manual smoke test

After restarting the desktop app, open a new conversation and try:

```text
Let's make a React todo list. Do not create or edit any files yet. Follow the applicable Superpowers workflow and briefly state the first design question.
```

The first relevant tool call should be the bare name `skill("brainstorming")`, before any file write. It must not call `skill("superpowers:brainstorming")`.

For debugging:

```text
A test is failing: expected 42 but received undefined. Do not edit files. Follow the applicable Superpowers workflow and briefly state the first diagnostic step.
```

The model should load `systematic-debugging`.

## Update

Install the new explicit tag, then restart the desktop app:

```powershell
dsh plugin --profile desktop add "https://github.com/Flaaax/dsh-superpowers-plugin.git#v0.2.0"
```

Do not install an unpinned `main` branch if reproducible behavior matters.

## Uninstall

One command removes only this plugin:

```powershell
dsh plugin --profile desktop remove dsh-superpowers-plugin
```

Restart the desktop app afterward. Other plugins and user skills are not changed.

## Configuration

In the desktop app, open this plugin's detail page on the **Plugins** page (not the Components page). A settings card registered by the client plugin (`lib/client.js`) through the `plugins.bundle.config` slot renders `skills`, `bootstrap`, `toolMapping`, and `order`; no YAML editing is required for normal changes. Start a new conversation after saving. If the running desktop generation does not refresh immediately, fully quit and restart it.

The equivalent defaults are:

Defaults:

```yaml
- id: dsh-superpowers
  config:
    skills: true
    bootstrap: true
    toolMapping: true
    order: 50
```

- `skills`: register the vendored skill catalog.
- `bootstrap`: inject `using-superpowers` automatically. Set it to `false` to keep only the catalog.
- `toolMapping`: append the native DSH tool translation.
- `order`: system-prompt section order. The default `50` is after the current persona slot (`0`) and before tool guidance (`1000+`).

Override the stable row `dsh-superpowers` in the target profile's own `cordis.patch.yml`. For example, to retain the skills without the bootstrap:

```yaml
- id: dsh-superpowers
  config:
    bootstrap: false
```

## Verification

```powershell
npm test
npm run verify:upstream
npm pack --dry-run
```

The test suite covers manifest and patch validation, provider registration, every vendored skill, frontmatter parsing, lazy loading, cancellation, bootstrap configuration, package contents, an actual unpacked tarball import, and the upstream lock.

## Upstream maintenance

The sync command requires an explicit stable tag or full commit SHA and rejects floating branches:

```powershell
npm run sync:upstream -- --ref v7.0.1
```

It stages the new payload in a temporary directory, updates the upstream license and lock, reports added/removed/changed files, runs verification and the complete test suite, and restores the previous payload if validation fails. It is never run during user installation.

## License

The DSH integration code is MIT licensed; see [LICENSE](./LICENSE). Vendored Superpowers content retains its upstream MIT license in [LICENSE.superpowers](./LICENSE.superpowers). See [NOTICE.md](./NOTICE.md) and [upstream-lock.json](./upstream-lock.json) for provenance and exact hashes.
