#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const {analyze,SYMBOLS,WALLETS}=require("../exchange_inventory.cjs");
const make=(raw,at,block)=>({asOfUtc:at,coins:SYMBOLS.map(symbol=>{
 const chain=symbol==="TRUST"?"base":"bsc";
 return {symbol,chain,token:"0x"+"a".repeat(40),block,decimals:18,priceUSDT:0.5,
  wallets:Object.fromEntries(WALLETS.filter(w=>w.chain===chain).map(w=>[w.address,{status:"OK",raw:String(raw)}]))};
})});
const a=make("100000000000000000000","2026-11-16T00:00:00Z",100),b=make("90000000000000000000","2026-11-16T00:20:00Z",200);
const history={runs:[{asOfUtc:a.asOfUtc,coins:a.coins.map(x=>({...x,status:"FULL"}))}]};
let report=analyze(a,{runs:[]});
assert.equal(report.counts.coins,15);
assert.equal(report.counts.withComparableDelta,0,"First snapshot must not invent an outflow");
report=analyze(b,history);
assert.equal(report.counts.full,15);
assert.equal(report.counts.withComparableDelta,15);
assert.equal(report.coins.find(x=>x.symbol==="ON").exchanges[0].deltaToken,-20);
assert.equal(report.coins.find(x=>x.symbol==="TRUST").exchanges[0].deltaToken,-10);
assert.equal(report.coins.find(x=>x.symbol==="ON").exchanges[0].deltaUSDAtCurrentPrice,-10);
assert.equal(report.counts.labeledWalletDeclines,15);
const missing=make("90000000000000000000","2026-11-16T00:30:00Z",201);
missing.coins[0].wallets[WALLETS[0].address]={status:"FAILED",raw:null};
report=analyze(missing,history);
assert.equal(report.coins[0].status,"PARTIAL");
assert.equal(report.coins[0].exchanges[0].deltaToken,null);
const old=make("90000000000000000000","2026-11-16T06:00:00Z",300);
report=analyze(old,history);
assert.equal(report.counts.withComparableDelta,0,"Stale comparison prohibited");
console.log("Exchange inventory: no-baseline, 15 tokens, two-chain, aggregate signs, read failure and stale controls PASS");
