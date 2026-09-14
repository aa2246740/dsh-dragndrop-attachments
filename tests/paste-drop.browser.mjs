// Run after build: node tests/paste-drop.browser.mjs (Codex pinned Playwright).
// The real client, React mount cleanup, paste, and drop run against a local RPC stub.
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { launchPinnedChromium } = await import(pathToFileURL(resolve(homedir(), '.codex/playwright-runtime/runtime.mjs')).href);
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser=await launchPinnedChromium();
try {
const page=await browser.newPage();
await page.setContent('<div id="app"></div>');
await page.addScriptTag({path:root+'/node_modules/react/umd/react.development.js'});
await page.addScriptTag({path:root+'/node_modules/react-dom/umd/react-dom.development.js'});
await page.evaluate(()=>{window.__ModuleLoader__={load({factory}) { window.plugin=factory(name=> name==='react'?React:{jsx:(type,props,key)=>React.createElement(type,{...props,key}),jsxs:(type,props,key)=>React.createElement(type,{...props,key}),Fragment:React.Fragment}); }};});
await page.addScriptTag({path:root+'/lib/client.js'});
await page.evaluate(()=>{
window.calls=[]; window.images=[];
let slot, Component;
const record={schemaVersion:'dsh-codex-attachment.v1',attachmentId:'test-id',name:'after-paste.txt',mediaType:'text/plain',kind:'text',bytes:3,preview:'abc',warnings:[],pending:true,status:'READY'};
const connection={rpc:{call:async(channel,endpoint,payload)=>{calls.push(endpoint);return {ok:true,value:endpoint==='attachments/list'?{protocolVersion:3,attachments:[]}:endpoint==='upload/begin'?{uploadId:'u1',chunkBytes:100}:endpoint==='upload/commit'?record:{}};}}};
window.fetch=async(input,init)=>{calls.push('upload/chunk');const rpcId=new Headers(init?.headers).get('x-dsh-rpc-id')??'upload-chunk';return new Response(JSON.stringify({type:'server-response',rpcId,result:{ok:true,value:{receivedBytes:3}}}),{status:200,headers:{'content-type':'application/json'}});};
const ctx={effect(){},inject(){},get(name){return name==='connection'?connection:{createDrafts(_sessionId,files){return files.map((file,i)=>({id:'image'+i}));},releaseDraftAttachments(){}};},slots:{inject(name,fn){fn();},register(options,comp){slot=options;Component=comp;}}};
plugin.apply(ctx);
const props=slot.inject('test-session');
const useInput=selector=>selector({phase:'idle'});
const useConversation=selector=>selector({views:new Map()});
const root=ReactDOM.createRoot(document.getElementById('app'));
let key=0;
function render(){ReactDOM.flushSync(()=>root.render(React.createElement(Component,{...props,key,useInput,useConversation,inputActions:{addAttachments(ids){images.push(...ids);key++;render();return true;}}})));}
render();
window.renderDock=render;
});
await page.waitForSelector('[data-dsh-dragndrop-attachments="ready"]',{state:'attached'});
await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const blob=await new Promise(r=>canvas.toBlob(r));const data=new DataTransfer();data.items.add(new File([blob],'screenshot.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));});
await page.waitForFunction(()=>images.length===1);
await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['abc'],'after-paste.txt',{type:'text/plain'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true}));});
await page.waitForFunction(()=>calls.includes('upload/commit')||document.body.textContent.includes('附件上传已取消'));
const result=await page.evaluate(()=>({text:document.body.textContent,calls,images:images.length}));
console.log(JSON.stringify(result));
assert.ok(result.calls.includes('upload/commit'),'paste image → dock remount → file drop must commit, not cancel');
assert.ok(!result.text.includes('附件上传已取消'));
assert.ok(result.text.includes('after-paste.txt'));

}finally{await browser.close();}
