import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
const root=process.cwd(),cache=new Map(),nativeRequire=createRequire(import.meta.url);
export function load(relativePath) {
  const path = resolve(root, relativePath);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('module', 'exports', 'require', compiled)(module, module.exports,
    specifier => specifier.startsWith('.') ? load(resolve(dirname(path), `${specifier}.ts`)) : nativeRequire(specifier));
  return module.exports;
}


