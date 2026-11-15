#!/usr/bin/env node
"use strict";
// Public explorer-labeled wallet observations. NOT complete CEX reserves or an investment signal.
const fs=require("node:fs"),path=require("node:path"),DIR=path.join(__dirname,"radar_data");
const SYMBOLS=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
const WALLETS=[
 {chain:"bsc",exchange:"Gate",address:"0xc882b111a75c0c657fc507c04fbfcd2cc984f071",label:"Gate 5",source:"https://bscscan.com/txs?a=0xc882b111a75c0c657fc507c04fbfcd2cc984f071"},
 {chain:"bsc",exchange:"Gate",address:"0x0d0707963952f2fba59dd06f2b425ace40b492fe",label:"Gate Hot",source:"https://www.binance.com/en/square/post/346814455804194"},
 {chain:"bsc",exchange:"Bitget",address:"0xa4856e07d14045014b2c3fece5460bd37b310f10",label:"Bitget Arkham",source:"https://arkm.com/explorer/address/0xa4856e07d14045014b2c3fece5460bd37b310f10"},
 {chain:"bsc",exchange:"Bitget",address:"0xed9ab5bc05a0152b9dc2f7902e8369af7bc18771",label:"Bitget Hot",source:"https://halvion.io/docs"},
 {chain:"base",exchange:"Gate",address:"0xc882b111a75c0c657fc507c04fbfcd2cc984f071",label:"Gate 5",source:"https://basescan.org/txs?a=0xc882b111a75c0c657fc507c04fbfcd2cc984f071"},
 {chain:"base",exchange:"Bitget",address:"0xa4856e07d14045014b2c3fece5460bd37b310f10",label:"Bitget Arkham",source:"https://arkm.com/explorer/address/0xa4856e07d14045014b2c3fece5460bd37b310f10"}
];
const NETWORKS={bsc:{id:56,urls:["https://bsc-dataseed.bnbchain.org","https://bsc-dataseed-public.bnbchain.org"]},
 base:{id:8453,urls:["https://base-rpc.publicnode.com","https://mainnet.base.org"]}};
const isAddress=x=>/^0x[0-9a-f]{40}$/i.test(String(x||""));
const asHex=n=>"0x"+BigInt(n).toString(16);
const round=(x,k=3)=>Number.isFinite(x)?Number(x.toFixed(k)):null;
function human(raw,dec){
 if(raw==null||!Number.isInteger(dec)||dec<0||dec>30)return null;
 try{const n=BigInt(raw),a=n<0n?-n:n,d=10n**BigInt(dec),value=Number(a/d)+Number(a%d)/Number(d);return (n<0n?-1:1)*value;}catch{return null}
}
function sum(raw,addresses){
 if(addresses.some(a=>raw?.[a]?.status!=="OK"))return null;
 try{return addresses.reduce((acc,a)=>acc+BigInt(raw[a].raw),0n)}catch{return null}
}
function analyze(current,history){
 const past=Array.isArray(history?.runs)?history.runs:[];
 const coins=SYMBOLS.map(symbol=>{
  const c=current.coins.find(z=>z.symbol===symbol);
  if(!c)return {symbol,status:"MISSING",exchanges:[]};
  const addrs=WALLETS.filter(w=>w.chain===c.chain);
  const validSample=Number.isInteger(c.block)&&c.block>0&&Number.isInteger(c.decimals)&&c.decimals>=0&&c.decimals<=30&&addrs.every(w=>c.wallets?.[w.address]?.status==="OK");
  const previous=[...past].reverse().find(run=>{
   const p=run.coins?.find(x=>x.symbol===symbol);
   const age=Date.parse(current.asOfUtc)-Date.parse(run.asOfUtc);
   return age>1000&&age<=3*3600000&&p?.token===c.token&&p?.chain===c.chain&&p?.status==="FULL"&&p.block<c.block&&addrs.every(w=>p.wallets?.[w.address]?.status==="OK");
  });
  const prev=previous?.coins.find(z=>z.symbol===symbol);
  const exchanges=["Gate","Bitget"].map(exchange=>{
   const keys=addrs.filter(w=>w.exchange===exchange).map(w=>w.address);
   const nowSum=keys.length&&validSample?sum(c.wallets,keys):null;
   const prevSum=prev&&keys.length?sum(prev.wallets,keys):null;
   const diff=nowSum!==null&&prevSum!==null?nowSum-prevSum:null;
   const delta=diff!==null?human(diff.toString(),c.decimals):null;
   const price=Number(c.priceUSDT)>0?Number(c.priceUSDT):null;
   return {exchange,monitoredAddressCount:keys.length,tokenBalance:nowSum!==null?round(human(nowSum.toString(),c.decimals),6):null,
    deltaToken:round(delta,6),deltaUSDAtCurrentPrice:delta!==null&&price!==null?round(delta*price,2):null,
    movement:delta===null?"NO_BASELINE":delta<0?"LABELED_BALANCE_DECREASE":delta>0?"LABELED_BALANCE_INCREASE":"UNCHANGED",
    fromBlock:prev?.block??null,toBlock:c.block??null,
    caveat:"Tracked-wallet balance delta only. No proof of institution-wide CEX reserve decrease or independent accumulation."};
  });
  return {symbol,chain:c.chain,token:c.token,block:c.block,decimals:c.decimals,priceUSDT:c.priceUSDT,
   status:validSample?"FULL":"PARTIAL",baselineUtc:previous?.asOfUtc??null,
   exchanges,wallets:c.wallets,anyLabeledWalletDecline:exchanges.some(x=>x.movement==="LABELED_BALANCE_DECREASE")};
 });
 return {schema:"15coin-exchange-wallet-observation-v1",asOfUtc:current.asOfUtc,
  status:coins.every(x=>x.status==="FULL")?"ALL_SNAPSHOTS_OK":"PARTIAL_SNAPSHOTS",
  monitoredAddresses:WALLETS,counts:{coins:15,full:coins.filter(x=>x.status==="FULL").length,
   withComparableDelta:coins.filter(x=>x.exchanges.some(y=>y.deltaToken!==null)).length,
   labeledWalletDeclines:coins.filter(x=>x.anyLabeledWalletDecline).length},
  warning:"Explorer/Arkham/third-party labels are not official ownership proofs. Monitored addresses are only a subset of exchange wallets. No inventory claim for an entire exchange. Every negative delta must be interpreted as a labeled-wallet balance decline, not proven accumulation or a future price rise.",coins};
}
async function publicRpc(chain,method,params){
 const c=NETWORKS[chain];if(!c)throw Error("UNKNOWN_CHAIN");
 let last;
 for(const url of c.urls){const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),7500);
  try{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:ctrl.signal});
   if(!r.ok)throw Error("HTTP "+r.status);const j=await r.json();
   if(j.error||typeof j.result!=="string")throw Error("RPC_INVALID");return j.result;
  }catch(e){last=e}finally{clearTimeout(timeout)}
 }
 throw last||Error("ALL_RPC_FAILED");
}
async function parallel(jobs,work,max=5){
 const out=Array(jobs.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(max,jobs.length)},async function loop(){
  while(cursor<jobs.length){const i=cursor++;
   try{out[i]={ok:true,value:await work(jobs[i])}}catch(e){out[i]={ok:false,error:String(e.message||e).slice(0,120)}}
  }
 }));
 return out;
}
async function collect(latest,spot,call=publicRpc){
 const heads={};for(const chain of Object.keys(NETWORKS)){try{
  const chainId=Number(BigInt(await call(chain,"eth_chainId",[])));if(chainId!==NETWORKS[chain].id)throw Error("WRONG_CHAIN");
  const head=Number(BigInt(await call(chain,"eth_blockNumber",[])));if(!Number.isSafeInteger(head)||head<20)throw Error("BAD_HEAD");
  heads[chain]=head-8;
 }catch{heads[chain]=null}}
 const coins=SYMBOLS.map(symbol=>{
  const x=latest.coins?.find(y=>y.symbol===symbol),p=spot.coins?.find(y=>y.symbol===symbol);
  return {symbol,chain:x?.chain||null,token:x?.token?.toLowerCase()||null,block:heads[x?.chain]??null,
   decimals:null,priceUSDT:p?.priceUSDT??null,wallets:{}};
 });
 const jobs=[];for(const c of coins){if(!isAddress(c.token)||!Number.isInteger(c.block))continue;
  jobs.push({coin:c,mode:"decimals"});
  for(const w of WALLETS.filter(x=>x.chain===c.chain))jobs.push({coin:c,mode:"balance",wallet:w});
 }
 const readings=await parallel(jobs,async job=>{
  const c=job.coin,method=job.mode==="decimals"?"0x313ce567":"0x70a08231"+job.wallet.address.slice(2).padStart(64,"0");
  const response=await call(c.chain,"eth_call",[{to:c.token,data:method},asHex(c.block)]);
  if(!/^0x[0-9a-f]+$/i.test(response))throw Error("BAD_RESULT");
  const n=BigInt(response);
  if(job.mode==="decimals"){if(n>30n)throw Error("BAD_DECIMALS");return Number(n)}
  return n.toString();
 },5);
 for(let i=0;i<jobs.length;i++){const j=jobs[i],r=readings[i];
  if(j.mode==="decimals")j.coin.decimals=r.ok?r.value:null;
  else j.coin.wallets[j.wallet.address]={status:r.ok?"OK":"FAILED",raw:r.ok?r.value:null,error:r.ok?null:r.error};
 }
 return {asOfUtc:new Date().toISOString(),coins};
}
async function main(){
 const read=n=>JSON.parse(fs.readFileSync(path.join(DIR,n),"utf8"));
 const latest=read("latest.json"),spot=read("spot_latest.json");
 if(latest.coins?.length!==15||spot.coins?.length!==15)throw Error("EXPECTED_15_COIN_INPUTS");
 let history={schema:"15coin-exchange-wallet-history-v1",runs:[]};
 try{let h=read("exchange_inventory_history.json");if(h.schema===history.schema)history=h}catch{}
 const current=await collect(latest,spot),out=analyze(current,history);
 history.runs.push({asOfUtc:current.asOfUtc,coins:out.coins.map(c=>({symbol:c.symbol,chain:c.chain,token:c.token,block:c.block,status:c.status,wallets:c.wallets}))});
 history.runs=history.runs.slice(-672);
 for(const [n,v] of [["exchange_inventory_latest.json",out],["exchange_inventory_history.json",history]]){
  const file=path.join(DIR,n),tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(v,null,2)+"\n");fs.renameSync(tmp,file);
 }
 console.log(JSON.stringify({asOfUtc:out.asOfUtc,status:out.status,counts:out.counts,
  declines:out.coins.filter(x=>x.anyLabeledWalletDecline).map(x=>({symbol:x.symbol,exchanges:x.exchanges.filter(e=>e.movement==="LABELED_BALANCE_DECREASE")}))},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={analyze,collect,SYMBOLS,WALLETS,human,sum};
