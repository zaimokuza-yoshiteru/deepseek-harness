import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const harnessRoot=resolve(process.env.DSH_HARNESS_ROOT??resolve(fileURLToPath(new URL('../../../../',import.meta.url))));
const {forwardWebRequest}=await import(pathToFileURL(resolve(harnessRoot,'apps/desktop/src/web-document.ts')).href);
const checks=[];
for(const path of ['/lib/boot.js','/lib/renderer.js','/assets/glyphs.png','/assets/frames/native-0096.webp','/assets/arrival-12.bin']){
 const response=await forwardWebRequest(new Request('dsh-app://app/plugins/dsh-boot-ocbc'+path,{headers:{origin:'dsh-app://app'}}),'http://127.0.0.1:4321','test-only=fixture');
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const bytes=(await response.arrayBuffer()).byteLength;assert(bytes>0);checks.push({path,status:response.status,type:response.headers.get('content-type'),bytes});
}
console.log(JSON.stringify({checks:'passed',files:checks.length,nativeElectronTest:false}));
