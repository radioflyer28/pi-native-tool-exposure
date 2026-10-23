import assert from 'node:assert/strict';
import test from 'node:test';
import {parsePolicy, resolveExposure} from '../policy.mjs';
import {installExposureHook, MINIMUM_PI_VERSION, supportsPiVersion} from '../compatibility.mjs';

const entry = (overrides = {}) => ({definition: {name: 'optional'}, sourceInfo: {source: 'npm:@example/tools@1.2.3', path: '/pkg/tools.ts', origin: 'package', ...overrides}});

test('absent policy preserves authored exposure; malformed policy refuses typos and unsafe modes', () => {
  assert.equal(resolveExposure(entry(), 'direct', parsePolicy(undefined)), 'direct');
  for (const value of [null, [], false, {defualt: 'deferred'}, {default: 'model-only'}, {tools: {'': 'direct'}}, {packages: []}]) assert.throws(() => parsePolicy(value));
});

test('tool > extension > exact package source > npm package name > default > authored', () => {
  const rule = {default: 'deferred', packages: {'@example/tools': 'codemode'}};
  assert.equal(resolveExposure(entry(), 'direct', parsePolicy(rule)), 'codemode');
  rule.packages['npm:@example/tools@1.2.3'] = 'direct';
  assert.equal(resolveExposure(entry(), 'direct', parsePolicy(rule)), 'direct');
  rule.extensions = {'/pkg/tools.ts': 'deferred'};
  assert.equal(resolveExposure(entry(), 'direct', parsePolicy(rule)), 'deferred');
  rule.tools = {optional: 'codemode'};
  assert.equal(resolveExposure(entry(), 'direct', parsePolicy(rule)), 'codemode');
  assert.equal(resolveExposure(entry(), 'direct', parsePolicy({default: 'deferred'})), 'deferred');
  assert.equal(resolveExposure(entry(), 'codemode', parsePolicy({})), 'codemode');
});

test('protected exposure, builtins, SDK tools, and MCP are not overridden', () => {
  const policy = parsePolicy({default: 'deferred', tools: {optional: 'direct', mcp__test: 'direct'}});
  for (const authored of ['model-only', 'hidden']) assert.equal(resolveExposure(entry(), authored, policy), authored);
  for (const source of ['builtin', 'sdk']) assert.equal(resolveExposure(entry({source}), 'direct', policy), 'direct');
  assert.equal(resolveExposure({...entry(), definition: {name: 'mcp__test'}}, 'deferred', policy), 'deferred');
  assert.equal(resolveExposure(entry({path: 'builtin:mcp', source: 'something'}), 'codemode', policy), 'codemode');
});

test('exact git/local package identities and loose extension defaults are supported', () => {
  for (const source of ['git:host/project@ref', '/local/pkg']) {
    assert.equal(resolveExposure(entry({source}), 'direct', parsePolicy({packages: {[source]: 'deferred'}})), 'deferred');
  }
  assert.equal(resolveExposure(entry({origin: 'top-level'}), 'direct', parsePolicy({default: 'deferred'})), 'deferred');
});

test('installation is idempotent and conflicting runtime hooks are refused', () => {
  class Host {
    _getToolExposure(name) {return this._toolDefinitions.get(name)?.definition.exposure ?? "direct";}
  }
  installExposureHook(Host, '1.4.0', '/extension.ts');
  const hook = Host.prototype._getToolExposure;
  installExposureHook(Host, '1.4.0', '/extension.ts');
  assert.equal(Host.prototype._getToolExposure, hook);
  Host.prototype._getToolExposure = () => 'hidden';
  assert.throws(() => installExposureHook(Host, '1.4.0', '/extension.ts'), /Another extension replaced/);
});

test('the shipped CLI form without a final semicolon is accepted', () => {
  for (const version of ['1.4.0', '1.4.1', '1.5.0', '2.0.0', '1.4.0+custom']) {
    class BundledHost {
      _getToolExposure(name){return this._toolDefinitions.get(name)?.definition.exposure??"direct"}
    }
    assert.doesNotThrow(() => installExposureHook(BundledHost, version, '/extension.ts'));
  }
});

test('unsupported version or implementation is refused without mutation', () => {
  class Unsupported {_getToolExposure() {return 'direct';}}
  const before = Unsupported.prototype._getToolExposure;
  assert.equal(MINIMUM_PI_VERSION, '1.4.0');
  for (const version of ['1.3.0', '1.3.99', '0.99.0', '1.4.0-rc.1', '2.0.0-rc.1', 'latest', undefined]) {
    assert.equal(supportsPiVersion(version), false);
    assert.throws(() => installExposureHook(Unsupported, version, '/extension.ts'), /requires stable Pi >=1.4.0/);
  }
  for (const version of ['1.4.0', '1.4.1', '1.5.0', '2.0.0']) assert.throws(() => installExposureHook(Unsupported, version, '/extension.ts'), /Unexpected Pi exposure/);
  assert.equal(Unsupported.prototype._getToolExposure, before);
});

test('later version numbers do not bypass per-session capabilities or source checks', () => {
  class Host {_getToolExposure(name) {return this._toolDefinitions.get(name)?.definition.exposure ?? "direct";}}
  installExposureHook(Host, '2.0.0', '/extension.ts'); // Synthetic host, not certification of a future Pi release.
  const host = new Host();
  assert.throws(() => host._getToolExposure('optional'), /registry capability/);
  host._toolDefinitions = new Map([['optional', entry()]]);
  assert.equal(host._getToolExposure('optional'), 'direct');
  host._extensionRunner = {};
  assert.throws(() => host._getToolExposure('optional'), /runner capability/);
  host._extensionRunner = {getExtensionPaths: () => 'bad'};
  assert.throws(() => host._getToolExposure('optional'), /extension paths/);
  host._extensionRunner = {getExtensionPaths: () => ['/unloaded.ts']};
  assert.equal(host._getToolExposure('optional'), 'direct');
  host._extensionRunner = {getExtensionPaths: () => ['/extension.ts']};
  assert.throws(() => host._getToolExposure('optional'), /settings capability/);
  host.settingsManager = {getSettings: () => null};
  assert.throws(() => host._getToolExposure('optional'), /settings shape/);
  host.settingsManager = {getSettings: () => ({nativeToolExposure: {default: 'deferred'}})};
  assert.equal(host._getToolExposure('optional'), 'deferred');
  host._toolDefinitions.set('optional', {definition: {name: 'optional'}, sourceInfo: {source: 'npm:test'}});
  assert.throws(() => host._getToolExposure('optional'), /definition\/source shape/);
});
