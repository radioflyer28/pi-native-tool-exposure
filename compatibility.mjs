import {parsePolicy, resolveExposure} from './policy.mjs';

const key = Symbol.for('maap.pi.native-tool-exposure.prototype.v1');
export const SUPPORTED_PI_VERSIONS = Object.freeze(['1.3.0', '1.4.0']);
// Verified SDK and shipped CLI bundle forms for the supported releases. Reject other bodies.
const expected = new Set([
  '_getToolExposure(name){returnthis._toolDefinitions.get(name)?.definition.exposure??"direct";}',
  '_getToolExposure(name){returnthis._toolDefinitions.get(name)?.definition.exposure??"direct"}',
]);

/** Install once per host process. Unloaded sessions always pass through to Pi. */
export function installExposureHook(AgentSession, version, extensionPath) {
  if (!SUPPORTED_PI_VERSIONS.includes(version)) throw new Error(`Native exposure prototype supports Pi ${SUPPORTED_PI_VERSIONS.join(', ')} only; found ${version}. No hook installed.`);
  const prototype = AgentSession.prototype;
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
    const authored = original.call(this, name);
    const runner = this._extensionRunner;
    if (!runner?.getExtensionPaths().some(path => paths.has(path))) return authored;
    const policy = parsePolicy(this.settingsManager.getSettings().nativeToolExposure);
    return resolveExposure(this._toolDefinitions.get(name), authored, policy);
  }
  // Check everything before altering the prototype. Original tool definitions/handlers are untouched.
  Object.defineProperty(prototype, '_getToolExposure', {...descriptor, value: hook});
  Object.defineProperty(prototype, key, {value: {hook, paths}});
}
