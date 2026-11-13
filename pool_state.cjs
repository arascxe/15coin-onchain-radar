#!/usr/bin/env node
"use strict";
// Independent free BNB Chain on-chain state fallback. Does NOT claim LP events.
const fs=require("node:fs"),path=require("node:path"),dir=path.join(__dirname,"radar_data");fs.mkdirSync(dir,{recursive:true});
const targets=[
["ON","0x0e4f6209ed984b21edea43ace6e09559ed051d48","0x4620f5c127a6055fbebb1f71327d60ff079c9060"],
["DOS","0xb0f09ea9ae0515c3551080d4a745c8115aa30e37","0xcbeaad783ffd2cea125e9d9b2ec21e639d20fa59"],
["HANA","0x6261963ebe9ff014aad10ecc3b0238d4d04e8353","0xd21bc2291c1aef340f5265e257b18aa5dafed759"],
["COLLECT","0x4b3d30992f003c8167699735f5ab2831b2a087d3",null],
["LIGHT","0x477c2c0459004e3354ba427fa285d7c053203c0e","0xae02717e94c9b5bae817601a49b4584f58324015"],
["APR","0x299ad4299da5b2b93fba4c96967b040c7f611099",null],
["IN","0x61fac5f038515572d6f42d4bcb6b581642753d50","0x5bd808ab85c124f99080da5f864edcb39950ede5"],
["B2","0x783c3f003f172c6ac5ac700218a357d2d66ee2a2","0xc1a780989734a0e5df875cebe410748562e1c5e6"],
["CYS","0x0c69199c1562233640e0db5ce2c399a88eb507c7",null],
["STBL","0x8dedf84656fa932157e27c060d8613824e7979e3","0x90166b5795250fe7f0831e844121cc91799787e9"],
["BSB","0x595deaad1eb5476ff1e649fdb7efc36f1e4679cc",null],
["AIO","0x81a7da4074b8e0ed51bea40f9dcbdf4d9d4832b4","0x97620e003c03381eacbde7135f28d94303bb5672"],
["STAR","0x8fce7206e3043dd360f115afa956ee31b90b787c","0xb4db9fcda97fd7b02eaf1e8317e6ddb04bacc1af"],
["LYN","0x302dfaf2cdbe51a18d97186a7384e87cf599877d","0x302642976506d247c7017b85ddc89e3956f96ba1"]];
const rpcUrls=["https://bsc-dataseed.bnbchain.org","https://bsc-dataseed-public.bnbchain.org","https://bsc-dataseed1.binance.org"];
const call=async(url,method,params)=>{const ac=new AbortController(),t=setTimeout(()=>ac.abort(),10000);try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:ac.signal});if(!r.ok)throw Error("HTTP "+r.status);let j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result}finally{clearTimeout(t)}};
const addrWord=a=>a.slice(2).toLowerCase().padStart(64,"0");
const cleanAddress=x=>typeof x==="string"&&x.length>=66?"0x"+x.slice(-40).toLowerCase():null;
const named=(x)=>x==null?null:BigInt(x).toString();
let prev={};try{prev=JSON.parse(fs.readFileSync(path.join(dir,"pool_state.json"),"utf8"))}catch{}
function save(file,data){const p=path.join(dir,file),t=p+".tmp";fs.writeFileSync(t,JSON.stringify(data,null,2)+"\n");fs.renameSync(t,p)}
async function query(url,token,pool,blockTag){
  let [dec,bal,liquid,slot,p0,p1]=await Promise.allSettled([
   call(url,"eth_call",[{to:token,data:"0x313ce567"},blockTag]),
   call(url,"eth_call",[{to:token,data:"0x70a08231"+addrWord(pool)},blockTag]),
   call(url,"eth_call",[{to:pool,data:"0x1a686502"},blockTag]),
   call(url,"eth_call",[{to:pool,data:"0x3850c7bd"},blockTag]),
   call(url,"eth_call",[{to:pool,data:"0x0dfe1681"},blockTag]),
   call(url,"eth_call",[{to:pool,data:"0xd21220a7"},blockTag])
  ]);
 const val=x=>x.status==="fulfilled"?x.value:null;
 const a0=cleanAddress(val(p0)),a1=cleanAddress(val(p1)),matched=a0?.toLowerCase()===token||a1?.toLowerCase()===token;
 if(!matched)return {status:"POOL_TOKEN_MISMATCH_OR_UNAVAILABLE",token0:a0,token1:a1};
 const decimals=val(dec)==null?null:Number(BigInt(val(dec)));
 const raw=val(bal)!=null?named(val(bal)):null,active=val(liquid)!=null?named(val(liquid)):null;
 const slotHex=val(slot);const tickHex=typeof slotHex==="string"&&slotHex.length>=130?"0x"+slotHex.slice(66,130):null;
 const tick=tickHex==null?null:Number(BigInt.asIntN(24,BigInt(tickHex)));
 return {status:"READ_OK",token0:a0,token1:a1,decimals,poolTokenBalanceRaw:raw,activeV3LiquidityRaw:active,currentTick:tick,sqrtPriceX96:typeof slotHex==="string"&&slotHex.length>=66?named("0x"+slotHex.slice(2,66)):null};
}
async function main(){let url=null,head=null,fail=[];for(const u of rpcUrls){try{if(Number(BigInt(await call(u,"eth_chainId",[])))!==56)throw Error("wrong chain");head=Number(BigInt(await call(u,"eth_blockNumber",[])));url=u;break}catch(e){fail.push(u+" "+String(e.message))}}
const at=new Date().toISOString();
if(!url){const report={asOfUtc:at,status:"FAILED_NO_RPC",errors:fail,coins:[]};save("pool_state_latest.json",report);console.log(JSON.stringify(report));return}
const report={schema:"15coin-bsc-pool-state-v1",asOfUtc:at,status:"SUCCESS_WITH_PARTIAL_POOL_COVERAGE",provider:url,blockNumber:head,chainId:56,meaning:"Current on-chain pool token balance/active liquidity snapshots, NOT authenticated LP Mint/Burn events or CEX wallet accumulation",coins:[]};
for(const [symbol,token,pool] of targets){if(!pool){report.coins.push({symbol,status:"NO_DIRECT_POOL_CONTRACT_IN_MAP"});continue}
 try{const obs=await query(url,token.toLowerCase(),pool.toLowerCase(),"0x"+head.toString(16));let before=prev.coins?.find(x=>x.symbol===symbol&&x.status==="READ_OK");
 let deltas=null;if(obs.status==="READ_OK"&&before?.status==="READ_OK"&&prev.blockNumber<head){const x=obs.poolTokenBalanceRaw!=null&&before.poolTokenBalanceRaw!=null?(BigInt(obs.poolTokenBalanceRaw)-BigInt(before.poolTokenBalanceRaw)).toString():null;const l=obs.activeV3LiquidityRaw!=null&&before.activeV3LiquidityRaw!=null?(BigInt(obs.activeV3LiquidityRaw)-BigInt(before.activeV3LiquidityRaw)).toString():null;deltas={fromBlock:prev.blockNumber,toBlock:head,poolTokenBalanceDeltaRaw:x,activeLiquidityDeltaRaw:l,caveat:"Balance delta may be swaps or LP action; liquidity delta may also reflect tick crossings. Neither proves LP removal."}}
 report.coins.push({symbol,tokenContract:token,poolAddress:pool,...obs,deltas})}
 catch(e){report.coins.push({symbol,status:"RPC_CALL_FAILED",error:String(e.message).slice(0,150)})}
}
const walletSeeds=[
{address:"0xc882b111a75c0c657fc507c04fbfcd2cc984f071",thirdPartyLabel:"Gate.io 5 candidate",identityVerified:false},
{address:"0x73d8bd54f7cf5fab43fe4ef40a62d390644946db",thirdPartyLabel:"Binance proxy candidate",identityVerified:false},
{address:"0x0d0707963952f2fba59dd06f2b425ace40b492fe",thirdPartyLabel:"Gate hot wallet candidate",identityVerified:false}
];
report.holderObservations=[];
const holderJobs=targets.flatMap(([symbol,token])=>walletSeeds.map(w=>({symbol,token,address:w.address,thirdPartyLabel:w.thirdPartyLabel,identityVerified:false})));
for(let i=0;i<holderJobs.length;i+=7){const part=await Promise.all(holderJobs.slice(i,i+7).map(async j=>{try{
const raw=await call(url,"eth_call",[{to:j.token,data:"0x70a08231"+addrWord(j.address)},"0x"+head.toString(16)]);
const now=BigInt(raw).toString();
const before=prev.holderObservations?.find(x=>x.symbol===j.symbol&&x.address===j.address&&x.status==="READ_OK");
const delta=before?.balanceRaw!=null&&prev.blockNumber<head?(BigInt(now)-BigInt(before.balanceRaw)).toString():null;
return {...j,status:"READ_OK",balanceRaw:now,deltaRaw:delta,fromBlock:delta==null?null:prev.blockNumber,toBlock:head}
}catch(e){return {...j,status:"RPC_FAILED",error:String(e.message).slice(0,120)}}}));report.holderObservations.push(...part)}
report.caveat="Wallet labels are unverified third-party attribution, not verified full exchange entity net reserves. Do not infer actual buyers or bullish accumulation from balance deltas alone.";
const infinityPools=[
{symbol:"BSB",poolId:"0x26a8e4591b7a0efcd45a577ad0d54aa64a99efaf2546ad4d5b0454c99eb70eab"},
{symbol:"COLLECT",poolId:"0xef470f9ae8512d2762e4f1cd91ae58caea17143afa61b8d56e9b20c8f87688c4"},
{symbol:"CYS",poolId:"0x9cfea9ef82f26857c3426487774c088330555da6113c61ac7fb8b30d0ae434b3"}];
report.infinitySnapshots=[];
for(const inf of infinityPools){try{
const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
let res;try{res=await fetch("https://api.geckoterminal.com/api/v2/networks/bsc/pools/"+inf.poolId,{headers:{accept:"application/json"},signal:ctrl.signal})}finally{clearTimeout(timer)}
if(!res.ok)throw Error("HTTP "+res.status);
const j=await res.json(),d=j?.data?.attributes;
if(!d)throw Error("missing pool data");
const tvl=Number(d.reserve_in_usd),before=prev.infinitySnapshots?.find(x=>x.symbol===inf.symbol&&x.status==="READ_OK");
report.infinitySnapshots.push({symbol:inf.symbol,poolId:inf.poolId,status:"READ_OK",source:"GeckoTerminal not onchain LP event",sourceTimeUtc:at,network:"bsc",tvlUsd:Number.isFinite(tvl)?tvl:null,tvlChangePct:before?.tvlUsd>0&&Number.isFinite(tvl)?100*(tvl/before.tvlUsd-1):null,volume24hUsd:d.volume_usd?.h24??null,transactions24h:d.transactions?.h24??null,limitations:"TVL changes can be price/swap effect, NOT proof of LP mint/burn"})
}catch(e){report.infinitySnapshots.push({symbol:inf.symbol,poolId:inf.poolId,status:"FETCH_FAILED",error:String(e.message).slice(0,130)})}}
save("pool_state_latest.json",report);if(report.coins.some(x=>x.status==="READ_OK"))save("pool_state.json",report);
console.log(JSON.stringify({status:report.status,provider:url,head,readOk:report.coins.filter(x=>x.status==="READ_OK").length,deltas:report.coins.filter(x=>x.deltas).length,failed:report.coins.filter(x=>x.status==="RPC_CALL_FAILED").length}));}
main().catch(e=>{console.error(e);process.exitCode=1});
