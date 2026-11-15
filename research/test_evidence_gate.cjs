#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const {buildReport,SYMBOLS}=require("../evidence_gate.cjs");
const T=Date.parse("2026-11-16T01:00:00Z");
const iso=k=>new Date(T-k*60000).toISOString();
const make=()=>{
 const spot={asOfUtc:iso(2),coins:SYMBOLS.map(symbol=>({symbol,status:"OHLCV_RECEIVED",venue:"Gate Spot "+symbol+"_USDT",lastCandleUtc:iso(20),
  priceUSDT:1,change24hPct:4,change6hPct:3,rvol15m:{status:"OK",rvol:4,volumeUSD:12000},
  microstructure:{asOfUtc:iso(2),takerTradeSample:{last15mSampleComplete:true,lastSampleUtc:iso(3),last15mBuysUSD:18000,last15mSellsUSD:8000},
   orderbook:{askDepth2pctUSD:2500,askDepth5pctUSD:8000,spreadPct:0.2}},
  indexConstituents:{status:"OK",asOfUtc:iso(2),prioritySpots:[{exchange:"gateio",weight:0.3}]}
 }))};
 const prep={asOfUtc:iso(1),status:"DATA_FRESH",coins:SYMBOLS.map(symbol=>({symbol,stage:"P0_NO_PREPARATION_EVIDENCE",isFresh:true,verifiedCexOutflow:false,
  chainWindow:{coverage:"SUCCESS",from:200,to:300,gap:{from:100,to:199}},evidence:{dynamicEoaAccumulation:[],immediateEoaNetReceipts:[],lp:{removals:[]}}}))};
 const health={status:"LIVE_HEALTHY_WITH_COVERAGE_LIMITS",asOfUtc:iso(1),errors:[],quality:{bsc:{tipCoverage:"SUCCESS",historicBacklog:100},base:{tipCoverage:"SUCCESS",historicBacklog:50}}};
 const chain={asOfUtc:iso(1)};
 return {spot,prep,health,chain};
};
const data=make();data.prep.coins[0].stage="P2_MULTISOURCE_PREPARATION_REVIEW";
const x=buildReport(data,T);
assert.equal(x.coins.length,15);
assert.equal(x.status,"LIVE_SNAPSHOT_WITH_KNOWN_LIMITS");
assert.equal(x.coins[0].decision,"MULTISOURCE_EARLY_REVIEW_NOT_PROVEN");
assert.equal(x.counts.takerTape15mComplete,15);
assert.equal(x.counts.historicalChainComplete,0);
assert.equal(x.counts.verifiedCexOutflow,0);
data.spot.coins[1].microstructure.takerTradeSample.last15mSampleComplete=false;
const y=buildReport(data,T);
assert.equal(y.coins[1].coverage.takerTape15mComplete,false);
assert.equal(y.coins[1].decision,"NO_VERIFIED_EARLY_SIGNAL");
data.health.asOfUtc=iso(65);
const stale=buildReport(data,T);
assert.equal(stale.status,"STALE_OR_INCOMPLETE");
assert.equal(stale.coins[0].decision,"DATA_INCOMPLETE");
const dup=make();dup.spot.coins[1].symbol=dup.spot.coins[0].symbol;
assert.throws(()=>buildReport(dup,T),/EXACTLY 15/);
console.log("Evidence gate: 15 symbols, positive, negative, gap, stale, duplicate tests passed");
