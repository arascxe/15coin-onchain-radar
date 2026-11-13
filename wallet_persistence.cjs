#!/usr/bin/env node
"use strict";
/*
 Dynamic EOA inventory tracker, read-only.
 EOA is defined by eth_getCode == "0x" at snapshot block. EOA != unique owner, exchange,
 independent whale or proof of intent. A watched address can be a bot or deposit EOA.
 */
const fs=require("node:fs"),path=require("node:path"),DIR=path.join(__dirname,"radar_data");
const URLS={bsc:"https://bsc-dataseed.bnbchain.org",base:"https://base-rpc.publicnode.com"},NOW=new Date().toISOString(),LOOKBACK_MS=7*86400000;
function load(f){return JSON.parse(fs.readFileSync(path.join(DIR,f),"utf8"))}
function save(f,j){const t=path.join(DIR,f),tmp=t+".tmp";fs.writeFileSync(tmp,JSON.stringify(j,null,2)+"\n");fs.renameSync(tmp,t)}
const hex=n=>"0x"+BigInt(n).toString(16);
const validAddress=x=>/^0x[0-9a-f]{40}$/.test(String(x||"").toLowerCase());
function decimal(raw,dec,price){if(raw==null||!Number.isInteger(dec)||!(price>0))return null;try{
 let n=BigInt(raw),sign=n<0n?-1:1;n=n<0n?-n:n;const d=10n**BigInt(dec);
 return sign*(Number(n/d)+Number(n%d)/Number(d))*price;
}catch{return null}}
async function rpc(method,params,chain="bsc"){
 const ac=new AbortController(),t=setTimeout(()=>ac.abort(),9000);
 try{const r=await fetch(URLS[chain],{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:ac.signal});
 if(!r.ok)throw Error("HTTP "+r.status);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;
 }finally{clearTimeout(t)}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function mapLimited(items,n,fn){const result=[];for(let i=0;i<items.length;i+=n){const batch=await Promise.all(items.slice(i,i+n).map(async(item,k)=>{try{return {ok:true,value:await fn(item)}}catch(e){return{ok:false,error:String(e.message).slice(0,150)}}}));result.push(...batch);if(i+n<items.length)await sleep(110)}return result}
function evolve(previous,observed,now,price,dec){
 const cur=BigInt(observed.balanceRaw);
 const prev=previous&&previous.currentBalanceRaw!=null?BigInt(previous.currentBalanceRaw):cur;
 const first=previous&&previous.firstBalanceRaw!=null?BigInt(previous.firstBalanceRaw):cur;
 const age=previous?(Date.parse(now)-Date.parse(previous.firstSeenUtc))/60000:0;
 const gap=previous?(Date.parse(now)-Date.parse(previous.lastSeenUtc))/60000:0;
 const count=(previous?.observations||0)+1;
 const consecutive=gap>0&&gap<=90?(previous?.consecutive||1)+1:1;
 const gain=cur-first;
 return {symbol:observed.symbol,chain:observed.chain||"bsc",token:observed.token,address:observed.address,
  identity:"EOA_NO_CONTRACT_CODE_AT_BLOCK",ownerVerified:false,
  firstSeenUtc:previous?.firstSeenUtc||now,lastSeenUtc:now,
  firstBalanceRaw:first.toString(),previousBalanceRaw:prev.toString(),
  currentBalanceRaw:cur.toString(),balanceDeltaSinceFirstRaw:gain.toString(),
  deltaSinceFirstUSD:price!=null?Number(decimal(gain,dec,price).toFixed(2)):null,
  lastIntervalDeltaRaw:(cur-prev).toString(),lastIntervalMinutes:Number(gap.toFixed(2)),
  firstProof:previous?.firstProof||observed.firstProof||null,
  observations:count,consecutive,
  persistenceEligible:count>=3&&age>=30&&consecutive>=3&&gap<=90,
  caveat:"Direct balanceOf snapshots of an EOA; owner unknown. Tokens may move between snapshots, prior gains not attributable to a CEX. Large balance may reflect swaps, internal transfers or custody."};
}
async function main(){
 const chain=load("latest.json"),spot=load("spot_latest.json"),pools=load("pool_state_latest.json");
 let old={schema:"15coin-dynamic-wallet-v1",tracked:[]};try{const x=load("wallet_track.json");if(x.schema===old.schema)old=x}catch{}
 const tips=(chain.liveTips||[]).filter(x=>["bsc","base"].includes(x.chain)&&["SUCCESS","PARTIAL"].includes(x.coverage));
 const tipBy=new Map(tips.map(x=>[x.chain,x]));
 const coins=tips.flatMap(t=>t.coins.map(c=>({...c,network:t.chain})));
 const priceBy=new Map(spot.coins.map(c=>[c.symbol,c.priceUSDT])),decBy={...(pools.tokenDecimals||{})};
 const decimalsErrors=[];
 // Base TRUST requires its own actual token.decimals() on Base, not BSC metadata.
 for(const c of coins.filter(x=>x.network==="base")){
  try{const d=Number(BigInt(await rpc("eth_call",[{to:c.token,data:"0x313ce567"},"latest"],"base")));
   if(Number.isInteger(d)&&d>=0&&d<=30)decBy[c.symbol]=d;
   else decimalsErrors.push({symbol:c.symbol,error:"INVALID_BASE_DECIMALS"});
  }catch(e){decimalsErrors.push({symbol:c.symbol,error:String(e.message).slice(0,150)})}
 }
 const tokenBy=new Map(coins.map(c=>[c.symbol,{token:c.token,chain:c.network}]));
 const ignore=new Set(coins.flatMap(c=>[c.token,c.pool]).filter(validAddress).map(x=>x.toLowerCase()));
 const candidates=[],cutoff=Date.parse(NOW)-LOOKBACK_MS,proofMap=new Map();
 for(const c of coins){
  const tip=tipBy.get(c.network);
  for(const entry of (c.netRecipients||[]).slice(0,4)){
   const address=String(entry.address||"").toLowerCase();if(!validAddress(address)||ignore.has(address))continue;
   const usd=decimal(entry.rawNetIn,decBy[c.symbol],priceBy.get(c.symbol));
   if(!(usd>=100))continue;
   const key=c.symbol+"|"+address;
   proofMap.set(key,{chain:c.network,windowFrom:tip.from,windowTo:tip.to,positiveNetTransferRaw:entry.rawNetIn,usdApprox:Number(usd.toFixed(2)),hashesOnlyIfInObservedTransfers:(c.observedTransfers||[]).filter(x=>x.to===address).slice(-3).map(x=>x.tx),caution:"Net received in a scanned block window; does not prove retained balance or unique holder."});
   candidates.push({symbol:c.symbol,chain:c.network,address,token:c.token,firstProof:proofMap.get(key)});
  }
 }
 const bySym=new Map();
 for(const c of candidates){const z=bySym.get(c.symbol)||[];if(!z.some(x=>x.address===c.address))z.push(c);bySym.set(c.symbol,z)}
 for(const prev of old.tracked){
  if(Date.parse(prev.lastSeenUtc)<cutoff||!tokenBy.has(prev.symbol))continue;
  const arr=bySym.get(prev.symbol)||[];
  if(arr.length<10&&!arr.some(x=>x.address===prev.address))arr.push({symbol:prev.symbol,chain:tokenBy.get(prev.symbol).chain,address:prev.address,token:tokenBy.get(prev.symbol).token,firstProof:prev.firstProof});
  bySym.set(prev.symbol,arr);
 }
 const jobs=[...bySym.values()].flatMap(arr=>arr.slice(0,10));
 // Read a recent block on EACH chain, never reusing BSC tags for Base.
 let snapshotBlock=null,tracked=[],skippedContract=0,failures=[...decimalsErrors],eoaChecks=0;
 const snapshotBlocks={bsc:null,base:null},tags={},codeMap=new Map();
 for(const network of ["bsc","base"]){
  if(!tipBy.has(network))continue;
  try{const head=Number(BigInt(await rpc("eth_blockNumber",[],network)));
   snapshotBlocks[network]=head-6;tags[network]=hex(head-6)}
  catch(e){failures.push({network,error:"BLOCK_"+String(e.message).slice(0,150)})}
 }
 snapshotBlock=snapshotBlocks.bsc;
 const addresses=[...new Map(jobs.map(j=>[j.chain+"|"+j.address,{chain:j.chain,address:j.address}])).values()].filter(j=>tags[j.chain]);
 const codes=await mapLimited(addresses,7,async j=>({key:j.chain+"|"+j.address,code:await rpc("eth_getCode",[j.address,tags[j.chain]],j.chain)}));
 for(let i=0;i<addresses.length;i++){
  const r=codes[i],j=addresses[i],key=j.chain+"|"+j.address;
  if(r.ok){const code=String(r.value.code||"").toLowerCase();codeMap.set(key,code==="0x"?"EOA":"CONTRACT");eoaChecks++}
  else{codeMap.set(key,"READ_FAILED");failures.push({network:j.chain,address:j.address,error:r.error})}
 }
 const eoa=jobs.filter(j=>codeMap.get(j.chain+"|"+j.address)==="EOA");
 skippedContract=jobs.filter(j=>codeMap.get(j.chain+"|"+j.address)==="CONTRACT").length;
 const reads=await mapLimited(eoa,7,async j=>({...j,balanceRaw:BigInt(await rpc("eth_call",[{to:j.token,data:"0x70a08231"+j.address.slice(2).padStart(64,"0")},tags[j.chain]],j.chain)).toString()}));
 for(let i=0;i<eoa.length;i++){
  const r=reads[i],j=eoa[i];if(!r.ok){failures.push({network:j.chain,symbol:j.symbol,address:j.address,error:r.error});continue}
  const oldEntry=old.tracked.find(q=>q.symbol===j.symbol&&q.address===j.address&&(q.chain||"bsc")===j.chain);
  const obs=evolve(oldEntry,r.value,NOW,priceBy.get(j.symbol),decBy[j.symbol]);tracked.push(obs);
 }
 // Keep evidence after intermittent RPC outages; mark stale, never call it current.
 for(const prev of old.tracked)if(!tracked.some(x=>x.symbol===prev.symbol&&x.address===prev.address)&&Date.parse(prev.lastSeenUtc)>=cutoff)tracked.push(prev);
 tracked=tracked.sort((a,b)=>Date.parse(b.lastSeenUtc)-Date.parse(a.lastSeenUtc)).slice(0,180);
 const signals=tracked.filter(x=>x.lastSeenUtc===NOW&&x.persistenceEligible&&x.deltaSinceFirstUSD!=null&&x.deltaSinceFirstUSD>=10000)
 .map(x=>({symbol:x.symbol,address:x.address,eoaUnverified:true,
  firstSeenUtc:x.firstSeenUtc,chain:x.chain,observations:x.observations,consecutive:x.consecutive,
  netRetainedIncreaseUSD:x.deltaSinceFirstUSD,lastSnapshotBlock:snapshotBlocks[x.chain],
  firstProof:x.firstProof,caveat:"Observed growing EOA balance over >=30min in >=3 snapshots with up to 90m gaps; origin/owner unknown; NOT exchange net withdrawal."}));
 const report={schema:"15coin-dynamic-wallet-latest-v1",asOfUtc:NOW,status:snapshotBlocks.bsc!=null&&snapshotBlocks.base!=null?"SNAPSHOT_ATTEMPTED":"PARTIAL_SNAPSHOT_COVERAGE",snapshotBlock,snapshotBlocks,
  source:"Read-only BSC official and Base public eth_getCode / ERC20.balanceOf; candidate recipients from BSC block receipts and Base eth_getLogs",
  dataFresh:Date.parse(NOW)-Date.parse(chain.asOfUtc)<20*60000,
  candidates:signals,counts:{newRecipients:candidates.length,trackedEOAs:tracked.filter(x=>x.lastSeenUtc===NOW).length,
  contractCandidatesSkipped:skippedContract,codeReads:eoaChecks,failedRPC:failures.length,qualifiedPersistence:signals.length},
  caveats:["EOA != independent private holder, exchange or whale. Candidate labels are unverified",
  "Early stage window excludes unscanned blocks; cumulative balance is not the same as independently funded buying",
  "Only candidates entering the top four net recipients per scanned window and retained tracked addresses are observed"],
  errors:failures.slice(0,15)};
 const state={schema:"15coin-dynamic-wallet-v1",asOfUtc:NOW,tracked};
 save("wallet_latest.json",report);save("wallet_track.json",state);
 console.log(JSON.stringify({status:report.status,counts:report.counts,signals:signals.slice(0,6),snapshotBlocks:report.snapshotBlocks}));
}
module.exports={evolve,decimal};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
