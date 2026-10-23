import {parsePolicy, resolveExposure} from './policy.mjs';

const key = Symbol.for('maap.pi.native-tool-exposure.prototype.v1');
export const MINIMUM_PI_VERSION = '1.4.0';
export function supportsPiVersion(version) {
  const match = typeof version === 'string' && /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return false; // Stable releases only; prereleases need separate review.
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) && (parts[0] > 1 || (parts[0] === 1 && parts[1] >= 4));
}
// Verified SDK and shipped CLI bundle forms. Version alone never authorizes a hook; reject other bodies.
const expected = new Set([
  '_getToolExposure(name){returnthis._toolDefinitions.get(name)?.definition.exposure??"direct";}',
  '_getToolExposure(name){returnthis._toolDefinitions.get(name)?.definition.exposure??"direct"}',
]);

/** Install once per host process. Unloaded sessions always pass through to Pi. */
export function installExposureHook(AgentSession, version, extensionPath) {
  if (!supportsPiVersion(version)) throw new Error(`Native exposure prototype requires stable Pi >=${MINIMUM_PI_VERSION}; found ${version}. No hook installed.`);
  const prototype = AgentSession?.prototype;
  if (!prototype || (typeof prototype !== 'object' && typeof prototype !== 'function')) throw new Error('Unexpected Pi session capability. No hook installed.');
  const existing = prototype[key];
  if (existing) {
    if (prototype._getToolExposure !== existing.hook) throw new Error('Another extension replaced the exposure hook. Restart Pi before proceeding.');
    existing.paths.add(extensionPath);
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(prototype, '_getToolExposure');
  const original = descriptor?.value;
  if (!Object.isExtensible(prototype) || !descriptor?.writable || typeof original !== 'function' || !expected.has(original.toString().replace(/\s/g, ''))) {
    throw new Error('Unexpected Pi exposure implementation. Refusing to install the compatibility hook.');
  }
  const paths = new Set([extensionPath]);
  function hook(name) {
    if (typeof this._toolDefinitions?.get !== 'function') throw new Error('Unexpected Pi tool registry capability. Refusing exposure policy.');
    const authored = original.call(this, name);
    const runner = this._extensionRunner;
    if (runner == null) return authored;
    if (typeof runner.getExtensionPaths !== 'function') throw new Error('Unexpected Pi extension runner capability. Refusing exposure policy.');
    const loadedPaths = runner.getExtensionPaths();
    if (!Array.isArray(loadedPaths) || loadedPaths.some(path => typeof path !== 'string')) throw new Error('Unexpected Pi extension paths. Refusing exposure policy.');
    if (!loadedPaths.some(path => paths.has(path))) return authored;
    if (typeof this.settingsManager?.getSettings !== 'function') throw new Error('Unexpected Pi settings capability. Refusing exposure policy.');
    const settings = this.settingsManager.getSettings();
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Unexpected Pi settings shape. Refusing exposure policy.');
    const policy = parsePolicy(settings.nativeToolExposure);
    const entry = this._toolDefinitions.get(name);
    if (entry && (!entry.definition || typeof entry.definition.name !== 'string' || !entry.sourceInfo ||
      typeof entry.sourceInfo.source !== 'string' || typeof entry.sourceInfo.path !== 'string' || typeof entry.sourceInfo.origin !== 'string')) {
      throw new Error('Unexpected Pi tool definition/source shape. Refusing exposure policy.');
    }
    return resolveExposure(entry, authored, policy);
  }
  // Check everything before altering the prototype. Original tool definitions/handlers are untouched.
  Object.defineProperty(prototype, '_getToolExposure', {...descriptor, value: hook});
  Object.defineProperty(prototype, key, {value: {hook, paths}});
}
