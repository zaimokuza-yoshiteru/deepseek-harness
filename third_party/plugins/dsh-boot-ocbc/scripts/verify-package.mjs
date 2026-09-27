import { sourceFiles } from './source-files.mjs';
import {readFile,readdir,lstat,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(pkg.name!==manifest.name||pkg.version!==manifest.version)throw Error('Release metadata mismatch; rebuild the current source before packing.');
for(const [name,hash] of Object.entries(manifest.files)){
 if(name.startsWith('/')||name.split('/').some(x=>x==='..'||x===''))throw Error('Invalid release path');
 const path=join(root,name);
 if(!(await lstat(path)).isFile())throw Error('Release file must be a regular file: '+name);
 if(createHash('sha256').update(await readFile(path)).digest('hex')!==hash)throw Error('Release file differs from verified build: '+name);
}
const walk=async(dir,prefix='')=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]))).flat();
for(const folder of ['lib','assets'])for(const name of await walk(join(root,folder)))if(!manifest.files[folder+'/'+name])throw Error('Unexpected release file: '+folder+'/'+name);
for(const e of await readdir(root,{withFileTypes:true}))if(!['.local','.git','.gitignore','.DS_Store','node_modules','src','scripts','tests','package-lock.json','tsconfig.json','lib','assets','release-manifest.json',...Object.keys(manifest.files).filter(p=>!p.includes('/'))].includes(e.name)&&!/^dsh-boot-ocbc-[\d.]+\.tgz$/.test(e.name))throw Error('Unexpected package root entry: '+e.name);

let hasSource=false;try{await access(join(root,'src'));hasSource=true}catch{}
if(hasSource){
 const currentSources = await sourceFiles(root);
 if(JSON.stringify(currentSources)!==JSON.stringify(Object.keys(manifest.sources??{}).sort()))throw Error('Source file set changed since build; run npm run build before packing.');
 for(const [name,hash] of Object.entries(manifest.sources??{})){if(createHash('sha256').update(await readFile(join(root,name))).digest('hex')!==hash)throw Error('Source changed since build; run npm run build before packing: '+name)}}
