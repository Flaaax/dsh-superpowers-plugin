import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { validateSkillDocument } from './frontmatter.js';

export const name = 'dsh-superpowers';
export const inject = ['skills', 'systemPrompt'];

const PROVIDER = 'dsh-superpowers';
const SOURCE = 'bundled';
const RANK = 550;
const INVOCATION_DEFAULTS = Object.freeze({ modelInvocable: true, userInvocable: true });
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SKILLS_DIR = join(PACKAGE_ROOT, 'skills');

export const Config = z.object({
  skills: z.boolean().default(true).volatile(),
  bootstrap: z.boolean().default(true).volatile(),
  toolMapping: z.boolean().default(true).volatile(),
  order: z.number().default(50).volatile(),
}).i18n({
  en: {
    $description: 'Configure the Superpowers skill catalog and bootstrap prompt.',
    skills: 'Register the bundled Superpowers skills in the native DSH skill catalog.',
    bootstrap: 'Inject the using-superpowers bootstrap into every model request.',
    toolMapping: 'Append guidance that maps upstream tool names to native DSH tools.',
    order: 'System-prompt section order. Keep it after persona (0) and before tool guidance (1000+).',
  },
  zh: {
    $description: '配置 Superpowers 技能目录与 bootstrap 提示词。',
    skills: '将随包 Superpowers 技能注册到 DSH 原生技能目录。',
    bootstrap: '在每次模型请求中注入 using-superpowers bootstrap。',
    toolMapping: '附加上游工具名称到 DSH 原生工具的映射说明。',
    order: 'System prompt 区段顺序；建议位于 persona（0）之后、工具说明（1000+）之前。',
  },
});

export const TOOL_MAPPING = `## DeepSeek Harness tool mapping

Translate Superpowers action vocabulary to the native DSH tools available in this session:

- Invoke a skill → \`skill\` with the exact bare catalog name. If upstream prose says \`superpowers:<name>\`, call the bare \`<name>\`; for example, call \`skill("brainstorming")\`, never \`skill("superpowers:brainstorming")\`.
- Read / create / edit files → \`read\`, \`write\`, and \`edit\`.
- Find files / search text → \`glob\` and \`grep\`.
- Run PowerShell or commands → \`pwsh\`; use the job controls exposed by the session for background commands.
- Manage todos / longer objectives → \`todo_write\`, or \`create_goal\`, \`get_goal\`, and \`update_goal\` when goal tools are available.
- Dispatch parallel work → \`subagent\` and the subagent controls exposed by the session (commonly \`send_message\`, \`list_agents\`, and \`interrupt_agent\`). DSH has no named subagent types, so put the role and complete instructions in the prompt. Use \`workflow\` only for user-requested large orchestration.
- Ask the human partner → \`ask_user_question\`.
- Create an isolated worktree → prefer native \`create_worktree\` when present; otherwise use \`git worktree\` through \`pwsh\`.

Never invent a tool that is absent from the current session. Use the closest documented fallback instead.`;

function abortError(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? 'operation aborted' : String(signal.reason));
}

function toCandidate(parsed, skillFile, directory) {
  const metadata = { ...parsed.data };
  const isBootstrap = parsed.data.name === 'using-superpowers';
  return {
    name: parsed.data.name,
    description: parsed.data.description,
    ...(typeof parsed.data['when-to-use'] === 'string' ? { whenToUse: parsed.data['when-to-use'] } : {}),
    invocation: {
      // The full bootstrap is already injected into every model request. Keep
      // it user-loadable for inspection, but do not invite a redundant model
      // tool call that wastes context and can recurse into the same rules.
      modelInvocable: isBootstrap ? false : (parsed.data['model-invocable'] ?? true),
      userInvocable: parsed.data['user-invocable'] ?? true,
    },
    source: SOURCE,
    provider: PROVIDER,
    resourceBase: { kind: 'directory', path: directory },
    path: skillFile,
    rank: RANK,
    locator: { path: skillFile, directory },
    metadata,
  };
}

export async function discoverSkills(skillsDir = DEFAULT_SKILLS_DIR, options = {}) {
  abortError(options.signal);
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read Superpowers skills directory ${skillsDir}`, { cause: error });
  }
  const candidates = [];
  const diagnostics = [];
  const names = new Map();
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    abortError(options.signal);
    const directory = join(skillsDir, entry.name);
    const skillFile = join(directory, 'SKILL.md');
    try {
      const parsed = validateSkillDocument(await readFile(skillFile, { encoding: 'utf8', signal: options.signal }), skillFile);
      if (names.has(parsed.data.name)) {
        throw new Error(`${skillFile}: duplicate skill name ${JSON.stringify(parsed.data.name)} (first declared by ${names.get(parsed.data.name)})`);
      }
      names.set(parsed.data.name, skillFile);
      candidates.push(toCandidate(parsed, skillFile, directory));
    } catch (error) {
      abortError(options.signal);
      diagnostics.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return { candidates, diagnostics };
}

function lookupSignal(lifecycleSignal, requestSignal) {
  const signals = [lifecycleSignal, requestSignal].filter(Boolean);
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

export function createSkillProvider({ skillsDir = DEFAULT_SKILLS_DIR, logger = console, lifecycleSignal } = {}) {
  return {
    name: PROVIDER,
    async list(options = {}) {
      const signal = lookupSignal(lifecycleSignal, options.signal);
      const { candidates, diagnostics } = await discoverSkills(skillsDir, { ...options, signal });
      for (const diagnostic of diagnostics) logger.warn(`[${PROVIDER}] ${diagnostic.message}`);
      return candidates;
    },
    async get(candidate, options = {}) {
      const signal = lookupSignal(lifecycleSignal, options.signal);
      abortError(signal);
      const locator = candidate?.locator;
      if (!locator || typeof locator.path !== 'string' || typeof locator.directory !== 'string') {
        throw new TypeError(`[${PROVIDER}] invalid skill locator`);
      }
      let raw;
      try {
        raw = await readFile(locator.path, { encoding: 'utf8', signal });
      } catch (error) {
        abortError(signal);
        if (error?.code === 'ENOENT') return undefined;
        throw new Error(`cannot load Superpowers skill ${locator.path}`, { cause: error });
      }
      const parsed = validateSkillDocument(raw, locator.path);
      if (parsed.data.name !== candidate.name) {
        throw new Error(`${locator.path}: skill name changed from ${JSON.stringify(candidate.name)} to ${JSON.stringify(parsed.data.name)}`);
      }
      return {
        ...toCandidate(parsed, locator.path, locator.directory),
        content: parsed.body,
      };
    },
  };
}

export function buildBootstrap({ skillsDir = DEFAULT_SKILLS_DIR, toolMapping = true } = {}) {
  const bootstrapFile = join(skillsDir, 'using-superpowers', 'SKILL.md');
  const parsed = validateSkillDocument(readFileSync(bootstrapFile, 'utf8'), bootstrapFile);
  return `<EXTREMELY_IMPORTANT>
You have Superpowers.

The using-superpowers skill content below is already loaded for this session. Treat this injection as the completed invocation of using-superpowers and follow it now. NEVER call the skill tool for using-superpowers in this session; begin by applying these rules to select any other relevant skill.

${parsed.body}${toolMapping ? `\n\n${TOOL_MAPPING}` : ''}
</EXTREMELY_IMPORTANT>`;
}

function readField(reference, fallback) {
  if (reference && typeof reference.get === 'function') {
    const value = reference.get();
    return value === undefined ? fallback : value;
  }
  return reference === undefined ? fallback : reference;
}

export function apply(ctx, config = {}) {
  const read = () => ({
    skills: readField(config.skills, true),
    bootstrap: readField(config.bootstrap, true),
    toolMapping: readField(config.toolMapping, true),
    order: readField(config.order, 50),
  });

  ctx.effect(function* () {
    let disposeProvider;
    let disposeSection;

    const refresh = () => {
      const settings = read();
      if (settings.skills && !disposeProvider) {
        disposeProvider = ctx.skills.registerProvider((control) => createSkillProvider({
          logger: ctx.logger,
          lifecycleSignal: control.signal,
        }));
      } else if (!settings.skills && disposeProvider) {
        disposeProvider();
        disposeProvider = undefined;
      }

      if (settings.bootstrap) {
        disposeSection?.();
        disposeSection = undefined;
        try {
          disposeSection = ctx.systemPrompt.section({
            name: 'superpowers:bootstrap',
            order: settings.order,
            text: buildBootstrap({ toolMapping: settings.toolMapping }),
          });
        } catch (error) {
          ctx.logger.warn(`[${PROVIDER}] bootstrap unavailable: ${error.message}`);
        }
      } else if (disposeSection) {
        disposeSection();
        disposeSection = undefined;
      }
    };

    refresh();
    ctx.on('loader/volatile-update', refresh);
    yield () => {
      disposeProvider?.();
      disposeSection?.();
    };
  }, 'dsh-superpowers config');
}

export { DEFAULT_SKILLS_DIR, INVOCATION_DEFAULTS, PROVIDER, RANK, SOURCE };
