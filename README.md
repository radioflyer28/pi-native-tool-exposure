# Native tool exposure — isolated package prototype

**Experimental, Pi 1.3.0 only. This standalone package is not installed or enabled automatically.** This is a package-delivered **private runtime patch**, not a supported exposure-policy extension API. It changes an in-memory method; it does not edit Pi's installed files.

## Result

The package approach is viable on the tested release. Pi's actual resource loader loads this directory as a local package, and its extension imports the same `AgentSession` class used by the host. A narrowly scoped replacement of `_getToolExposure()` supplies effective exposure to registration/activation, native tool search, codemode discovery, callability, and loadout preparation.

Tests use temporary agent directories, local fixture packages, and Pi's local faux stream. They do not use live settings, credentials, remote inference, process/debugger packages, or their installed patches. An actual agent-loop request captured at the faux stream contains the direct-exception schema and omits the deferred schema. This is not a provider token measurement.

## Proposed configuration

This is **prototype-specific syntax**, not a currently supported core Pi setting. Loading the package without `nativeToolExposure` leaves authored exposures unchanged.

```json
{
  "defaultTools": ["+codemode", "+tool_search"],
  "codemode": {"mode": "on", "inlineBudget": 0},
  "nativeToolExposure": {
    "default": "deferred",
    "packages": {
      "pi-multiedit": "direct"
    }
  }
}
```

The example leaves ordinary built-ins direct and makes native extension tools deferred by default. The multiedit exception is relevant to our setup because that package replaces `read`/`edit`. Process and debugger need no individual rules under this default. **No live configuration has been changed to this example.**

Rules may select `direct`, `codemode`, or `deferred`. Precedence:

1. `tools`: exact tool name.
2. `extensions`: exact absolute source-file path reported by Pi.
3. `packages`: exact Pi source string; alternatively a bare npm package name without its version (for example `@aliou/pi-processes`). Exact source strings win over bare npm names.
4. `default`.
5. Author's exposure when no rule matches.

Git/local package selectors currently require the **exact** source string shown by inspection. Ref-independent git identity normalization is not implemented. Ordinary loose extensions also receive the global default. Built-in sources, synthetic SDK custom tools, MCP-named tools, authored `hidden` tools, and authored `model-only` tools are excluded from overrides. Creating `hidden`/`model-only` exposure via policy is intentionally out of scope.

Trusted-project/global settings merge through Pi's existing settings manager. The package doesn't write settings. Unknown policy fields, malformed maps, and unsupported exposure values are rejected rather than silently ignored.

`/tool-exposure-policy` displays the configured policy, effective exposure, source identity, and source file. It warns if codemode-only is enabled. It registers no model tool, skill advertisement, or extra prompt guidance.

## Important activation semantics

Exposure is **not** a hard visibility or security restriction. `tool_search`, an explicit tool selection, or another extension can activate deferred tools. An activated deferred tool is directly declared thereafter; it remains script-callable even when inactive.

Reload/resume deliberately preserve Pi's existing active-tool state. Adding a deferred default to an already tool-rich session does **not** retrospectively clear its declarations. Start a fresh session to realize the initial-context reduction. Changing policy from deferred to direct on reload activates tools according to Pi's existing registration rules. Disabling/removing this package restores authored exposure; core activation semantics may retain explicitly active tools.

`codemode.mode: "only"` remains an independent presentation layer and can hide direct exceptions. Use `"on"` for direct built-ins plus deferred packages. The prototype does not override that setting or `defaultTools`.

## Compatibility mechanism and risks

- Exact Pi version gate (`1.3.0`) plus a check of the original exposure method's normalized source and writable/extensible prototype, before mutation. Both verified SDK and shipped CLI bundle forms are accepted: the bundle omits a final semicolon. Other method bodies remain rejected.
- One process-lifetime hook, installed idempotently. It applies only to sessions whose current extension runner includes this package's entry file. Removing the package on reload makes the hook inert; restarting removes the in-memory patch entirely.
- Reads each session's own merged policy, so settings do not leak to sessions lacking the package.
- Leaves the tool registry, author definitions, handlers, renderers, schemas, and permission/result hooks untouched. `getToolDefinition()` still returns the authored definition; `getAllTools()` reports effective exposure.
- Depends on `_getToolExposure`, `_toolDefinitions`, and `_extensionRunner`/`getExtensionPaths`. These are private runtime integration points. The source/version guard does not make them public or promise compatibility with another build/version.
- Existing conflicting exposure hooks are refused when installing/reloading. A different extension can still replace our hook afterward; there is no general monkey-patch arbitration protocol.
- Unsupported builds produce an extension-loading error, not a guarantee that Pi itself exits. Do not assume the policy is active if loading reports an error.

Not yet production-hardened: CLI RPC startup (including `--continue`) is covered, but not interactive TUI/full RPC conversations, a session switching/forking/branch-navigation matrix, live process notification/debugger workflows, other extension compatibility matrix, or performance profiling. Policy parsing currently favors simplicity over caching. Third-party extensions that independently activate tools or read authored definitions may bypass the desired *presentation default*. No npm publication or automatic upgrade mechanism is configured.

## Reproduce offline

Unit tests (no installed Pi needed):

```bash
cd ~/code/pi-native-tool-exposure
npm test
```

Full suite against the installed release, from the repository root:

```bash
PI_OFFLINE=1 \
PI_EXPOSURE_TEST_PI_DIR=/absolute/path/to/@earendil-works/pi-coding-agent \
  node --test test/*.test.mjs
```

The integration suite also imports the host's adjacent `pi-ai` package. It creates/removes temporary fixture directories, loads this package through its `package.json` manifest, and exercises the real SDK/resource loader. Some tests use private test helpers to prepare a run and supply an in-memory assistant issuer for codemode. The faux-stream capture exercises the real agent-loop declaration projection without a network request.

Verified on the installed Pi 1.3.0: **13 tests pass** (7 unit, 6 integration), including actual shipped-CLI startup and its effective builtin/extension exposures. The initial SDK-only suite missed a bundled-CLI source-format difference; the CLI regression now exercises that path. Coverage includes precedence/identity matching, protected exposures, builtin/direct-package exceptions, native and codemode discovery, deferred omission from initial schemas/guidelines, structured results, argument validation, permission denial, result hooks, late registration, re-registration, reload, persisted transcript resume, package removal, policy disable, session scoping, idempotence, and unsupported/conflicting-hook refusal.

## Next decision

This proves package delivery can provide the requested initial-exposure behavior on Pi 1.3.0; an on-disk core patch is **not currently necessary** for that tested behavior. Before installing it, review the private-hook tradeoff and harden the remaining lifecycle/compatibility cases. Any live trial, settings changes, npm publication, or fallback installation patch requires separate approval.
