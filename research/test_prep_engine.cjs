#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const {evaluate,updateHistory,money,nonIndependentWalletReason,proofClass}=require("../prep_engine.cjs");
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
 // Regression: known exchange EOA must never generate private-whale P1.
 const hot={chain:"bsc",address:"0x53f78a071d04224b8e254e243fffc6d9f2f3fa23"};
 assert.equal(nonIndependentWalletReason(hot,"CYS"),"KUCOIN_LABELED_EXCHANGE_WALLET_NOT_PRIVATE_ACCUMULATION");
 assert.equal(nonIndependentWalletReason({...hot,chain:"base"},"TRUST"),null,"Chain-specific labels must not leak to Base");
 assert.equal(nonIndependentWalletReason({chain:"bsc",address:"0xadfffc33cdc9970349cbcea3d73ec343d6ed116d"},"COLLECT"),"BITGET_LINKED_CUSTODY_OWNERSHIP_UNRESOLVED");
 assert.equal(nonIndependentWalletReason({chain:"bsc",address:"0xed9ab5bc05a0152b9dc2f7902e8369af7bc18771"},"COLLECT"),"BITGET_LABELED_EXCHANGE_WALLET_NOT_PRIVATE_ACCUMULATION");
 a=fixture();a.wallet={asOfUtc:AT,dataFresh:true,candidates:[{symbol:"CYS",chain:"bsc",address:hot.address,eoaUnverified:true,netRetainedIncreaseUSD:95000,firstProof:{txProof:[{from:"0x"+"3".repeat(40)}]}}]};
 r=evaluate(a);assert.equal(r.coins.find(x=>x.symbol==="CYS").stage,"P0_NO_PREPARATION_EVIDENCE","Known CEX must not create P1");
 assert(r.coins.find(x=>x.symbol==="CYS").negativeControls.includes("NON_INDEPENDENT_CUSTODY_OR_EXCHANGE_WALLET_EXCLUDED_FROM_WHALE_COUNT"));
 a.wallet.candidates[0].address="0x"+"a".repeat(40);
 r=evaluate(a);assert.equal(r.coins.find(x=>x.symbol==="CYS").stage,"P1_ONCHAIN_PREPARATION_WATCH","Unknown EOA still creates low-confidence review");
 a.wallet.candidates[0].firstProof={txProof:[{from:"0x5994814f2c4040b863a0125a45de152a8c2a4dec"}]};
 r=evaluate(a);assert(r.coins.find(x=>x.symbol==="CYS").negativeControls.includes("DEX_ROUTER_SOURCE_IS_NOT_CEX_WITHDRAWAL"),"DEX funded EOA is not bourse withdrawal");
  // Real radar regression: 2026-11-16 B2/CYS Gate Hot -> Gate 5 must NOT count as external accumulation.
 const gateHot="0x0d0707963952f2fba59dd06f2b425ace40b492fe",gate5="0xc882b111a75c0c657fc507c04fbfcd2cc984f071";
 assert.equal(proofClass("B2",gateHot,gate5),"SAME_EXCHANGE_INTERNAL_TRANSFER");
 assert.equal(proofClass("CYS",gateHot,gate5),"SAME_EXCHANGE_INTERNAL_TRANSFER");
 assert.equal(proofClass("TRUST",gateHot,gate5),"UNKNOWN_OWNERSHIP_ON_BASE","Never copy BSC labels to Base");
 assert.equal(proofClass("HANA",gateHot,"0x"+"b".repeat(40)),"POSSIBLE_CEX_TO_UNKNOWN_OWNER","Unknown may still be a cold wallet");
 assert.equal(proofClass("DOS","0x5994814f2c4040b863a0125a45de152a8c2a4dec","0x"+"a".repeat(40)),"DEX_ROUTER_TRANSFER_NOT_CEX_WITHDRAWAL");
 assert.equal(nonIndependentWalletReason({chain:"bsc",address:gate5},"B2"),"GATE_LABELED_EXCHANGE_WALLET_NOT_PRIVATE_ACCUMULATION");
 a=fixture();a.wallet={asOfUtc:AT,dataFresh:true,recentLargeEoaReceipts:[{symbol:"B2",chain:"bsc",address:gate5,ownerVerified:false,receiptNetUSDApprox:554303.7,balanceSnapshotUSDApprox:555000,txProof:[{tx:"0x"+"a".repeat(64),from:gateHot,to:gate5,block:200}]}]};
 r=evaluate(a);
 assert.equal(r.coins.find(x=>x.symbol==="B2").stage,"P0_NO_PREPARATION_EVIDENCE","Gate internal $554k cannot create P1");
 assert.equal(r.coins.find(x=>x.symbol==="B2").evidence.immediateReceiptTransferAttribution[0].sourceClassifications[0].category,"SAME_EXCHANGE_INTERNAL_TRANSFER");
 assert.equal(nonIndependentWalletReason({chain:"base",address:"0x4cad1efbfd5f0848e0c3c14fab23f92b2fa81f17"},"TRUST"),"BASE_BITGET_DEPOSIT_CUSTODY_RISK_THIRD_PARTY_LABEL");
 assert.equal(proofClass("COLLECT","0x238a358808379702088667322f80ac48bad5e6c4","0x"+"2".repeat(40)),"DEX_ROUTER_TRANSFER_NOT_CEX_WITHDRAWAL");
 console.log(JSON.stringify({testsPassed:29,designedToCatch:["real watched outflows plus pool shift","dedup","zero-net LP roundtrip","late pump","stale source","spot ignition","single source","gap"]}));
}
run();
