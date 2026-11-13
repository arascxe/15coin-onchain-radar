#!/usr/bin/env node
"use strict";
/* Public, read-only BSC/Base log collector. No keys, wallet actions, or trading. */
const fs=require("node:fs");
const path=require("node:path");
const DIR=path.join(__dirname,"radar_data");fs.mkdirSync(DIR,{recursive:true});
const STATE_FILE=path.join(DIR,"state.json"),OUT_FILE=path.join(DIR,"latest.json");
const MONITORS=[
["ON","bsc","0x0e4f6209ed984b21edea43ace6e09559ed051d48","0x4620f5c127a6055fbebb1f71327d60ff079c9060","v3"],
["DOS","bsc","0xb0f09ea9ae0515c3551080d4a745c8115aa30e37","0xcbeaad783ffd2cea125e9d9b2ec21e639d20fa59","v3"],
["HANA","bsc","0x6261963ebe9ff014aad10ecc3b0238d4d04e8353","0xd21bc2291c1aef340f5265e257b18aa5dafed759","v3"],
["COLLECT","bsc","0x4b3d30992f003c8167699735f5ab2831b2a087d3","0xef470f9ae8512d2762e4f1cd91ae58caea17143afa61b8d56e9b20c8f87688c4","infinity"],
["LIGHT","bsc","0x477c2c0459004e3354ba427fa285d7c053203c0e","0xae02717e94c9b5bae817601a49b4584f58324015","v3"],
["APR","bsc","0x299ad4299da5b2b93fba4c96967b040c7f611099",null,"unknown"],
["IN","bsc","0x61fac5f038515572d6f42d4bcb6b581642753d50","0x5bd808ab85c124f99080da5f864edcb39950ede5","v3"],
["TRUST","base","0x6cd905df2ed214b22e0d48ff17cd4200c1c6d8a3","0x52448e17dabcb3b6654045974afd572090bcc1f5","other"],
["B2","bsc","0x783c3f003f172c6ac5ac700218a357d2d66ee2a2","0xc1a780989734a0e5df875cebe410748562e1c5e6","v3"],
["CYS","bsc","0x0c69199c1562233640e0db5ce2c399a88eb507c7","0x9cfea9ef82f26857c3426487774c088330555da6113c61ac7fb8b30d0ae434b3","infinity"],
["STBL","bsc","0x8dedf84656fa932157e27c060d8613824e7979e3","0x90166b5795250fe7f0831e844121cc91799787e9","v3"],
["BSB","bsc","0x595deaad1eb5476ff1e649fdb7efc36f1e4679cc","0x26a8e4591b7a0efcd45a577ad0d54aa64a99efaf2546ad4d5b0454c99eb70eab","infinity"],
["AIO","bsc","0x81a7da4074b8e0ed51bea40f9dcbdf4d9d4832b4","0x97620e003c03381eacbde7135f28d94303bb5672","v3"],
["STAR","bsc","0x8fce7206e3043dd360f115afa956ee31b90b787c","0xb4db9fcda97fd7b02eaf1e8317e6ddb04bacc1af","v3"],
["LYN","bsc","0x302dfaf2cdbe51a18d97186a7384e87cf599877d","0x302642976506d247c7017b85ddc89e3956f96ba1","v3-unverified"]
].map(([symbol,chain,token,pool,kind])=>({symbol,chain,token,pool,kind}));
const CHAIN={
bsc:{id:56,blockSeconds:0.75,rpcs:["https://1rpc.io/bnb","https://bsc.meowrpc.com","https://rpc.nodeflare.app/bnb/public","https://bnb.rpc.subquery.network/public","https://56.rpc.thirdweb.com","https://bsc.blockpi.network/v1/rpc/public","https://bsc-rpc.publicnode.com","https://bsc.drpc.org","https://bsc-mainnet.public.blastapi.io"]},
base:{id:8453,blockSeconds:2,rpcs:["https://base-rpc.publicnode.com","https://mainnet.base.org"]}
};
const TRANSFER="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MINT="0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",BURN="0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c";
const MOD="0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const MANAGER="0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b";
const PROOF_TX="0x842301cc2f6df098907e76b38d59b34b8cbb647f4396afd3524f76e4a369160e";
const PROOF_POOL="0x26a8e4591b7a0efcd45a577ad0d54aa64a99efaf2546ad4d5b0454c99eb70eab";
const hex=x=>"0x"+BigInt(x).toString(16),num=x=>Number(BigInt(x)),low=x=>String(x||"").toLowerCase();
function readState(){try{return JSON.parse(fs.readFileSync(STATE_FILE,"utf8"))}catch{return {version:2,cursors:{},recentAlerts:[]}}}
function saveJSON(file,data){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(data,null,2)+"\n");fs.renameSync(tmp,file)}
async function rpc(url,method,params,ms=12500){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),ms);try{
const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:ctl.signal});
if(!r.ok)throw Error("HTTP "+r.status);
const j=await r.json();if(j.error)throw Error("RPC "+JSON.stringify(j.error));if(!Object.hasOwn(j,"result"))throw Error("missing result");return j.result;
}finally{clearTimeout(timer)}}
function words(data){const s=low(data).replace(/^0x/,"");if(!s||s.length%64)throw Error("ABI word alignment");return s.match(/.{64}/g).map(z=>"0x"+z)}
function intN(v,bits){return BigInt.asIntN(bits,BigInt(v))}
function dTransfer(l){if(low(l.topics?.[0])!==TRANSFER||l.topics.length<3)throw Error("bad transfer");return {tx:low(l.transactionHash),block:num(l.blockNumber),logIndex:num(l.logIndex||"0x0"),from:"0x"+low(l.topics[1]).slice(-40),to:"0x"+low(l.topics[2]).slice(-40),raw:BigInt(l.data).toString()}}
function dLP(l,t){const w=words(l.data),tp=l.topics||[];let delta,tickLower,tickUpper,owner;
if(t.kind==="infinity"){if(low(l.address)!==MANAGER||low(tp[0])!==MOD||low(tp[1])!==t.pool||w.length<4)throw Error("wrong infinity pool");tickLower=Number(intN(w[0],24));tickUpper=Number(intN(w[1],24));delta=intN(w[2],256);owner=low(tp[2]||"");}
else{if(low(l.address)!==t.pool||![MINT,BURN].includes(low(tp[0]))||tp.length<4)throw Error("wrong V3 pool");tickLower=Number(intN(tp[2],24));tickUpper=Number(intN(tp[3],24));delta=BigInt(w[low(tp[0])===MINT?1:0])*(low(tp[0])===MINT?1n:-1n);owner=low(tp[1])}
if(tickLower>=tickUpper)throw Error("bad ticks");return {tx:low(l.transactionHash),block:num(l.blockNumber),logIndex:num(l.logIndex||"0x0"),tickLower,tickUpper,delta:delta.toString(),change:delta>0n?"ADD":delta<0n?"REMOVE":"ZERO",ownerOrSender:owner,pool:t.pool}};
async function getLogs(url,filter,from,to){const one=async(a,b)=>rpc(url,"eth_getLogs",[{...filter,fromBlock:hex(a),toBlock:hex(b)}],18000);
async function scan(a,b){try{const logs=await one(a,b);if(!Array.isArray(logs))throw Error("nonarray logs");if(logs.length>9000)throw Error("large log batch");return logs}
catch(e){if(b-a<=0)throw Error("log coverage failed "+a+"-"+b+": "+String(e.message));const m=Math.floor((a+b)/2);return [...await scan(a,m),...await scan(m+1,b)]}}
let all=[];for(let a=from;a<=to;a+=850)all.push(...await scan(a,Math.min(a+849,to)));return all}
async function verifyProvider(chain,url){const c=CHAIN[chain];if(num(await rpc(url,"eth_chainId",[]))!==c.id)throw Error("wrong chain");const head=num(await rpc(url,"eth_blockNumber",[]));if(!Number.isFinite(head)||head<=0)throw Error("invalid head");let positive="UNVERIFIED";
if(chain==="bsc"){let historicalOk=false;try{const tx=await rpc(url,"eth_getTransactionReceipt",[PROOF_TX]);if(tx?.blockNumber){const log=await getLogs(url,{address:MANAGER,topics:[MOD,PROOF_POOL]},num(tx.blockNumber),num(tx.blockNumber));historicalOk=log.some(x=>low(x.transactionHash)===PROOF_TX);}}catch(err){console.warn("Historical proof unavailable",String(err.message).slice(0,100))}
if(historicalOk)positive="HISTORICAL_LP_PASS";else{const toks=MONITORS.filter(t=>t.chain==="bsc").map(t=>t.token);const recent=await getLogs(url,{address:toks,topics:[TRANSFER]},Math.max(1,head-140),head-8);let verified=false;for(const e of recent.slice(0,8)){try{const rec=await rpc(url,"eth_getTransactionReceipt",[e.transactionHash]);verified=!!rec?.logs?.some(l=>low(l.address)===low(e.address)&&num(l.logIndex||"0x0")===num(e.logIndex||"0x0")&&low(l.topics?.[0])===TRANSFER);if(verified)break}catch{}}
if(!verified)throw Error("No verified recent positive ERC20 transfer log and historical LP positive unavailable");positive="RECENT_TRANSFER_RECEIPT_PASS_SNAPSHOT_ONLY";}}
else{const probe=await getLogs(url,{address:MONITORS.find(t=>t.chain==="base").token,topics:[TRANSFER]},Math.max(1,head-3),Math.max(1,head-3));if(!Array.isArray(probe))throw Error("recent logs invalid");positive="NO_KNOWN_POSITIVE";}
return {chain,url,head,positive}}
async function collect(chain,state){const c=CHAIN[chain],errs=[];for(const url of c.rpcs){try{
const status=await verifyProvider(chain,url);const head=status.head;const cursor=Number(state.cursors[chain]||0);const from=cursor?cursor+1:Math.max(1,head-Math.ceil(900/c.blockSeconds));
const to=Math.min(head-5,from+Math.ceil(3600/c.blockSeconds)-1);if(to<from)return {chain,provider:url,...status,from,to,coverage:"NO_NEW_BLOCKS",coins:[],backlog:0};
const tokens=MONITORS.filter(x=>x.chain===chain);const transfer=await getLogs(url,{address:tokens.map(x=>x.token),topics:[TRANSFER]},from,to);
let lps=[];if(chain==="bsc"){
const infinity=tokens.filter(x=>x.kind==="infinity");const v3=tokens.filter(x=>x.kind==="v3");const ilogs=await getLogs(url,{address:MANAGER,topics:[MOD,infinity.map(t=>t.pool)]},from,to);
const vlogs=await getLogs(url,{address:v3.map(x=>x.pool),topics:[[MINT,BURN]]},from,to);
for(const l of ilogs){const t=infinity.find(x=>x.pool===low(l.topics?.[1]));if(t)lps.push({coin:t.symbol,decoded:dLP(l,t)})}
for(const l of vlogs){const t=v3.find(x=>x.pool===low(l.address));if(t)lps.push({coin:t.symbol,decoded:dLP(l,t)})}
}
const blockTime=new Map();async function timestamp(b){if(!blockTime.has(b)){const binfo=await rpc(url,"eth_getBlockByNumber",[hex(b),false]);blockTime.set(b,binfo?.timestamp?new Date(num(binfo.timestamp)*1000).toISOString():null)}return blockTime.get(b)}
let coins=[];for(const t of tokens){const events=transfer.filter(l=>low(l.address)===t.token).map(dTransfer);const by=new Map();for(const e of events){if(e.from!=="0x"+"0".repeat(40))by.set(e.from,(by.get(e.from)||0n)-BigInt(e.raw));if(e.to!=="0x"+"0".repeat(40))by.set(e.to,(by.get(e.to)||0n)+BigInt(e.raw))}
const excluded=new Set([t.token,MANAGER,t.pool]);const inflows=[...by].filter(([a,n])=>n>0n&&!excluded.has(a)).sort((a,b)=>a[1]===b[1]?0:a[1]>b[1]?-1:1).slice(0,6).map(([address,n])=>({address,rawNetIn:n.toString(),identity:"UNVERIFIED"}));
const lpEvents=lps.filter(l=>l.coin===t.symbol).map(x=>({...x.decoded}));for(const e of lpEvents.slice(0,12))e.blockUtc=await timestamp(e.block);
for(const e of events.slice(-12))e.blockUtc=await timestamp(e.block);
const alerts=[];if(lpEvents.some(e=>e.change!=="ZERO"))alerts.push({level:"LP_EVENT_CONFIRMED",message:"LP modification recorded, not proof of bullish preparation"});
if(inflows.length>=2)alerts.push({level:"UNKNOWN_WALLET_NET_INFLOW",message:"At least two addresses gained tokens in scan interval; CEX/bridge/LP ownership NOT established"});
coins.push({symbol:t.symbol,chain,token:t.token,pool:t.pool,coverage:"TRANSFER_LOGS_QUERIED",transferCount:events.length,observedTransfers:events.slice(-12),netRecipients:inflows,lpEventCount:lpEvents.length,lpEvents,alerts});
}
return {chain,provider:url,positive:status.positive,head,from,to,backlog:Math.max(0,head-5-to),coverage:"SUCCESS",coins};
}catch(e){errs.push(url+": "+String(e.message).slice(0,260));console.warn(chain+" RPC failed",url,String(e.message).slice(0,130))}}
if(chain==="bsc"){try{const qs=new URLSearchParams({module:"logs",action:"getLogs",address:MANAGER,fromBlock:"1",toBlock:"1",page:"1",offset:"1"});const u="https://api.routescan.io/v2/network/mainnet/evm/56/etherscan/api?"+qs;const ctrl=new AbortController();const ti=setTimeout(()=>ctrl.abort(),9000);try{const response=await fetch(u,{signal:ctrl.signal});const str=(await response.text()).slice(0,500);errs.push("ROUTESCAN_KEYLESS_PROBE "+response.status+" "+str)}finally{clearTimeout(ti)}}catch(e){errs.push("ROUTESCAN_KEYLESS_PROBE "+String(e.message))}}
return {chain,coverage:"FAILED",errors:errs,coins:[]}}
async function main(){const state=readState(),results=[];for(const chain of ["bsc","base"]){const r=await collect(chain,state);results.push(r);if(r.coverage==="SUCCESS")state.cursors[chain]=r.to}
const by=new Map(results.flatMap(r=>r.coins.map(c=>[c.symbol,c])));const coins=MONITORS.map(t=>by.get(t.symbol)||{symbol:t.symbol,chain:t.chain,coverage:results.find(r=>r.chain===t.chain)?.coverage||"FAILED",transferCount:null,lpEvents:[],alerts:[]});
const status=results.every(r=>r.coverage==="SUCCESS"||r.coverage==="NO_NEW_BLOCKS")?"COMPLETE":results.some(r=>r.coverage==="SUCCESS")?"PARTIAL":"FAILED";
const report={schema:"15coin-chain-evidence-v2",asOfUtc:new Date().toISOString(),status,explicitLimits:"Observed transfers are NOT exchange net inventory or confirmed independent wallets. LP addition or removal is NOT necessarily a bullish event. Unscanned blocks and failed RPC are NOT zero events.",chains:results.map(({coins,...rest})=>rest),coins,alerts:coins.flatMap(c=>c.alerts.map(a=>({symbol:c.symbol,chain:c.chain,...a})))};
saveJSON(OUT_FILE,report);
state.lastRunUtc=report.asOfUtc;state.lastStatus=status;saveJSON(STATE_FILE,state);
console.log(JSON.stringify({status,asOfUtc:report.asOfUtc,measured:coins.filter(c=>c.transferCount!==null).length,lpEvents:coins.reduce((n,c)=>n+c.lpEvents.length,0),alerts:report.alerts.length,chains:report.chains.map(x=>({chain:x.chain,coverage:x.coverage,provider:x.provider,from:x.from,to:x.to,backlog:x.backlog,errors:x.errors}))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
