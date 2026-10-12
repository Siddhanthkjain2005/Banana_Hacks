import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2'};
// `--api` also serves the Azure Functions handler locally, backed by files in .rethread-data/ (development only).
const api=process.argv.includes('--api')?(()=>{const require=createRequire(import.meta.url);const {createHandler}=require('./api/lib/service.cjs');const {createFileStore}=require('./api/lib/file-store.cjs');return createHandler({storage:createFileStore(path.resolve('.rethread-data'))});})():null;
async function serveApi(req,res){const chunks=[];let size=0;for await(const chunk of req){chunks.push(chunk);size+=chunk.length;if(size>2*1024*1024)break;}const result=await api({method:req.method,url:`http://${req.headers.host||'127.0.0.1'}${req.url}`,headers:req.headers,rawBody:Buffer.concat(chunks)});res.writeHead(result.status,result.headers);res.end(result.body);}
const server=http.createServer(async(req,res)=>{if(api&&/^\/api(?:\/|$)/.test(req.url))return serveApi(req,res).catch(()=>{res.writeHead(503);res.end();});try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!target.startsWith(root+path.sep)&&target!==root)throw new Error('Invalid path');const data=await fs.readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>{console.log('Local: http://127.0.0.1:'+server.address().port);if(api)console.log('Local API: /api/* with file storage in .rethread-data/ (development only; the studio label still says Azure)');});
