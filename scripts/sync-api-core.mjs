import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const vision=await readFile(new URL('dist/vision.js',root),'utf8');
const recommendations=await readFile(new URL('dist/recommend.js',root),'utf8');
await writeFile(new URL('api/core/vision.mjs',root),vision);
await writeFile(new URL('api/core/recommend.mjs',root),recommendations.replace("from './vision.js'","from './vision.mjs'"));
console.log('Azure core synchronized from the browser source of truth.');
