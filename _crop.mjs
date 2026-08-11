import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const atlas = JSON.parse(readFileSync('public/assets/atlas.json','utf8')).frames;
const scale = Number(process.argv[2]);
const keys = process.argv.slice(3);
const uri = 'data:image/png;base64,' + readFileSync('public/assets/atlas.png').toString('base64');
const parts = keys.map(k=>({k,...atlas[k].frame}));
const html = `<body style="margin:0;background:#2a2340;display:flex;align-items:flex-end;gap:8px;padding:8px">`+
 parts.map(p=>`<div style="width:${p.w*scale}px;height:${p.h*scale}px;background-image:url('${uri}');background-position:${-p.x*scale}px ${-p.y*scale}px;background-size:${2048*scale}px ${2048*scale}px;image-rendering:pixelated"></div>`).join('')+`</body>`;
const b = await chromium.launch({args:['--no-sandbox']});
const W = parts.reduce((a,p)=>a+p.w*scale+8,16), H = Math.max(...parts.map(p=>p.h*scale))+16;
const pg = await b.newPage({viewport:{width:Math.ceil(W),height:Math.ceil(H)}});
await pg.setContent(html);
await pg.screenshot({path:process.env.CROP_OUT || '/tmp/crop.png'});
await b.close();
