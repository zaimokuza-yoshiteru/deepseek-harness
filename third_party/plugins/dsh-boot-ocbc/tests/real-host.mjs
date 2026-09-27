import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as plugin from '../lib/index.js';
import assert from 'node:assert/strict';
const testDir=dirname(fileURLToPath(import.meta.url));
const harnessRoot=resolve(process.env.DSH_HARNESS_ROOT??resolve(testDir,'../../../../'));
const {Context}=await import(pathToFileURL(resolve(harnessRoot,'vendor/cordis/lib/index.js')).href);
const {default:WebServer}=await import(pathToFileURL(resolve(harnessRoot,'packages/host/webserver/lib/index.js')).href);
const ctx=new Context();
await ctx.plugin(WebServer,{host:'127.0.0.1',port:4321});
let fiber=await ctx.plugin(plugin);
assert.equal(ctx.webServer.collectIndexInjections().length,1);
const base='http://127.0.0.1:4321';
const checks=[];
for(const [path,status,method='GET'] of [
 ['/plugins/dsh-boot-ocbc/lib/boot.js',200],
 ['/plugins/dsh-boot-ocbc/lib/renderer.js',200],
 ['/plugins/dsh-boot-ocbc/assets/glyphs.png',200,'HEAD'],
 ['/plugins/dsh-boot-ocbc/assets/arrival-12.bin',200],
 ['/plugins/dsh-boot-ocbc/package.json',404],
 ['/plugins/dsh-boot-ocbc/assets/%2e%2e%2fpackage.json',404],
 ['/plugins/dsh-boot-ocbc/lib/boot.js',405,'POST']
]){const response=await fetch(base+path,{method});assert.equal(response.status,status,path);await response.arrayBuffer();checks.push({path,method,status});}
await fiber.dispose();
assert.equal(ctx.webServer.collectIndexInjections().length,0);
assert.equal((await fetch(base+'/plugins/dsh-boot-ocbc/lib/boot.js')).status,404);
fiber=await ctx.plugin(plugin);
assert.equal(ctx.webServer.collectIndexInjections().length,1);
assert.equal((await fetch(base+'/plugins/dsh-boot-ocbc/lib/boot.js')).status,200);
const html=`<!doctype html><html><head><meta charset="utf-8"><title>OCBC · 实际插件生命周期验收</title><style>html{--dsh-frame-top-clearance:48px;--dsw-alias-bg-base:#151517}body{margin:0;background:var(--dsw-alias-bg-base);color:#cfecff;font:16px monospace;--dsw-alias-bg-base:#151517;--dsh-frame-top-clearance:48px}.frame{display:grid;grid-template-columns:220px 1fr 0px;position:relative;width:100vw;height:100vh}.main{padding:55px 24px;min-width:0}.sidebar{padding:55px 15px;background:#1e1e22}[data-shell-overlay]{position:absolute;inset:0;pointer-events:none;z-index:20}button,a{padding:12px;color:inherit;background:#263242;border:1px solid #647588}pre{white-space:pre-wrap}</style></head><body><div class="frame"><aside class="sidebar">保留的侧栏<button id="replay" onclick="window.__DSH_BOOT_OCBC__?.replay()">播放动画</button></aside><main class="main"><h1>实际 DSH WebServer 插件验收</h1><p>当前页面加载的是发布目录内的成品。动画关闭后可操作下方按钮。</p><button onclick="location.reload()">重新播放（刷新）</button> <a href="/?failure=1">素材失败测试</a><pre id="status">等待动画</pre></main><aside></aside><div data-shell-overlay></div></div><script>
const status=document.querySelector('#status'),started=performance.now();let first,painted,fade,removed,geometry;
const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
function monitor(){const overlay=document.querySelector('[data-dsh-boot-ocbc]'),stage=document.querySelector('.dsh13-stage');if(overlay&&!first)first=performance.now();if(stage){const r=stage.getBoundingClientRect();geometry={width:r.width,height:r.height,ratio:r.width/r.height,viewport:[innerWidth,innerHeight]};if(!painted&&stage.querySelector('.brand-hud')?.style.opacity&&Number(stage.querySelector('.brand-hud').style.opacity)>0)painted=performance.now()}
if(overlay?.style.opacity==='0'&&!fade)fade=performance.now();if(first&&!overlay&&!removed)removed=performance.now();const report={firstOverlayMs:first&&Math.round(first-started),firstVisibleHudMs:painted&&Math.round(painted-started),fadeMs:fade&&Math.round(fade-started),removedMs:removed&&Math.round(removed-started),geometry,overlayCount:document.querySelectorAll('[data-dsh-boot-ocbc]').length,canvasCount:document.querySelectorAll('canvas').length,errors};status.textContent=JSON.stringify(report,null,2);if(!removed)requestAnimationFrame(monitor)}requestAnimationFrame(monitor);
</script></body></html>`;
ctx.webServer.registerFallback((req,res)=>{
 if(req.url!=='/'&&req.url!=='/?failure=1'&&req.url!=='/?theme=light'){res.writeHead(404);res.end();return}
 let document=ctx.webServer.renderIndex(html);
 if(req.url.includes('theme=light'))document=document.replaceAll('--dsw-alias-bg-base:#151517','--dsw-alias-bg-base:#ffffff');
 if(req.url.includes('failure'))document=document.replace("'/plugins/dsh-boot-ocbc/lib/boot.js'","'/missing/lib/boot.js'");
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(document);
});
console.log(JSON.stringify({url:base,checks,unload:true,reinstall:true}));
process.on('SIGINT',async()=>{await ctx.fiber.dispose();process.exit(0)});
process.on('SIGTERM',async()=>{await ctx.fiber.dispose();process.exit(0)});
