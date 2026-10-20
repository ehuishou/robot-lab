import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
const base=(process.argv[2] ?? 'http://121.199.30.133:3001').replace(/\/$/,'');
const localHtml=readFileSync('dist/index.html','utf8');
const build=/name="robot-build-id" content="([^"]+)"/.exec(localHtml)?.[1];
assert.match(build ?? '',/^build-[a-f0-9]{12}-[0-9]+$/);
const mode=/name="robot-test-mode" content="([01])"/.exec(localHtml)?.[0];
assert.ok(mode);
const checks=[];
for(const entry of ['/','/index.html','/preview.html','/?test=0','/?test=1']) {
 const response=await fetch(base+entry),html=await response.text();
 assert.equal(response.status,200);assert.ok(html.includes(build));assert.ok(html.includes(mode));
 checks.push({path:entry,status:response.status,buildId:build});
}
for(const file of readdirSync('dist/assets')) {
 const response=await fetch(base+'/assets/'+file);assert.equal(response.status,200);
 const remote=Buffer.from(await response.arrayBuffer()),local=readFileSync('dist/assets/'+file);
 const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(remote),hash(local));
 checks.push({path:'/assets/'+file,status:response.status,sha256:hash(remote)});
}
mkdirSync('docs/evidence/single-map',{recursive:true});
writeFileSync('docs/evidence/single-map/deployment-http.json',JSON.stringify({checkedAt:new Date().toISOString(),base,checks},null,2));
console.log('PASS five public entry URLs and byte-identical JS/CSS assets',build);
