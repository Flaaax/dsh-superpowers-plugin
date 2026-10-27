/*
 * 桌面客户端插件：在 DSH「插件」页注册 Superpowers 配置卡。
 *
 * 该文件由 DSH Web 渲染进程通过 `window.__ModuleLoader__.load` 加载，是一个
 * 手写的 CommonJS 工厂（不使用 JSX、不需要构建步骤）。按 DSH 客户端插件规范，
 * 这里只允许 `require('react')`（浏览器基线模块表提供）；不得 require
 * `@deepseek-ai/dsh-client-ui-*` 包。配置的读取与写入全部通过 cordis 服务
 * `ctx.configForms`（settings namespace）与 `ctx.slots`（slot 注册）完成。
 *
 * 与 Host 侧（lib/index.js）的关系：
 * - Host 的 `Config` schema 使 DSH 把本 bundle 的配置暴露为一个 settings
 *   namespace，key 为 bundle 行的 entry id（cordis.patch.yml 的 `id`）。
 * - 本文件把一张配置卡注册进「插件」页的 `plugins.bundle.config` slot
 *   （key 为 npm 包名），由用户在此编辑 `skills` / `bootstrap` /
 *   `toolMapping` / `order` 四项配置。
 */
window.__ModuleLoader__.load({
  id: 'dsh-superpowers-plugin',
  factory: (require) => {
    const React = require('react');
    const { createElement: h, useEffect, useState } = React;

    const name = 'dsh-superpowers';
    const inject = ['configForms', 'slots'];

    // 配置 namespace = bundle 行的 entry id（cordis.patch.yml 的 `id`）。
    const SETTINGS_ENTRY_ID = 'dsh-superpowers';
    // 「插件」页的 plugins.bundle.config slot 以 npm 包名为 key。
    const BUNDLE_PACKAGE = 'dsh-superpowers-plugin';

    // 三个布尔开关，默认都为 true（开启 = 回退到默认值，关闭 = 写入 false）。
    const BOOL_FIELDS = [
      { field: 'skills', title: '注册 Superpowers 技能', hint: '将随包 Superpowers 技能注册到 DSH 原生技能目录。' },
      { field: 'bootstrap', title: '注入 Bootstrap', hint: '在每次模型请求中注入 using-superpowers bootstrap。' },
      { field: 'toolMapping', title: '工具映射', hint: '附加上游工具名称到 DSH 原生工具的映射说明。' },
    ];

    const styles = {
      card: { display: 'flex', flexDirection: 'column', gap: 0 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
      title: { fontWeight: 500 },
      hint: { margin: '4px 0 0', opacity: 0.7, fontSize: 13 },
      divider: { height: 1, margin: '16px 0', background: 'var(--dsw-alias-border-subtle, rgba(127,127,127,.2))' },
      label: { display: 'block', marginBottom: 6, fontWeight: 500 },
      input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 14 },
      footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
      status: { fontSize: 13 },
    };

    // 自绘的开关：原生 checkbox + 文案，避免依赖 primitives 的 Switch 组件。
    function SwitchRow(props) {
      return h(
        'div',
        { style: styles.row },
        h(
          'div',
          null,
          h('div', { style: styles.title }, props.title),
          h('p', { style: styles.hint }, props.hint),
        ),
        h('input', {
          type: 'checkbox',
          role: 'switch',
          'aria-label': props.title,
          checked: props.checked,
          disabled: props.disabled,
          onChange: (event) => props.onChange(event.target.checked),
        }),
      );
    }

    function SettingsCard(props) {
      if (props.view === 'summary') return null;
      const scope = props.scope;

      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);

      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);
      const [failed, setFailed] = useState(false);

      const value = snapshot.value ?? {};
      const ready = snapshot.status === 'ready';
      const writable = snapshot.writable;

      if (!ready) return h('p', { role: 'status' }, '插件设置暂不可用。');

      const skills = draft?.skills ?? (value.skills !== false);
      const bootstrap = draft?.bootstrap ?? (value.bootstrap !== false);
      const toolMapping = draft?.toolMapping ?? (value.toolMapping !== false);
      const orderText = draft?.order ?? (typeof value.order === 'number' ? String(value.order) : '');
      const orderInvalid = draft?.order !== undefined
        && draft.order.trim() !== ''
        && !Number.isFinite(Number(draft.order.trim()));

      const dirty = draft !== null;
      const disabled = !writable || saving;

      const boolValue = (field) => (field === 'skills' ? skills : field === 'bootstrap' ? bootstrap : toolMapping);
      const editBool = (field) => (next) => setDraft((prev) => ({ ...(prev ?? {}), [field]: next }));
      const editOrder = (text) => setDraft((prev) => ({ ...(prev ?? {}), order: text }));

      const save = async () => {
        if (!dirty || orderInvalid || saving || !writable) return;
        setSaving(true);
        setFailed(false);
        try {
          const ops = [];
          for (const f of ['skills', 'bootstrap', 'toolMapping']) {
            const next = draft[f];
            const current = value[f] !== false;
            if (next !== undefined && next !== current) {
              ops.push(next
                ? { op: 'unset', path: [f] }
                : { op: 'set', path: [f], value: false });
            }
          }
          if (draft.order !== undefined) {
            const text = draft.order.trim();
            if (text === '') ops.push({ op: 'unset', path: ['order'] });
            else if (Number.isFinite(Number(text))) ops.push({ op: 'set', path: ['order'], value: Number(text) });
          }
          if (ops.length > 0) {
            const landed = await scope.mutate(ops, snapshot.revision);
            if (!landed) setFailed(true);
          }
        } catch (_error) {
          setFailed(true);
        } finally {
          setSaving(false);
          setDraft(null);
        }
      };

      const discard = () => {
        setDraft(null);
        setFailed(false);
      };

      return h(
        'div',
        { style: styles.card },
        !writable ? h('p', { role: 'status', style: styles.status }, '当前配置为只读。') : null,
        BOOL_FIELDS.map((f, index) => h(
          'div',
          { key: f.field },
          h(SwitchRow, {
            title: f.title,
            hint: f.hint,
            checked: boolValue(f.field),
            disabled,
            onChange: editBool(f.field),
          }),
          index < BOOL_FIELDS.length - 1 ? h('div', { style: styles.divider }) : null,
        )),
        h('div', { style: styles.divider }),
        h(
          'div',
          null,
          h('label', { style: styles.label, htmlFor: 'dsh-superpowers-order' }, 'System Prompt 区段顺序'),
          h('input', {
            id: 'dsh-superpowers-order',
            type: 'text',
            inputMode: 'numeric',
            'aria-invalid': orderInvalid || undefined,
            style: styles.input,
            value: orderText,
            placeholder: '50',
            disabled,
            onChange: (event) => editOrder(event.target.value),
          }),
          h('p', { style: styles.hint }, '建议位于 persona（0）之后、工具说明（1000+）之前，默认 50。'),
          orderInvalid ? h('p', { style: { ...styles.hint, color: 'var(--dsw-alias-text-error, #d93026)' } }, '请输入整数') : null,
        ),
        h(
          'div',
          { style: styles.footer },
          failed ? h('p', { role: 'status', style: styles.status }, '保存失败，请重试。') : null,
          dirty ? h('button', {
            type: 'button',
            disabled,
            onClick: discard,
          }, '取消') : null,
          h('button', {
            type: 'button',
            disabled: !dirty || orderInvalid || saving || !writable,
            onClick: save,
          }, saving ? '正在保存…' : '保存'),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(function* () {
        const scope = ctx.configForms.get(SETTINGS_ENTRY_ID);
        yield ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: BUNDLE_PACKAGE,
            inject: () => ({ scope }),
          },
          SettingsCard,
        ));
      }, 'dsh-superpowers client');
    }

    return { name, inject, apply };
  },
});
