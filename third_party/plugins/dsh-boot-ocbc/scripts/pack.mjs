import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),local=join(root,'.local'),dist=join(local,'dist');
await mkdir(dist,{recursive:true});
const staging=await mkdtemp(join(local,'.pack-'));
const npm=process.platform==='win32'?'npm.cmd':'npm';
const result=spawnSync(npm,['pack','.','--json','--pack-destination',staging,'--cache',join(local,'npm-cache')],{cwd:root,encoding:'utf8',shell:process.platform==='win32'});
if(result.status!==0){await rm(staging,{recursive:true,force:true});process.stderr.write(result.stderr||result.stdout);process.exit(result.status||1)}
const [report]=JSON.parse(result.stdout),manifest=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'));
const actual=report.files.map(f=>f.path).sort(),expected=[...Object.keys(manifest.files),'release-manifest.json'].sort();
if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Packed files differ from verified release allowlist');
await rename(join(staging,report.filename),join(dist,report.filename));
await rm(staging,{recursive:true,force:true});
await writeFile(join(local,'latest-package.json'),JSON.stringify({path:join(dist,report.filename),version:report.version,size:report.size,integrity:report.integrity,files:actual},null,2)+'\n');
console.log(join(dist,report.filename));
