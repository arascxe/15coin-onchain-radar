#!/usr/bin/env node
"use strict";
/* Fifteen-token read-only Binance Alpha spot collector.
   Only chain+contract+symbol matches are allowed. No trade execution.
   Thresholds produce research alerts, NOT validated 5x/10x predictions. */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const ROOT=path.join(__dirname,"radar_data");
const SYMBOLS=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
const BASE="https://www.binance.com/bapi/defi/v1/public/";
const END={tokens:"wallet-direct/buw/wallet/cex/alpha/all/token/list",info:"alpha-trade/get-exchange-info",klines:"alpha-trade/klines",depth:"alpha-trade/fullDepth"};
const num=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const addr=x=>/^0x[0-9a-f]{40}$/i.test(String(x||""));
const median=a=>{if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2};
const round=(v,k=3)=>Number.isFinite(v)?Number(v.toFixed(k)):null;
function watched(latest){
 if(!Array.isArray(latest?.coins)||latest.coins.length!==15||new Set(latest.coins.map(x=>x.symbol)).size!==15||SYMBOLS.some(s=>!latest.coins.some(x=>x.symbol===s)))throw Error("EXPECTED_EXACT_15");
 return SYMBOLS.map(symbol=>{const x=latest.coins.find(c=>c.symbol===symbol);return {symbol,chain:x.chain,chainId:{bsc:"56",base:"8453"}[x.chain]||null,contract:addr(x.token)?x.token.toLowerCase():null}});
}
function match(items,list){
 const data=Array.isArray(list?.data)?list.data:[];
 return items.map(c=>{
  if(!c.chainId||!c.contract)return {...c,status:"CONTRACT_UNKNOWN"};
  const matches=data.filter(t=>String(t.chainId)===c.chainId&&String(t.contractAddress||"").toLowerCase()===c.contract&&String(t.symbol||"").toUpperCase()===c.symbol&&t.offline!==true);
  if(matches.length!==1)return {...c,status:matches.length?"AMBIGUOUS_TOKEN_ID":"NOT_IN_ALPHA_TOKEN_LIST"};
  const id=String(matches[0].alphaId||"");
  if(!/^ALPHA_[0-9]+$/.test(id))return {...c,status:"ALPHA_ID_UNVERIFIED"};
  return {...c,status:"MATCHED",alphaId:id,alphaPair:id+"USDT",priceChange24hPct:num(matches[0].percentChange24h)};
 });
}
function bars(payload,ms,now){
 const out=new Map();
 for(const x of Array.isArray(payload?.data)?payload.data:[]){
  if(!Array.isArray(x)||x.length<11)continue;
  const z=[x[0],x[1],x[2],x[3],x[4],x[5],x[6],x[7],x[8],x[9],x[10]].map(num);
  if(z.some(v=>v===null))continue;
  const [t,op,hi,lo,close,baseVol,end,quote,trades,takerBase,buy]=z;
  if(!Number.isSafeInteger(t)||t%ms!==0||!Number.isSafeInteger(end)||end<t+ms-1000||end>now-2000)continue;
  if(!(op>0&&close>0&&hi>=Math.max(op,close)&&lo<=Math.min(op,close)&&baseVol>=0&&quote>=0&&trades>=0&&buy>=0&&buy<=quote*1.0001))continue;
  out.set(t,{t,end,open:op,close,quote,buy,trades});
 }
 return [...out.values()].sort((a,b)=>a.t-b.t);
}
function contiguous(all,ms){const out=[];for(let i=all.length-1;i>=0;i--){if(out.length&&out[0].t-all[i].t!==ms)break;out.unshift(all[i])}return out}
function fiveMinute(all,now){
 const c=contiguous(all,60000),last=c.at(-1);
 if(!last||now-last.end>180000||c.length<66)return {status:"INSUFFICIENT_1M",bars:c.length};
 const recent=c.slice(-5),volume=recent.reduce((a,x)=>a+x.quote,0),buy=recent.reduce((a,x)=>a+x.buy,0),ref=[];
 for(let offset=10;offset<=65;offset+=5){const g=c.slice(-offset,-offset+5);if(g.length===5)ref.push(g.reduce((a,x)=>a+x.quote,0))}
 const base=median(ref);
 if(!(base>0)||ref.length<10)return {status:"BASELINE_MISSING"};
 return {status:"VALID",windowEndUtc:new Date(last.end).toISOString(),volume5mUSD:round(volume,2),buy5mUSD:round(buy,2),sell5mUSD:round(volume-buy,2),netBuy5mUSD:round(2*buy-volume,2),buyShare:round(volume?buy/volume:0,4),rvol5m:round(volume/base,3),baseSamples:ref.length,price1hPct:round(100*(last.close/c.at(-61).close-1),2),price:last.close};
}
function fifteenMinute(all,now){
 const c=contiguous(all,900000),last=c.at(-1);
 if(!last||now-last.end>22*60000||c.length<98)return {status:"INSUFFICIENT_15M",bars:c.length};
 const base=median(c.slice(-97,-1).map(x=>x.quote));
 if(!(base>0))return {status:"BASELINE_MISSING"};
 return {status:"VALID",windowEndUtc:new Date(last.end).toISOString(),volume15mUSD:round(last.quote,2),buyShare:round(last.quote?last.buy/last.quote:0,4),rvol15m:round(last.quote/base,3),price:last.close};
}
function bookData(payload,now){
 const d=payload?.data,t=num(d?.T)??num(d?.E);
 if(!t||!Array.isArray(d?.bids)||!Array.isArray(d?.asks)||Math.abs(now-t)>180000)return {status:"BOOK_UNAVAILABLE"};
 const bids=d.bids.map(x=>[num(x[0]),num(x[1])]).filter(x=>x.every(z=>z!==null&&z>0));
 const asks=d.asks.map(x=>[num(x[0]),num(x[1])]).filter(x=>x.every(z=>z!==null&&z>0));
 if(!bids.length||!asks.length)return {status:"BOOK_UNAVAILABLE"};
 const bid=Math.max(...bids.map(x=>x[0])),ask=Math.min(...asks.map(x=>x[0]));
 if(!(ask>bid))return {status:"BOOK_CROSSED"};
 const mid=(bid+ask)/2,depth=asks.filter(x=>x[0]<=mid*1.02).reduce((a,x)=>a+x[0]*x[1],0);
 return {status:"BOOK_SNAPSHOT_ONLY",asOfUtc:new Date(t).toISOString(),spreadPct:round(100*(ask-bid)/mid,3),askDepth2PctUSD:Math.max(...asks.map(x=>x[0]))>=mid*1.02?round(depth,2):null};
}
function detect(f,q,dayPct){
 if(f.status!=="VALID"||q.status!=="VALID")return false;
 if(dayPct!==null&&dayPct>85)return false;
 return f.volume5mUSD>=3000&&f.rvol5m>=3&&f.buyShare>=.63&&f.netBuy5mUSD>=1500&&f.price1hPct>-3&&f.price1hPct<20&&q.rvol15m>=1.4&&q.buyShare>=.56;
}
async function request(route,query={},fetchFn=fetch){
 const url=BASE+route+(Object.keys(query).length?"?"+new URLSearchParams(query):"");
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),9000);
 try{const r=await fetchFn(url,{headers:{accept:"application/json"},signal:c.signal});if(!r.ok)throw Error("HTTP_"+r.status);const x=await r.json();if(x?.code!=="000000"||x.success===false)throw Error("API_CODE_"+String(x?.code));return x}
 finally{clearTimeout(timer)}
}
async function limited(items,n,fn){
 const out=Array(items.length);let i=0;
 await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;try{out[k]=await fn(items[k])}catch(e){out[k]={...items[k],status:"REQUEST_FAILED",error:String(e.message).slice(0,140)}}}}));
 return out;
}
async function collect(latest,options={}){
 const now=options.now||Date.now(),fetchFn=options.fetchFn||fetch,items=watched(latest);
 let tokenList;
 try{tokenList=await request(END.tokens,{},fetchFn)}catch(e){return {schema:"15coin-alpha-spot-v1",asOfUtc:new Date(now).toISOString(),status:"SOURCE_UNAVAILABLE",counts:{requested:15,matched:0,usable:0,review:0},rows:items.map(x=>({...x,status:"TOKEN_LIST_UNAVAILABLE"})),newAlerts:[],sourceError:String(e.message).slice(0,140)}}
 const matches=match(items,tokenList);
 let pairs=null;
 try{const inf=await request(END.info,{},fetchFn);pairs=Array.isArray(inf.data?.symbols)?new Map(inf.data.symbols.map(x=>[x.symbol,x.status])):null}catch{}
 const rows=await limited(matches,4,async m=>{
  if(m.status!=="MATCHED")return m;
  if(pairs&&pairs.get(m.alphaPair)!=="TRADING")return {...m,status:"PAIR_NOT_TRADING"};
  const [one,fifteen]=await Promise.all([request(END.klines,{symbol:m.alphaPair,interval:"1m",limit:95},fetchFn),request(END.klines,{symbol:m.alphaPair,interval:"15m",limit:110},fetchFn)]);
  const f=fiveMinute(bars(one,60000,now),now),q=fifteenMinute(bars(fifteen,900000,now),now),hit=detect(f,q,m.priceChange24hPct);
  let book={status:"BOOK_NOT_CHECKED"};
  if(hit){try{book=bookData(await request(END.depth,{symbol:m.alphaPair,limit:100},fetchFn),now)}catch{book={status:"BOOK_REQUEST_FAILED"}}}
  const label=hit?(book.status==="BOOK_SNAPSHOT_ONLY"&&book.spreadPct<=1&&book.askDepth2PctUSD!==null?"ALPHA_EARLY_SPOT_REVIEW":"ALPHA_EARLY_SPOT_REVIEW_BOOK_UNKNOWN"):"NO_VERIFIED_ALPHA_IGNITION";
  return {...m,status:"OBSERVED",five:f,fifteen:q,book,decision:label,signalWindowEndUtc:hit?f.windowEndUtc:null};
 });
 const usable=rows.filter(x=>x.five?.status==="VALID"&&x.fifteen?.status==="VALID").length;
 return {schema:"15coin-alpha-spot-v1",asOfUtc:new Date(now).toISOString(),status:usable?"PARTIAL_OR_COMPLETE":"NO_VERIFIED_ALPHA_MARKET_DATA",counts:{requested:15,matched:matches.filter(x=>x.status==="MATCHED").length,usable,review:rows.filter(x=>x.signalWindowEndUtc).length},rows,newAlerts:[],caveats:["Alpha spot review is not a forecast of 5x/10x","Unobserved market is UNKNOWN, not no buying","One orderbook snapshot is not historical liquidity withdrawal","Symbols must match chain, contract and ticker"]};
}
function applyHistory(report,old){
 const history=old?.schema==="15coin-alpha-event-history-v1"&&Array.isArray(old.events)?old:{schema:"15coin-alpha-event-history-v1",events:[]};
 const created=[];
 for(const r of report.rows){
  if(!r.signalWindowEndUtc)continue;
  const t=Date.parse(r.signalWindowEndUtc),prev=[...history.events].reverse().find(x=>x.symbol===r.symbol);
  if(prev&&t-Date.parse(prev.lastSeenUtc)<120*60000){prev.lastSeenUtc=r.signalWindowEndUtc;continue}
  const e={symbol:r.symbol,firstSeenUtc:r.signalWindowEndUtc,lastSeenUtc:r.signalWindowEndUtc,alphaPair:r.alphaPair,decision:r.decision,priceAtSignal:r.five?.price,volume5mUSD:r.five?.volume5mUSD,buyShare:r.five?.buyShare,netBuyUSD:r.five?.netBuy5mUSD,rvol5m:r.five?.rvol5m,rvol15m:r.fifteen?.rvol15m,book:r.book,source:"Binance Alpha public klines"};
  history.events.push(e);created.push(e);
 }
 history.events=history.events.slice(-700);report.newAlerts=created;report.newAlertCount=created.length;
 return history;
}
function write(name,j){const filename=path.join(ROOT,name),tmp=filename+".tmp";fs.writeFileSync(tmp,JSON.stringify(j,null,2)+"\n");fs.renameSync(tmp,filename)}
function selfTest(){
 const sym=SYMBOLS.map((symbol,i)=>({symbol,chain:i===7?"base":"bsc",token:"0x"+(i+1).toString(16).padStart(40,"0")}));
 const w=watched({coins:sym});assert.equal(w.length,15);assert.equal(w.find(x=>x.symbol==="TRUST").chainId,"8453");
 const a=match(w,{data:[{symbol:"ON",chainId:"56",contractAddress:w[0].contract,alphaId:"ALPHA_175"}]});assert.equal(a[0].alphaPair,"ALPHA_175USDT");assert.equal(a[1].status,"NOT_IN_ALPHA_TOKEN_LIST");
 const now=Date.UTC(2026,10,16,2,31,20);
 function candles(ms,n,buying){const latest=Math.floor(now/ms)*ms-ms;return {data:Array.from({length:n},(_,i)=>{const t=latest-(n-1-i)*ms,hot=i>=n-(ms===60000?5:1),q=hot?30000:1000;return [t,"1","1","1","1","100",t+ms-1,String(q),"5","80",String(q*(buying?.85:.4)),"0"]})}}
 const f=fiveMinute(bars(candles(60000,90,true),60000,now),now),q=fifteenMinute(bars(candles(900000,108,true),900000,now),now);
 assert.equal(f.status,"VALID");assert.equal(q.status,"VALID");assert(detect(f,q,0));assert(!detect(f,q,100));
 assert.equal(f.netBuy5mUSD,105000);assert(!detect({...f,buyShare:.4},q,0));assert(!detect({...f,status:"INSUFFICIENT_1M"},q,0));
 const r={rows:[{symbol:"ON",decision:"ALPHA_EARLY_SPOT_REVIEW",signalWindowEndUtc:f.windowEndUtc,five:f,fifteen:q,book:{status:"BOOK_REQUEST_FAILED"},alphaPair:"ALPHA_175USDT"}]};
 const h=applyHistory(r,null);assert.equal(r.newAlerts.length,1);const r2={rows:[{...r.rows[0]}]};applyHistory(r2,h);assert.equal(r2.newAlerts.length,0);
 assert.equal(match(w,{data:[{symbol:"ON",chainId:"8453",contractAddress:w[0].contract,alphaId:"ALPHA_175"}]})[0].status,"NOT_IN_ALPHA_TOKEN_LIST");
 console.log("ALPHA_OFFLINE_TESTS_PASS 11 assertions");
}
async function main(){
 if(process.argv.includes("--self-test"))return selfTest();
 const latest=JSON.parse(fs.readFileSync(path.join(ROOT,"latest.json"),"utf8")),report=await collect(latest);
 let old=null;try{old=JSON.parse(fs.readFileSync(path.join(ROOT,"alpha_spot_history.json"),"utf8"))}catch{}
 const h=applyHistory(report,old);write("alpha_spot_latest.json",report);write("alpha_spot_history.json",h);
 console.log(JSON.stringify({asOfUtc:report.asOfUtc,status:report.status,counts:report.counts,newAlerts:report.newAlerts,errors:report.rows.filter(x=>x.status==="REQUEST_FAILED").slice(0,4)}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
module.exports={watched,match,bars,contiguous,fiveMinute,fifteenMinute,bookData,detect,collect,applyHistory};
