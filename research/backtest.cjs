#!/usr/bin/env node
"use strict";
// One-time read-only research replay. No credentials, orders, trading, or paid APIs.
// Thresholds below are preregistered. No look-ahead, no post-hoc threshold fitting.
const fs=require("node:fs"),path=require("node:path");
const ROOT=path.join(__dirname,".."),DIR=path.join(ROOT,"radar_data");
const DAY=86400,STEP=900,DAY_BARS=96,HORIZON=DAY_BARS;
const MEDIAN_BARS=192,HISTORY_DAYS=42,HOLDOUT_DAYS=10;
const minTimestamp=Number(process.env.REPLAY_START||0);
const round=(n,d=4)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
const date=x=>new Date(x*1000).toISOString();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function median(a){let b=a.filter(x=>Number.isFinite(x)&&x>=0).sort((x,y)=>x-y);if(!b.length)return null;let i=b.length>>1;return b.length%2?b[i]:(b[i-1]+b[i])/2}
async function getJSON(url){
 for(let attempt=0;attempt<3;attempt++){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),13000);
  try{
   const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"15Coin-Evidence-Replay/1.0"},signal:ctl.signal});
   if(!r.ok)throw Error("HTTP "+r.status);
   const j=await r.json();if(!Array.isArray(j))throw Error("unexpected candles API format");
   return j;
  }catch(e){if(attempt===2)throw e;await sleep(650*(attempt+1))}
  finally{clearTimeout(timer)}
 }
}
function candle(x){
 if(!Array.isArray(x)||x.length<6)throw Error("Gate 15m candle schema");
 const [ts,vol,close,high,low,open]=x.slice(0,6).map(Number);
 if(![ts,vol,close,high,low,open].every(Number.isFinite)||ts<1||close<=0||open<=0||vol<0||high<Math.max(open,close,low)||low>Math.min(open,close,high))throw Error("invalid OHLCV");
 return {ts,open,high,low,close,vol};
}
async function load(pair,start,end){
 const map=new Map(),errors=[];let requests=0;
 for(let from=start;from<end;from+=5*DAY){
  const to=Math.min(end,from+5*DAY-STEP);
  const url="https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="+encodeURIComponent(pair)+"&interval=15m&from="+from+"&to="+to;
  try{
   const arr=await getJSON(url);requests++;
   if(arr.length>1000)throw Error("response more than 1000 bars");
   for(const x of arr){const b=candle(x);if(b.ts>=from&&b.ts<=to&&b.ts+STEP<=end)map.set(b.ts,b)}
  }catch(e){errors.push({fromUtc:date(from),error:String(e.message).slice(0,160)})}
  await sleep(130);
 }
 return {bars:[...map.values()].sort((a,b)=>a.ts-b.ts),errors,requests};
}
function outcome(bars,i){
 if(i+HORIZON>=bars.length)return null;
 const entry=bars[i+1].open;
 if(!(entry>0))return null;
 let peak=-Infinity,valley=Infinity,first20=null,firstStop=null;
 for(let j=i+1;j<=i+HORIZON;j++){
  if(j>i+1&&bars[j].ts-bars[j-1].ts!==STEP)return null;
  const b=bars[j],hi=(b.high/entry-1)*100,lo=(b.low/entry-1)*100;
  peak=Math.max(peak,hi);valley=Math.min(valley,lo);
  if(lo<=-10&&firstStop===null)firstStop=j;
  if(hi>=20&&first20===null)first20=j;
 }
 const win=first20!==null&&(firstStop===null||first20<firstStop);
 const close6=bars[i+24].close;
 const close24=bars[i+96].close;
 return {entry:round(entry,10),hit20BeforeStop10:win,hit20Any:peak>=20,maxRise24Pct:round(peak,3),maxFall24Pct:round(valley,3),return6hPct:round(100*(close6/entry-1),3),return24hPct:round(100*(close24/entry-1),3),firstExit:"BOTH_IN_SAME_CANDLE_IS_STOP_FIRST",};
}
function classify(bar,i,bars){
 if(i<MEDIAN_BARS+24||i+HORIZON>=bars.length)return null;
 for(let j=i-25;j<=i;j++)if(j>i-25&&bars[j].ts-bars[j-1].ts!==STEP)return null;
 const base=median(bars.slice(i-MEDIAN_BARS,i).map(x=>x.vol));
 if(!(base>0))return null;
 const v=bar.vol,rvol=v/base;
 const hvol=bars.slice(i-3,i+1).reduce((s,b)=>s+b.vol,0);
 const gain1h=100*(bar.close/bars[i-4].close-1);
 const gain6h=100*(bar.close/bars[i-24].close-1);
 const lowRecent=Math.min(...bars.slice(i-3,i+1).map(b=>b.low));
 const lowPrevious=Math.min(...bars.slice(i-7,i-3).map(b=>b.low));
 // Two predefined hypotheses: baseline volume-only vs early-ignition confluence.
 const volOnly=rvol>=2.5&&v>=5000;
 const early=volOnly&&hvol>=15000&&gain1h>=1&&gain1h<=9&&gain6h<15&&lowRecent>lowPrevious;
 return {volOnly,early,rvol:round(rvol,3),v:round(v,2),hvol:round(hvol,2),gain1h:round(gain1h,2),gain6h:round(gain6h,2)};
}
function summarize(events){
 const n=events.length;
 const p=key=>n?round(100*events.filter(x=>x.result?.[key]===true).length/n,2):null;
 const avg=k=>n?round(events.reduce((sum,x)=>sum+(x.result?.[k]||0),0)/n,3):null;
 return {n,hit20AnyPct:p("hit20Any"),hit20BeforeStop10Pct:p("hit20BeforeStop10"),avgMaxRise24Pct:avg("maxRise24Pct"),avgMaxFall24Pct:avg("maxFall24Pct"),avgReturn6hPct:avg("return6hPct"),avgReturn24hPct:avg("return24hPct")};
}
function evaluate(symbol,bars,splitTs){
 const by={train:{early:[],volumeOnly:[],dailyControl:[]},holdout:{early:[],volumeOnly:[],dailyControl:[]}};
 const lastHit={train:{early:-Infinity,volumeOnly:-Infinity,dailyControl:-Infinity},holdout:{early:-Infinity,volumeOnly:-Infinity,dailyControl:-Infinity}};
 let considered=0,eligible=0,gapRejected=0;
 for(let i=MEDIAN_BARS+24;i<bars.length-HORIZON;i++){
  const t=bars[i].ts;if(t<bars[0].ts+7*DAY)continue;
  const f=classify(bars[i],i,bars);considered++;
  if(!f){gapRejected++;continue}
  const result=outcome(bars,i);if(!result){gapRejected++;continue}
  eligible++;
  const part=t>=splitTs?"holdout":"train";
  const control=t%DAY===0&&bars[i].vol>=1000; // fixed daily control, not tuned after seeing outcome
  const flags={early:f.early,volumeOnly:f.volOnly,dailyControl:control};
  for(const [rule,selected] of Object.entries(flags)){
   if(!selected||t-lastHit[part][rule]<DAY)continue;
   lastHit[part][rule]=t;
   by[part][rule].push({symbol,alertUtc:date(t+STEP),entryUtc:date(t+STEP),rule,rv15:f.rvol,volumeUSD:f.v,price1hPct:f.gain1h,result});
  }
 }
 return {counts:{candles:bars.length,first:bars[0]?date(bars[0].ts):null,last:bars.at(-1)?date(bars.at(-1).ts):null,considered,eligible,gapRejected},events:by};
}
async function main(){
 const dest=path.join(DIR,"research_backtest_latest.json"),at=new Date().toISOString();
 const spot=JSON.parse(fs.readFileSync(path.join(DIR,"spot_latest.json"),"utf8"));
 const symbols=spot.coins.filter(x=>String(x.venue||"").startsWith("Gate Spot ")).map(x=>x.symbol);
 const end=Math.floor(Date.now()/1000/STEP)*STEP-STEP;
 const start=minTimestamp||end-HISTORY_DAYS*DAY;
 const split=end-HOLDOUT_DAYS*DAY;
 const report={schema:"15coin-pre-registered-historical-spot-replay-v1",asOfUtc:at,status:"RESEARCH_INSUFFICIENT",
  methodology:{universe:"All Gate Spot primary symbols from current 15-coin radar, not selected by past winners",symbols,daysRequested:HISTORY_DAYS,holdoutDays:HOLDOUT_DAYS,
   exchange:"Gate Spot (public, no key)",timeframe:"15m fully closed candles",startUtc:date(start),endUtc:date(end),splitUtc:date(split),
   volumeBaseline:"Median previous 192 bars (48h), minimum seven calendar days of history; this experimental rule differs from the live v2 rules",
   earlyHypothesis:"15m RVOL>=2.5 and quote volume >=$5000 AND 1h quote volume >=$15000 AND 1h price +1%..+9% AND 6h price rise below +15% AND rising last 1h low vs previous 1h low",
   comparisons:["Volume-only rule: RVOL>=2.5 + quote volume >=$5000","Fixed daily 00:00 UTC control with quote volume >=$1000"],
   nonOverlap:"Only one same-rule observation per 24h per coin and split",entry:"Next 15m bar OPEN; no hindsight",
   outcome:"Next 24h highest return >=+20%; conservative -10% stop takes precedence if high and low occur within same bar; ignores fees, slippage and liquidity",
   caveats:["SPOT-only research; DOES NOT validate onchain foresight or prove future 10x","Price at next open and OHLCV highs can overstate actual tradeability; future high not guaranteed executable","No optimization, no fit to holdout, no look-ahead","Low event counts or gaps mean no statistically supported edge"]},
  markets:[],summary:{},evidence:[]};
 const aggregate={train:{early:[],volumeOnly:[],dailyControl:[]},holdout:{early:[],volumeOnly:[],dailyControl:[]}};
 for(const symbol of symbols){
  const pair=symbol+"_USDT";
  try{
   const raw=await load(pair,start,end);
   const ev=evaluate(symbol,raw.bars,split);
   for(const part of ["train","holdout"])for(const rule of ["early","volumeOnly","dailyControl"])aggregate[part][rule].push(...ev.events[part][rule]);
   report.markets.push({symbol,pair,source:"https://api.gateio.ws/api/v4/spot/candlesticks",...ev.counts,requests:raw.requests,errors:raw.errors,train:Object.fromEntries(Object.entries(ev.events.train).map(([rule,items])=>[rule,items.length])),holdout:Object.fromEntries(Object.entries(ev.events.holdout).map(([rule,items])=>[rule,items.length]))});
  }catch(e){report.markets.push({symbol,pair,error:String(e.message).slice(0,180)})}
 }
 for(const part of ["train","holdout"])report.summary[part]=Object.fromEntries(Object.entries(aggregate[part]).map(([rule,items])=>[rule,summarize(items)]));
 report.evidence=aggregate.holdout.early.slice(0,50).map(x=>x);
 const available=report.markets.filter(x=>x.eligible>=96);
 const hold=report.summary.holdout.early.n;
 report.status=available.length>=4&&hold>=5?"REPLAY_COMPLETED_NOT_PROVEN":available.length>=4?"REPLAY_COMPLETED_FEW_SIGNALS":"INSUFFICIENT_MARKET_COVERAGE";
 report.verifiedMarkets=available.length;
 report.totalEligibleSamples=report.markets.reduce((a,b)=>a+(b.eligible||0),0);
 report.validationVerdict=available.length>=4&&hold>=10?"Observe lift against volume-only and same-coin daily control; even positive lift is only exploratory":"No validated predictive edge: data coverage or holdout sample is too small";
 fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(dest,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({status:report.status,markets:report.markets.length,verified:available.length,eligible:report.totalEligibleSamples,summary:report.summary,errors:report.markets.filter(x=>x.error||x.errors?.length).map(x=>({symbol:x.symbol,errors:x.errors?.length||x.error}))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
