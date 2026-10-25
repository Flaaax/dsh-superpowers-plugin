import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkillDocument } from './frontmatter.js';

export const name = 'dsh-superpowers';
export const inject = ['skills', 'systemPrompt'];

const PROVIDER = 'dsh-superpowers';
const SOURCE = 'bundled';
const RANK = 550;
const INVOCATION_DEFAULTS = Object.freeze({ modelInvocable: true, userInvocable: true });
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SKILLS_DIR = join(PACKAGE_ROOT, 'skills');

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

export function apply(ctx, config = {}) {
  const settings = {
    skills: config.skills ?? true,
    bootstrap: config.bootstrap ?? true,
    toolMapping: config.toolMapping ?? true,
    order: config.order ?? 50,
  };
  for (const key of ['skills', 'bootstrap', 'toolMapping']) {
    if (typeof settings[key] !== 'boolean') throw new TypeError(`dsh-superpowers config.${key} must be a boolean`);
  }
  if (!Number.isFinite(settings.order)) throw new TypeError('dsh-superpowers config.order must be a finite number');
  if (settings.skills) {
    ctx.skills.registerProvider((control) => createSkillProvider({
      logger: ctx.logger,
      lifecycleSignal: control.signal,
    }));
  }
  if (settings.bootstrap) {
    try {
      ctx.systemPrompt.section({
        name: 'superpowers:bootstrap',
        order: settings.order,
        text: buildBootstrap({ toolMapping: settings.toolMapping }),
      });
    } catch (error) {
      ctx.logger.warn(`[${PROVIDER}] bootstrap unavailable: ${error.message}`);
    }
  }
}

export { DEFAULT_SKILLS_DIR, INVOCATION_DEFAULTS, PROVIDER, RANK, SOURCE };
