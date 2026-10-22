const modes = new Set(['direct', 'codemode', 'deferred']);
const fields = new Set(['default', 'packages', 'extensions', 'tools']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function mode(value) {
  if (!modes.has(value)) throw new Error('Exposure policy values must be direct, codemode, or deferred.');
  return value;
}

export function parsePolicy(value) {
  if (value === undefined) return undefined;
  object(value, 'nativeToolExposure');
  if (Object.keys(value).some(key => !fields.has(key))) throw new Error('Unknown nativeToolExposure field.');
  const maps = Object.fromEntries(['packages', 'extensions', 'tools'].map(field => [field,
    new Map(Object.entries(value[field] === undefined ? {} : object(value[field], field)).map(([key, value]) => {
      if (!key.trim()) throw new Error('Exposure policy selectors must not be empty.');
      return [key, mode(value)];
    })),
  ]));
  return {...maps, default: value.default === undefined ? undefined : mode(value.default)};
}

// npm selectors may omit a version; git and local sources use Pi's exact source identity.
function packageIdentity(source) {
  return /^npm:((?:@[^/]+\/)?[^@]+)(?:@.*)?$/.exec(source)?.[1];
}

export function resolveExposure(entry, authored, policy) {
  const source = entry?.sourceInfo;
  if (!policy || !source || authored === 'model-only' || authored === 'hidden') return authored;
  if (source.source === 'builtin' || source.source === 'sdk' || source.path.startsWith('builtin:') || entry.definition.name.startsWith('mcp__')) return authored;
  return policy.tools.get(entry.definition.name)
    ?? policy.extensions.get(source.path)
    ?? (source.origin === 'package' ? policy.packages.get(source.source) ?? policy.packages.get(packageIdentity(source.source)) : undefined)
    ?? policy.default
    ?? authored;
}
