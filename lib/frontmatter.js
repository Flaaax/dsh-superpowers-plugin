const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

function unquote(value, location) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`${location}: invalid double-quoted scalar`, { cause: error });
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error(`${location}: unterminated single-quoted scalar`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  return value;
}

function blockValue(lines, start, style) {
  let end = start;
  while (end < lines.length && (lines[end].trim() === '' || /^\s+/.test(lines[end]))) end += 1;
  const raw = lines.slice(start, end);
  const nonEmpty = raw.filter((line) => line.trim() !== '');
  const indent = nonEmpty.length === 0
    ? 0
    : Math.min(...nonEmpty.map((line) => line.match(/^\s*/)[0].length));
  const normalized = raw.map((line) => line.trim() === '' ? '' : line.slice(indent));
  let value;
  if (style.startsWith('|')) {
    value = normalized.join('\n');
  } else {
    const paragraphs = [];
    let current = [];
    for (const line of normalized) {
      if (line === '') {
        if (current.length > 0) paragraphs.push(current.join(' '));
        current = [];
        paragraphs.push('');
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) paragraphs.push(current.join(' '));
    value = paragraphs.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  if (style.endsWith('-')) value = value.replace(/\n+$/, '');
  else if (!style.endsWith('+')) value = `${value.replace(/\n+$/, '')}\n`;
  return { value, next: end };
}

export function parseFrontmatter(raw, location = 'SKILL.md') {
  const text = raw.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  if (!text.startsWith('---\n')) throw new Error(`${location}: missing YAML frontmatter`);
  const close = text.indexOf('\n---\n', 4);
  if (close < 0) throw new Error(`${location}: unterminated YAML frontmatter`);
  const header = text.slice(4, close).split('\n');
  const data = {};
  for (let index = 0; index < header.length;) {
    const line = header[index];
    index += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) throw new Error(`${location}: unexpected indentation on frontmatter line ${index}`);
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`${location}: invalid frontmatter line ${index}`);
    const key = line.slice(0, separator).trim();
    if (!KEY.test(key)) throw new Error(`${location}: invalid frontmatter key ${JSON.stringify(key)}`);
    if (Object.hasOwn(data, key)) throw new Error(`${location}: duplicate frontmatter key ${JSON.stringify(key)}`);
    const scalar = line.slice(separator + 1).trim();
    if (/^[|>][+-]?$/.test(scalar)) {
      const block = blockValue(header, index, scalar);
      data[key] = block.value;
      index = block.next;
    } else {
      data[key] = unquote(scalar, `${location}:${index}`);
    }
  }
  return {
    data,
    body: text.slice(close + 5).trim(),
  };
}

export function validateSkillDocument(raw, location = 'SKILL.md') {
  const parsed = parseFrontmatter(raw, location);
  const { name, description } = parsed.data;
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${location}: frontmatter name must be a kebab-case string`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`${location}: frontmatter description must be a non-empty string`);
  }
  if (parsed.body === '') throw new Error(`${location}: skill body is empty`);
  for (const key of ['model-invocable', 'user-invocable']) {
    if (parsed.data[key] !== undefined && typeof parsed.data[key] !== 'boolean') {
      throw new Error(`${location}: ${key} must be true or false`);
    }
  }
  return parsed;
}
