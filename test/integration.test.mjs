import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const piDir = process.env.PI_EXPOSURE_TEST_PI_DIR;
assert(piDir, 'Set PI_EXPOSURE_TEST_PI_DIR to the installed Pi package directory.');
const sdk = await import(pathToFileURL(path.join(piDir, 'dist/index.js')).href);
const ai = await import(pathToFileURL(path.join(piDir, '../pi-ai/dist/index.js')).href);
const extension = fileURLToPath(new URL('../extension.ts', import.meta.url));
const echoSource = `
const parameters = {type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false};
const outputSchema = {type:'object',properties:{message:{type:'string'}},required:['message']};
export default function(pi) {
  const register = (name, extra = {}) => pi.registerTool({name,label:name,description:'Exposure policy fixture '+name,
    promptSnippet:'Fixture '+name,promptGuidelines:name==='optional_echo'?['OPTIONAL_GUIDELINE_SENTINEL']:[],parameters,outputSchema,
    async execute(_id,args) {return {content:[{type:'text',text:args.message}],details:{},structuredContent:{message:args.message}};},...extra});
  register('optional_echo');
  register('ui_only',{exposure:'model-only'});
  register('withdrawn',{exposure:'hidden'});
  register('catalog_echo',{exposure:'codemode'});
  register('mcp__fixture__echo',{exposure:'codemode'});
  pi.registerCommand('fixture-add-late',{description:'Fixture',handler:async()=>register('late_echo')});
  pi.registerCommand('fixture-replace',{description:'Fixture',handler:async()=>register('optional_echo',{description:'Replaced optional echo'})});
  pi.on('tool_call',event=>{
    if(event.toolName!=='optional_echo')return;
    if(event.input.message==='blocked')return {block:true,reason:'Fixture permission blocked'};
    event.input.message += ' [checked]';
  });
  pi.on('tool_result',event=>{
    if(event.toolName==='optional_echo'&&!event.isError)return {structuredContent:{message:event.structuredContent.message+' [result-hook]'}};
  });
}
`;

function writeJson(file, value) {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}
function packageFixture(root, name, source) {
  const dir = path.join(root,name);
  writeJson(path.join(dir,'package.json'),{name,version:'0.0.0',type:'module',pi:{extensions:['./extension.js']}});
  fs.writeFileSync(path.join(dir,'extension.js'),source);
  return dir;
}

async function fixture(t, extra = {}, loadPolicy = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'pi-exposure-prototype-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const optional = packageFixture(root,'optional-package',echoSource);
  const direct = packageFixture(root,'direct-package',echoSource.replaceAll('optional_echo','direct_echo').replaceAll('OPTIONAL_GUIDELINE_SENTINEL','DIRECT_GUIDELINE_SENTINEL').replace(/  register\('ui_only'.*\n|  register\('withdrawn'.*\n|  register\('catalog_echo'.*\n|  register\('mcp__fixture__echo'.*\n|  pi.registerCommand.*\n/g,''));
  const agentDir=path.join(root,'agent');
  const settingsFile=path.join(agentDir,'settings.json');
  const settings={defaultTools:['+codemode','+tool_search'],codemode:{mode:'on',inlineBudget:0},packages:[optional,direct,...(loadPolicy?[path.dirname(extension)]:[])],nativeToolExposure:{default:'deferred',packages:{[direct]:'direct'}},...extra};
  writeJson(settingsFile,settings);
  const build = async (manager=sdk.SessionManager.inMemory(root))=>{
    const settingsManager=sdk.SettingsManager.create(root,agentDir);
    const loader=new sdk.DefaultResourceLoader({cwd:root,agentDir,settingsManager,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[sdk.createCodemodeExtension(),sdk.createToolSearchExtension()]});
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors,[]);
    const {session}=await sdk.createAgentSession({cwd:root,agentDir,settingsManager,resourceLoader:loader,sessionManager:manager});
    t.after(()=>session.dispose());
    await session.bindExtensions({});
    return {session,loader};
  };
  return {root,agentDir,settingsFile,settings,build,...await build()};
}

const info=(session,name)=>session.getAllTools().find(tool=>tool.name===name);
async function codemode(session, code) {
  const id='fixture-codemode-'+Math.random().toString(16).slice(2);
  session.agent.state.messages.push({role:'assistant',content:[{type:'toolCall',id,name:'codemode',arguments:{}}],timestamp:Date.now()});
  const context={...session.extensionRunner.createContext(),tools:session._getCallableTools(),executeTool:(name,args,options)=>session._executeNestedToolCall(id,name,args,options)};
  const result=await session.getToolDefinition('codemode').execute(id,{code},new AbortController().signal,undefined,context);
  assert(!result.isError,JSON.stringify(result));
  assert(!JSON.stringify(result.content).includes('Script failed'),JSON.stringify(result));
  return result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
}

async function command(session,name) {
  const entry=session.extensionRunner.getCommand(name);
  assert(entry);
  await entry.handler('',session.extensionRunner.createContext());
}

test('real extension loading changes genuine exposure, not just declarations',async t=>{
  const {session}=await fixture(t);
  for(const name of ['read','bash','edit','write','direct_echo']) {
    assert.equal(info(session,name).exposure,'direct',name);
    assert(session.getActiveToolNames().includes(name),name);
  }
  for(const name of ['optional_echo','catalog_echo']) {
    assert.equal(info(session,name).exposure,'deferred',name);
    assert(!session.getActiveToolNames().includes(name),name);
    assert(session.getCallableToolNames().includes(name),name);
  }
  assert.equal(session.getToolDefinition('optional_echo').exposure,undefined,'Original author definition is not mutated');
  assert.equal(info(session,'ui_only').exposure,'model-only');
  assert(!session.getCallableToolNames().includes('ui_only'));
  assert.equal(info(session,'withdrawn').exposure,'hidden');
  assert(!session.getCallableToolNames().includes('withdrawn'));
  assert.equal(info(session,'mcp__fixture__echo').exposure,'codemode');
  const prepared=await session._prepareRun({prompt:'fixture',messageType:'user',images:[]});
  assert(prepared.length);
  // Capture a real agent-loop request using Pi's local faux stream: no credentials or remote inference.
  const faux=ai.createFauxCore({provider:'exposure-fixture',models:[{id:'fixture'}]});
  faux.setResponses([ai.fauxAssistantMessage('OK')]);
  session.agent.state.model=faux.getModel();
  let request;
  session.agent.getApiKey=()=>undefined;
  session.agent.streamFunction=(model,context,options)=>{request=structuredClone(context);return faux.streamSimple(model,context,options);};
  await session.agent.prompt(prepared);
  assert.equal(faux.state.callCount,1);
  const declarations=ai.getCurrentSystemMessage(request.messages).toolsAdded.map(tool=>tool.name);
  assert(!declarations.includes('optional_echo'));
  assert(declarations.includes('direct_echo'));
  assert(!session.systemPrompt.includes('OPTIONAL_GUIDELINE_SENTINEL'));
  assert(session.systemPrompt.includes('DIRECT_GUIDELINE_SENTINEL'));
  assert(!session.agent.state.tools.find(t=>t.name==='codemode').description.includes('### `optional_echo`'));
  const output=await codemode(session,'const found=await searchTools("optional_echo",{limit:3}); const detail=await describeTool("optional_echo"); text({found:found.some(t=>t.name==="optional_echo"),described:detail.includes("optional_echo")}); text(await tools.optional_echo({message:"hello"}));');
  assert.match(output,/"found"\s*:\s*true/);
  assert.match(output,/"described"\s*:\s*true/);
  assert(output.includes('hello [checked] [result-hook]'),output);
  const blocked=await codemode(session,'try { await tools.optional_echo({message:"blocked"}); throw new Error("Unexpected success"); } catch(error) {text(String(error));}');
  assert(blocked.includes('Fixture permission blocked'),blocked);
  const invalid=await codemode(session,'try { await tools.optional_echo({}); throw new Error("Unexpected success"); } catch(error) {text(String(error));}');
  assert(!invalid.includes('Unexpected success'),invalid);
});

test('tool_search activation survives registration refresh and reload; late tools stay deferred',async t=>{
  const {session}=await fixture(t);
  const result=await session.getToolDefinition('tool_search').execute('fixture-search',{query:'optional_echo',limit:1});
  assert(result.details.loaded.includes('optional_echo'),JSON.stringify(result));
  assert(session.getActiveToolNames().includes('optional_echo'));
  const handler=session.getToolDefinition('optional_echo').execute;
  await command(session,'fixture-add-late');
  assert.equal(info(session,'late_echo').exposure,'deferred');
  assert(!session.getActiveToolNames().includes('late_echo'));
  assert(session.getCallableToolNames().includes('late_echo'));
  assert.equal(session.getToolDefinition('optional_echo').execute,handler);
  await command(session,'fixture-replace');
  assert.equal(info(session,'optional_echo').exposure,'deferred');
  assert.equal(session.getToolDefinition('optional_echo').description,'Replaced optional echo');
  assert(session.getActiveToolNames().includes('optional_echo'));
  await session.reload();
  assert.equal(info(session,'optional_echo').exposure,'deferred');
  assert(session.getActiveToolNames().includes('optional_echo'));
  assert(!session.getActiveToolNames().includes('catalog_echo'));
  await command(session,'fixture-add-late');
  assert.equal(info(session,'late_echo').exposure,'deferred');
});

test('restored activation remains explicit, without activating every deferred package tool',async t=>{
  const {session,root,build}=await fixture(t);
  // Use the actual transcript restore path, with a persisted system declaration of a discovered tool.
  const manager=sdk.SessionManager.create(root,path.join(root,'sessions'));
  manager.appendMessage({role:'system',content:'Restored fixture',toolsAdded:[{name:'optional_echo',description:'Fixture',parameters:session.getToolDefinition('optional_echo').parameters}],timestamp:Date.now()});
  manager.appendMessage({role:'user',content:'fixture',timestamp:Date.now()});
  const reopened=sdk.SessionManager.open(manager.getSessionFile());
  const {session:restored}=await build(reopened);
  assert.equal(info(restored,'optional_echo').exposure,'deferred');
  assert(restored.getActiveToolNames().includes('optional_echo'));
  assert(!restored.getActiveToolNames().includes('catalog_echo'));
});

test('sessions without the package ignore its settings even when the process hook exists',async t=>{
  const {session}=await fixture(t,{},false);
  assert.equal(info(session,'optional_echo').exposure,'direct');
  assert(session.getActiveToolNames().includes('optional_echo'));
});

test('policy disable and package removal on reload return to authored behavior',async t=>{
  const f=await fixture(t);
  const config={...f.settings};delete config.nativeToolExposure;
  writeJson(f.settingsFile,config);
  await f.session.reload();
  assert.equal(info(f.session,'optional_echo').exposure,'direct');
  assert(f.session.getActiveToolNames().includes('optional_echo'));
  // Removing the extension also makes the process-lifetime compatibility hook inert.
  writeJson(f.settingsFile,{...f.settings,packages:f.settings.packages.filter(pkg=>pkg!==path.dirname(extension))});
  await f.session.reload();
  assert.equal(info(f.session,'optional_echo').exposure,'direct');
});
