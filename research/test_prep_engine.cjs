#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const {evaluate,updateHistory,money}=require("../prep_engine.cjs");
const NOW="2026-11-13T21:00:00.000Z",AT="2026-11-13T20:59:00.000Z";
const S=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
const x=String(1e6),watchAddr="0xc882b111a75c0c657fc507c04fbfcd2cc984f071";
const live={symbol:"ON",tokenFlows:{walletFlows:[{address:watchAddr,thirdPartyLabel:"UNVERIFIED",identityVerified:false,
 rawNetOut:"400000000000000000000000",rawNonPoolOut:"400000000000000000000000",distinctNonPoolRecipients:2,directProof:[{tx:"0x1234",block:123,to:"0xbeef",raw:"400000000000000000000000"}]}],
 poolFlow:{rawIn:"0",rawOut:"300000000000000000000000",rawNetOut:"300000000000000000000000"}},lpNet:{netPositionCount:0,grossLpEvents:0,zeroNetRoundTripPositions:0,netPositions:[]},coverage:"RECEIPTS_SCANNED"};
function fixture(){
 return {nowUtc:NOW,
 spot:{asOfUtc:AT,coins:S.map(symbol=>({symbol,status:"OHLCV_RECEIVED",venue:symbol+" gate",priceUSDT:0.1,change24hPct:4,change6hPct:2,close1hChangePct:1,
 rvol15m:{status:"OK",rvol:1.2,volumeUSD:1000},microstructure:null}))},
 pool:{asOfUtc:AT,tokenDecimals:Object.fromEntries(S.map(s=>[s,18])),
 coins:S.map(symbol=>({symbol,status:"READ_OK",decimals:18,poolAddress:"0xabcd",poolTokenBalanceRaw:"2000000000000000000000000",
 deltas:{poolTokenBalanceDeltaRaw:symbol==="ON"?"-300000000000000000000000": "0",fromBlock:100,toBlock:200}})),holderObservations:[]},
 chain:{asOfUtc:AT,liveTips:[{chain:"bsc",coverage:"SUCCESS",from:100,to:1300,head:1305,
 coins:[live]}, {chain:"base",coverage:"SUCCESS",from:200,to:700,head:705,coins:[{symbol:"TRUST",tokenFlows:{walletFlows:[]}}]}]}}
}
function run(){
 assert.equal(money("400000000000000000000000",18,0.1),40000);
 let a=fixture(),r=evaluate(a);
 assert.equal(r.coins.length,15);
 assert.equal(r.coins.find(x=>x.symbol==="ON").stage,"P2_MULTISOURCE_PREPARATION_REVIEW");
 assert.equal(r.newAlerts,undefined);
 const h=updateHistory(r,null);assert.equal(r.newAlerts.length,1);
 const next=evaluate(a);updateHistory(next,h);assert.equal(next.newAlerts.length,0,"Overlapping chain windows must not spam alerts");
 a=fixture();a.chain.liveTips[0].coins[0]={...live,tokenFlows:{walletFlows:[]},lpNet:{netPositionCount:0,grossLpEvents:14,zeroNetRoundTripPositions:6,netPositions:[]}};
 a.pool.coins[0].deltas.poolTokenBalanceDeltaRaw="0";
 r=evaluate(a);assert.equal(r.coins[0].stage,"P0_NO_PREPARATION_EVIDENCE","AIO-style LP round-trip must NOT signal");
 assert(r.coins[0].negativeControls.includes("LP_ROUND_TRIP_ZERO_NET"));
 a=fixture();a.spot.coins[0].change24hPct=50;
 r=evaluate(a);assert.equal(r.coins[0].stage,"LATE_ACTIVITY_NOT_EARLY","Already pumped is NOT early preparation");
 a=fixture();a.chain.asOfUtc="2026-11-13T19:00:00.000Z";
 r=evaluate(a);assert.equal(r.coins[0].stage,"P0_DATA_INCOMPLETE","Stale chain blocks early alert");
 a=fixture();a.spot.coins[0].rvol15m={status:"OK",rvol:6,volumeUSD:12000};
 a.spot.coins[0].microstructure={takerTradeSample:{lastSampleUtc:AT,last15mSampleComplete:true,last15mBuysUSD:16000,last15mSellsUSD:8000}};
 r=evaluate(a);assert.equal(r.coins[0].stage,"P3_PREPARATION_PLUS_SPOT_IGNITION_REVIEW");
 a=fixture();a.chain.liveTips[0].coins[0]={...live,tokenFlows:{walletFlows:[]}};
 r=evaluate(a);assert.equal(r.coins[0].stage,"P1_ONCHAIN_PREPARATION_WATCH","Pool-only is a weak watch not P2");
 a=fixture();a.chain.liveTips[0].missingMiddleRange={from:1,to:99};
 r=evaluate(a);assert(r.coins[0].negativeControls.includes("UNSCANNED_MIDDLE_BLOCK_GAP"),"Middle gap must be visible");
 a=fixture();
 a.wallet={asOfUtc:AT,dataFresh:true,recentLargeEoaReceipts:[{
  symbol:"B2",address:"0x"+"3".repeat(40),ownerVerified:false,receiptNetUSDApprox:20000,
  balanceSnapshotUSDApprox:25000,txProof:[{tx:"0xfeed",block:200}],firstDetectedUtc:AT}]};
 r=evaluate(a);assert.equal(r.coins.find(x=>x.symbol==="B2").stage,"P1_ONCHAIN_PREPARATION_WATCH","One-shot verified EOA receipt must be visible before persistence");
 a.spot.coins.find(x=>x.symbol==="B2").change24hPct=50;
 r=evaluate(a);assert.equal(r.coins.find(x=>x.symbol==="B2").stage,"LATE_ACTIVITY_NOT_EARLY","Late receipt must not be early");
 a.spot.coins.find(x=>x.symbol==="B2").change24hPct=4;
 a.wallet.asOfUtc="2026-11-13T19:00:00.000Z";
 r=evaluate(a);assert.equal(r.coins.find(x=>x.symbol==="B2").stage,"P0_NO_PREPARATION_EVIDENCE","Stale receipt must not alert");
 console.log(JSON.stringify({testsPassed:11,designedToCatch:["real watched outflows plus pool shift","dedup","zero-net LP roundtrip","late pump","stale source","spot ignition","single source","gap"]}));
}
run();
