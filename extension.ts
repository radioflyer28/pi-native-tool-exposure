import {fileURLToPath} from 'node:url';
import {AgentSession, VERSION, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {installExposureHook} from './compatibility.mjs';
import {parsePolicy} from './policy.mjs';

export default function nativeToolExposure(pi: ExtensionAPI) {
  installExposureHook(AgentSession, VERSION, fileURLToPath(import.meta.url));
  pi.registerCommand('tool-exposure-policy', {
    description: 'Inspect effective tool exposure and source identities (experimental).',
    handler: async (_args, ctx) => {
      const settings = pi.getSettings();
      const policy = Reflect.get(settings, 'nativeToolExposure');
      parsePolicy(policy);
      const heading = `Experimental native exposure policy: ${JSON.stringify(policy) ?? 'not configured'}`;
      const warning = settings.codemode?.mode === 'only' ? '\nWarning: codemode-only still hides direct exceptions.' : '';
      ctx.ui.notify([heading + warning, ...pi.getAllTools().map(tool => `${tool.name}: ${tool.exposure} — ${tool.sourceInfo.source} — ${tool.sourceInfo.path}`)].join('\n'), 'info');
    },
  });
}
