#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),{review}=require("../health_check.cjs");
const syms=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
const now=Date.parse("2026-11-14T00:00:00Z"),at="2026-11-13T23:59:00Z";
function fixture(){
 const chainCoin=syms.map(symbol=>({symbol,chain:symbol==="TRUST"?"base":"bsc",
 coverage:symbol==="TRUST"?"TRANSFER_LOGS_QUERIED":"RECEIPTS_SCANNED"}));
 return {
  chain:{asOfUtc:at,chains:[{chain:"bsc",method:"eth_getBlockReceipts",coverage:"SUCCESS",backlog:4095,head:5100,from:1,to:1000},
   {chain:"base",method:"eth_getLogs",coverage:"SUCCESS",backlog:7100,head:8105,from:1,to:1000}],coins:chainCoin,
   liveTips:[{chain:"bsc",coverage:"SUCCESS",from:1500,to:5095,head:5100,coins:Array(14).fill({symbol:"ON"}),missingMiddleRange:{from:1001,to:1499}},
   {chain:"base",coverage:"SUCCESS",from:1500,to:8100,head:8105,coins:[{symbol:"TRUST"}],missingMiddleRange:{from:1001,to:1499}}]},
  spot:{asOfUtc:at,counts:{ohlcvReceived:15},coins:syms.map(symbol=>({symbol,status:"OHLCV_RECEIVED"}))},
  pool:{asOfUtc:at,coins:Array(10).fill({status:"READ_OK"}),infinityOnchain:Array(3).fill({status:"READ_OK"}),holderObservations:Array(42).fill({status:"READ_OK"})},
  history:{runs:[{asOfUtc:at}]},
  prep:{asOfUtc:at,status:"DATA_FRESH",counts:{currentData:15},newAlerts:[],coins:syms.map(symbol=>({symbol}))},
  wallet:{asOfUtc:at,status:"SNAPSHOT_ATTEMPTED",dataFresh:true,snapshotBlocks:{bsc:3000,base:2000},counts:{failedRPC:0}}
 };
}
const good=review(fixture(),now);
assert.equal(good.errors.length,0);assert.equal(good.status,"LIVE_HEALTHY_WITH_COVERAGE_LIMITS");
assert(good.warnings.some(x=>x.includes("HISTORICAL_GAP")));
const missingTip=fixture();missingTip.chain.liveTips[0].coverage="FAILED";assert(review(missingTip,now).errors.includes("BSC_LIVE_TIP_NOT_CONFIRMED"));
const stale=fixture();stale.prep.asOfUtc="2026-11-13T23:00:00Z";assert(review(stale,now).errors.includes("PREP_STALE"));
const invisible=fixture();invisible.prep.counts.currentData=13;assert(review(invisible,now).errors.includes("PREPARATION_NOT_15_FRESH"));
const noBase=fixture();noBase.wallet.snapshotBlocks.base=null;assert(review(noBase,now).errors.includes("WALLET_NETWORK_SNAPSHOTS_INCOMPLETE"));
const rpc=fixture();rpc.wallet.counts.failedRPC=1;assert(review(rpc,now).errors.includes("WALLET_RPC_ERRORS"));
const non15=fixture();non15.spot.coins[0].symbol="DOS";assert(review(non15,now).errors.includes("SPOT_SYMBOLS_MISSING"));
const clean=fixture();clean.chain.liveTips=[];for(const c of clean.chain.chains){c.backlog=0;c.to=c.head-5;c.from=c.to-200}
assert.equal(review(clean,now).errors.length,0,"Contiguous recent scan should also be healthy without redundant tip");
const deadBase=fixture();deadBase.chain.liveTips[1].to=1500;assert(review(deadBase,now).errors.includes("BASE_LIVE_TIP_NOT_CONFIRMED"));
const shortBsc=fixture();shortBsc.chain.liveTips[0].from=3300;assert(review(shortBsc,now).errors.includes("BSC_LIVE_TIP_NOT_CONFIRMED"),"Short BSC window cannot be 15m complete");
const shortBase=fixture();shortBase.chain.liveTips[1].from=4500;assert(review(shortBase,now).errors.includes("BASE_LIVE_TIP_NOT_CONFIRMED"),"Short Base window cannot be 15m complete");
console.log(JSON.stringify({testsPassed:11,checks:["fresh data","historical gaps warned","stale tip rejected","stale classifier rejected","incomplete symbol rejected","missing Base wallet snapshot","RPC failure","duplicate symbol","zero-backlog primary lane","old Base tip rejected"]}));
