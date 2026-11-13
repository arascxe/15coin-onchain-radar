#!/usr/bin/env node
"use strict";
/*
 Public read-only spot OHLCV radar. No exchange credentials, no orders.
 Venue-specific RVOL/HL evidence; CoinGecko rolling 24h volume is NEVER RVOL.
 */
const fs=require("node:fs"),path=require("node:path");
const DIR=path.join(__dirname,"radar_data");fs.mkdirSync(DIR,{recursive:true});
const DATA=[
["ON","orochi-network","0x4620f5c127a6055fbebb1f71327d60ff079c9060","bsc"],
["DOS","dappos","0xcbeaad783ffd2cea125e9d9b2ec21e639d20fa59","bsc"],
["HANA","hana-network","0xd21bc2291c1aef340f5265e257b18aa5dafed759","bsc"],
["COLLECT","collect-on-fanable","0xef470f9ae8512d2762e4f1cd91ae58caea17143afa61b8d56e9b20c8f87688c4","bsc"],
["LIGHT","bitlight","0xae02717e94c9b5bae817601a49b4584f58324015","bsc"],
["APR","apriori",null,"bsc"],
["IN","infinit","0x5bd808ab85c124f99080da5f864edcb39950ede5","bsc"],
["TRUST","intuition","0x52448e17dabcb3b6654045974afd572090bcc1f5","base"],
["B2","bsquared-network","0xc1a780989734a0e5df875cebe410748562e1c5e6","bsc"],
["CYS","cysic","0x9cfea9ef82f26857c3426487774c088330555da6113c61ac7fb8b30d0ae434b3","bsc"],
["STBL","stbl","0x90166b5795250fe7f0831e844121cc91799787e9","bsc"],
["BSB","block-street","0x26a8e4591b7a0efcd45a577ad0d54aa64a99efaf2546ad4d5b0454c99eb70eab","bsc"],
["AIO","olaxbt","0x97620e003c03381eacbde7135f28d94303bb5672","bsc"],
["STAR","starpower","0xb4db9fcda97fd7b02eaf1e8317e6ddb04bacc1af","bsc"],
["LYN","everlyn","0x302642976506d247c7017b85ddc89e3956f96ba1","bsc"]
].map(([symbol,coingecko,pool,chain])=>({symbol,coingecko,pool,chain}));
function save(file,obj){const to=path.join(DIR,file),tmp=to+".tmp";fs.writeFileSync(tmp,JSON.stringify(obj,null,2)+"\n");fs.renameSync(tmp,to)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJSON(url,ms=9000){const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),ms);
try{const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"15Coin-PublicResearchRadar/1.0"},signal:ctl.signal});if(!r.ok)throw Error("HTTP "+r.status);const j=await r.json();return j}finally{clearTimeout(t)}}
const median=arr=>{const s=arr.filter(Number.isFinite).sort((a,b)=>a-b);if(!s.length)return null;const k=s.length>>1;return s.length%2?s[k]:(s[k-1]+s[k])/2};
const round=(x,n=4)=>Number.isFinite(x)?Number(x.toFixed(n)):null;
function candlesGate(arr,intervalSec){if(!Array.isArray(arr)||!arr.length)throw Error("Gate empty candles");const current=Date.now()/1000;return arr.map(a=>{
 if(!Array.isArray(a)||a.length<6)throw Error("Gate candle schema");
 const ts=Number(a[0]),v=Number(a[1]),c=Number(a[2]),h=Number(a[3]),l=Number(a[4]),o=Number(a[5]);
 if(![ts,v,c,h,l,o].every(Number.isFinite)||o<=0||c<=0||h<Math.max(o,c,l)||l>Math.min(o,c,h)||v<0)throw Error("Gate invalid OHLCV");
 return {ts,o,h,l,c,v};}).filter(x=>x.ts+intervalSec<=current-5).sort((a,b)=>a.ts-b.ts).filter((x,i,a)=>!i||x.ts!==a[i-1].ts);
}
function candlesGecko(j,intervalSec){const raw=j?.data?.attributes?.ohlcv_list;if(!Array.isArray(raw)||!raw.length)throw Error("Gecko empty OHLCV");
 const now=Date.now()/1000;return raw.map(a=>{if(!Array.isArray(a)||a.length<6)throw Error("Gecko schema");const [ts,o,h,l,c,v]=a.map(Number);
 if(![ts,o,h,l,c,v].every(Number.isFinite)||o<=0||c<=0||h<Math.max(o,c,l)||l>Math.min(o,c,h)||v<0)throw Error("Gecko invalid OHLCV");return {ts,o,h,l,c,v}
 }).filter(x=>x.ts+intervalSec<=now-5).sort((a,b)=>a.ts-b.ts).filter((x,i,a)=>!i||x.ts!==a[i-1].ts);
}
function computeRVOL(c,intervalSec){if(c.length<97)return {status:"INSUFFICIENT_CANDLES",n:c.length};const latest=c.at(-1);
const past=c.slice(0,-1).filter(x=>x.ts>=latest.ts-7*86400&&x.ts<latest.ts&&latest.ts-x.ts>=intervalSec);
const m=median(past.map(x=>x.v));
const gap=latest.ts-c.at(-2).ts;
if(past.length<96||gap>intervalSec*1.5||!(m>0))return {status:"GAP_OR_BASELINE_INVALID",n:past.length,gap,medianVolumeUSD:round(m)};
return {status:"OK",timestampUtc:new Date(latest.ts*1000).toISOString(),volumeUSD:round(latest.v,2),baselineN:past.length,medianVolumeUSD:round(m,2),rvol:round(latest.v/m,3)}}
function atr14(c){if(c.length<16)return null;const recent=c.slice(-15);let tr=[];for(let i=1;i<recent.length;i++){const a=recent[i],p=recent[i-1];tr.push(Math.max(a.h-a.l,Math.abs(a.h-p.c),Math.abs(a.l-p.c)))}return tr.reduce((x,y)=>x+y,0)/tr.length}
function higherLows(c){if(c.length<22)return {status:"INSUFFICIENT_CANDLES"};const pts=[];
for(let i=1;i<c.length-1;i++)if(c[i].l<c[i-1].l&&c[i].l<c[i+1].l)pts.push({ts:c[i].ts,low:c[i].l});
const last=pts.slice(-2),a=atr14(c);
if(last.length<2||!a)return {status:"NO_CONFIRMED_PIVOTS",pivotN:pts.length};
const delta=last[1].low-last[0].low,eligible=delta>=a*0.25;
return {status:"OK",confirmedHigherLow:eligible,deltaPct:round(100*delta/last[0].low,3),atr14:round(a,9),lastTwoPivots:last.map(x=>({timestampUtc:new Date(x.ts*1000).toISOString(),low:x.low}))}
}
function verdict(r15,r1,hl){const rv15=r15?.status==="OK"?r15.rvol:0,rv1=r1?.status==="OK"?r1.rvol:0,vs=Math.max(rv15,rv1),structure=hl?.confirmedHigherLow===true;
if(vs>=5&&structure)return "SPOT_EARLY_STRONG_REVIEW_ONLY";
if(vs>=3&&structure)return "SPOT_EARLY_WATCH";
if(vs>=3)return "VOLUME_ONLY_NOT_EDGE";
return "NO_VERIFIED_EARLY_SPOT_SIGNAL"}
async function gate(c){const pair=c.symbol+"_USDT",base="https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+encodeURIComponent(pair);
const [a,b]=await Promise.all([getJSON(base+"&interval=15m&limit=690"),getJSON(base+"&interval=1h&limit=240")]);
return {venue:"Gate Spot "+pair,source:"Gate V4 /spot/candlesticks",minute15:candlesGate(a,900),hour1:candlesGate(b,3600),url:"https://www.gate.com/trade/"+pair}}
async function gecko(c){if(!c.pool)throw Error("no verified primary pool");const prefix="https://api.geckoterminal.com/api/v2/networks/"+c.chain+"/pools/"+c.pool+"/ohlcv/";
const [a,b]=await Promise.all([getJSON(prefix+"minute?aggregate=15&limit=690"),getJSON(prefix+"hour?aggregate=1&limit=240")]);
return {venue:"GeckoTerminal pool "+c.pool,source:"GeckoTerminal public DEX spot pool OHLCV",minute15:candlesGecko(a,900),hour1:candlesGecko(b,3600),url:"https://www.geckoterminal.com/"+c.chain+"/pools/"+c.pool}}
async function inspect(c){const failures=[];let series=null;
try{series=await gate(c)}catch(e){failures.push("GATE "+String(e.message).slice(0,150));}
if(!series){try{await sleep(350);series=await gecko(c)}catch(e){failures.push("GECKO "+String(e.message).slice(0,150))}}
if(!series)return {symbol:c.symbol,status:"OHLCV_UNAVAILABLE",failures};
const p15=computeRVOL(series.minute15,900),p1=computeRVOL(series.hour1,3600),hl=higherLows(series.hour1);
const last=series.minute15.at(-1),first=series.minute15.at(-Math.min(5,series.minute15.length)),x=(last&&first&&first.c>0)?round(100*(last.c/first.c-1),3):null;
const verdictResult=verdict(p15,p1,hl);
return {symbol:c.symbol,status:"OHLCV_RECEIVED",venue:series.venue,source:series.source,sourceUrl:series.url,
 measuredAtUtc:new Date().toISOString(),lastCandleUtc:last?new Date(last.ts*1000).toISOString():null,
 priceUSDT:last?.c||null,close1hChangePct:x,bar15mCount:series.minute15.length,bar1hCount:series.hour1.length,
 rvol15m:p15,rvol1h:p1,confirmedHigherLows1h:hl,verdict:verdictResult,failures};
}
async function main(){const out={schema:"15coin-spot-ohlcv-v1",asOfUtc:new Date().toISOString(),meaning:"Public real venue/pool OHLCV RVOL; not futures, not direct evidence of CEX inventory or LP event",coins:[]};for(let i=0;i<DATA.length;i+=4){const part=await Promise.all(DATA.slice(i,i+4).map(inspect));out.coins.push(...part);}
out.status=out.coins.some(x=>x.status==="OHLCV_RECEIVED")?"PARTIAL_OR_COMPLETE":"FAILED_ALL";
out.counts={requested:DATA.length,ohlcvReceived:out.coins.filter(x=>x.status==="OHLCV_RECEIVED").length,validRvol15m:out.coins.filter(x=>x.rvol15m?.status==="OK").length,validRvol1h:out.coins.filter(x=>x.rvol1h?.status==="OK").length,validHigherLows:out.coins.filter(x=>x.confirmedHigherLows1h?.status==="OK").length,earlyWatch:out.coins.filter(x=>/SPOT_EARLY/.test(x.verdict||"")).length};
save("spot_latest.json",out);console.log(JSON.stringify({status:out.status,counts:out.counts,details:out.coins.map(x=>({s:x.symbol,venue:x.venue,status:x.status,r15:x.rvol15m?.rvol,r1:x.rvol1h?.rvol,hl:x.confirmedHigherLows1h?.confirmedHigherLow,verdict:x.verdict,failures:x.failures}))},null,2))}
main().catch(e=>{console.error(e);process.exitCode=1});
