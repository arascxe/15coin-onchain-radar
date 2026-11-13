#!/usr/bin/env node
"use strict";
/* Audit data integrity. Success means recent live windows checked, NOT full historical coverage or prediction quality. */
const fs=require("node:fs"),path=require("node:path");
const DIR=path.join(__dirname,"radar_data"),OUT=path.join(DIR,"health_latest.json");
const SYMS=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
function age(t,now){const n=now-Date.parse(t||"");return Number.isFinite(n)?Math.round(n/1000):null}
function review(d,now=Date.now()){
 const errors=[],warnings=[];
 const bad=(name,ok)=>{if(!ok)errors.push(name)};
 const recent=(t,s=600)=>{const x=age(t,now);return x!==null&&x>=-60&&x<=s};
 const {chain,spot,pool,history,wallet,prep}=d;
 for(const [name,v] of Object.entries({chain,spot,pool,history,wallet,prep}))bad(name+"_FILE_MISSING",!!v);
 if(errors.length)return {status:"FAILED",errors,warnings,agesSeconds:{},verifiedSymbols:0};
 const agesSeconds={chain:age(chain.asOfUtc,now),spot:age(spot.asOfUtc,now),pool:age(pool.asOfUtc,now),
  history:age(history.runs?.at(-1)?.asOfUtc,now),wallet:age(wallet.asOfUtc,now),prep:age(prep.asOfUtc,now)};
 for(const [key,a] of Object.entries(agesSeconds))bad(key.toUpperCase()+"_STALE",a!==null&&a>=-60&&a<=600);
 bad("SPOT_NOT_15",spot.counts?.ohlcvReceived===15&&spot.coins?.filter(c=>c.status==="OHLCV_RECEIVED").length===15);
 const spotSyms=new Set(spot.coins?.map(x=>x.symbol));
 bad("SPOT_SYMBOLS_MISSING",SYMS.every(s=>spotSyms.has(s))&&spotSyms.size===15);
 bad("V3_POOL_READ_INCOMPLETE",pool.coins?.filter(c=>c.status==="READ_OK").length===10);
 bad("INFINITY_POOL_READ_INCOMPLETE",pool.infinityOnchain?.filter(c=>c.status==="READ_OK").length===3);
 bad("WATCHED_BALANCE_READ_INCOMPLETE",pool.holderObservations?.filter(c=>c.status==="READ_OK").length===42);
 const bsc=chain.chains?.find(c=>c.chain==="bsc"),base=chain.chains?.find(c=>c.chain==="base");
 const valid=(c)=>c&&["SUCCESS","NO_NEW_BLOCKS"].includes(c.coverage);
 bad("BSC_OLD_CURSOR_SCAN_FAILED",valid(bsc)&&bsc.method==="eth_getBlockReceipts");
 bad("BASE_OLD_CURSOR_SCAN_FAILED",valid(base)&&base.method==="eth_getLogs");
 bad("BSC_COIN_RECEIPTS_INCOMPLETE",chain.coins?.filter(c=>c.chain==="bsc"&&c.coverage==="RECEIPTS_SCANNED").length===14);
 bad("BASE_TRUST_MISSING",chain.coins?.some(c=>c.symbol==="TRUST"&&c.chain==="base"&&c.coverage==="TRANSFER_LOGS_QUERIED"));
 // When backlog exists, the cursor is old by definition. Check the priority LIVE TIP, not the stale cursor.
 const quality={};
 for(const [name,c,expected] of [["bsc",bsc,14],["base",base,1]]){
  const lag=Number(c?.backlog||0),tip=chain.liveTips?.find(t=>t.chain===name);
  const ref=lag>0?tip:c;
  const maxDistance=name==="bsc"?180:90;
  const within=ref&&Number.isFinite(ref.head)&&Number.isFinite(ref.to)&&ref.head-ref.to>=0&&ref.head-ref.to<=maxDistance;
  const covered=lag>0?tip?.coverage==="SUCCESS"&&tip?.coins?.length===expected:
   valid(c)&&c?.coins==null; // live primary lane coins are stored in chain.coins instead
  const span=ref&&Number.isFinite(ref.from)&&Number.isFinite(ref.to)&&ref.to>=ref.from;
  const blocksInWindow=span?ref.to-ref.from+1:0;
  const minTipBlocks=lag>0?(name==="bsc"?2400:4800):1;
  quality[name]={historicBacklog:lag,tipMode:lag>0?"LIVE_PRIORITY":"CONTIGUOUS_PRIMARY",tipFrom:ref?.from??null,tipTo:ref?.to??null,
   tipHead:ref?.head??null,tipCoverage:ref?.coverage??null,blocksInWindow,minTipBlocks,unsampledMiddle:tip?.missingMiddleRange??null};
  bad(name.toUpperCase()+"_LIVE_TIP_NOT_CONFIRMED",Boolean(within&&covered&&span&&blocksInWindow>=minTipBlocks));
  if(lag>0)warnings.push(name.toUpperCase()+"_HISTORICAL_GAP_"+lag+"_BLOCKS");
 }
 const syms=new Set(prep.coins?.map(c=>c.symbol));
 bad("PREPARATION_NOT_15_FRESH",prep.status==="DATA_FRESH"&&prep.coins?.length===15&&prep.counts?.currentData===15&&SYMS.every(s=>syms.has(s))&&syms.size===15);
 bad("WALLET_NETWORK_SNAPSHOTS_INCOMPLETE",wallet.status==="SNAPSHOT_ATTEMPTED"&&wallet.dataFresh===true&&wallet.snapshotBlocks?.bsc>0&&wallet.snapshotBlocks?.base>0);
 bad("WALLET_RPC_ERRORS",wallet.counts?.failedRPC===0);
 if(!Array.isArray(history.runs))errors.push("SPOT_HISTORY_MISSING");
 if(!Array.isArray(prep.newAlerts))errors.push("PREPARATION_NEW_ALERTS_NOT_ARRAY");
 if(bsc?.backlog>0||base?.backlog>0)warnings.push("LATEST_WINDOWS_OK_DOES_NOT_IMPLY_FULL_CHAIN_COVERAGE");
 return {status:errors.length?"FAILED":"LIVE_HEALTHY_WITH_COVERAGE_LIMITS",errors,warnings,agesSeconds,quality,
  verifiedSymbols:syms.size,alertCount:prep.newAlerts?.length??null,wallClockUtc:new Date(now).toISOString()};
}
function read(file){try{return JSON.parse(fs.readFileSync(path.join(DIR,file),"utf8"))}catch{return null}}
function main(){
 if(process.argv.includes("--verify-only")){
  const x=read("health_latest.json");const seconds=x&&age(x.asOfUtc,Date.now());
  if(!x||seconds===null||seconds>600||seconds< -60||x.status==="FAILED"||x.errors?.length){console.error("HEALTH CHECK NOT PASSED",JSON.stringify(x?.errors||["NO_HEALTH_REPORT"]));process.exitCode=1}
  else console.log("HEALTH CHECK PASSED",JSON.stringify({ageSeconds:seconds,status:x.status,warnings:x.warnings,quality:x.quality}));
  return;
 }
 const inputs={chain:read("latest.json"),spot:read("spot_latest.json"),pool:read("pool_state_latest.json"),
  history:read("spot_history.json"),prep:read("prep_latest.json"),wallet:read("wallet_latest.json")};
 const report=review(inputs);report.schema="15coin-live-health-v1";report.asOfUtc=report.wallClockUtc;
 report.workflowEvent=process.env.GITHUB_EVENT_NAME||"local";
 report.workflowRunId=process.env.GITHUB_RUN_ID||null;
 fs.writeFileSync(OUT+".tmp",JSON.stringify(report,null,2)+"\n");fs.renameSync(OUT+".tmp",OUT);
 console.log(JSON.stringify(report));
 if(report.errors.length)process.exitCode=1;
}
module.exports={review};
if(require.main===module)main();
