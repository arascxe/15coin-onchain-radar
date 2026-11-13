#!/usr/bin/env node
"use strict";
/*
 Fifteen-coin PRE-IGNITION evidence classifier. Read-only, no trades.
 P0/P1/P2/P3 describe observed evidence, NEVER a forecast of 10x.
 This module does NOT label the monitored wallet addresses as verified CEXs.
*/
const fs=require("node:fs"),path=require("node:path");
const DATA=path.join(__dirname,"radar_data");
const SYMBOLS=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
const HOUR=3600000,DAY=24*HOUR,ROUND=(n,d=3)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
function read(file){return JSON.parse(fs.readFileSync(path.join(DATA,file),"utf8"))}
function save(file,j){const p=path.join(DATA,file),tmp=p+".tmp";fs.writeFileSync(tmp,JSON.stringify(j,null,2)+"\n");fs.renameSync(tmp,p)}
function num(x){const n=Number(x);return Number.isFinite(n)?n:null}
function money(raw,dec,price){
 if(raw==null||!Number.isInteger(dec)||dec<0||dec>30||!(price>0))return null;
 try{let x=BigInt(raw),sign=x<0n?-1:1;if(x<0n)x=-x;const d=10n**BigInt(dec);const n=sign*(Number(x/d)+Number(x%d)/Number(d))*price;return Number.isFinite(n)?n:null}catch{return null}
}
function fresh(t,now,minutes=20){
 const age=now-Date.parse(t||"");return Number.isFinite(age)&&age>=-60000&&age<minutes*60000;
}
function highestRecentChain(chain,symbol){
 // Find a recent tip for this coin; if a tip is present, never substitute the OLD backfill lane.
 const targetChain=symbol==="TRUST"?"base":"bsc";
 const x=(chain.liveTips||[]).find(t=>t.chain===targetChain);
 if(x)return {source:"LIVE_TIP",coverage:x.coverage,from:x.from,to:x.to,head:x.head,gap:x.missingMiddleRange,coin:x.coins?.find(c=>c.symbol===symbol),windowStatus:x.coverage};
 const c=chain.chains?.find(t=>t.chain===targetChain),p=chain.coins?.find(y=>y.symbol===symbol);
 const headDistance=(c?.head??0)-(c?.to??0);
 // No fresh fallback if old cursor is more than 15 minutes behind.
 const maxBlocks=targetChain==="bsc"?1200:450;
 if(c&&(c.coverage==="SUCCESS"||c.coverage==="NO_NEW_BLOCKS")&&headDistance<=maxBlocks)return{source:"NEAR_HEAD_BACKFILL",coverage:c.coverage,from:c.from,to:c.to,head:c.head,gap:null,coin:p,windowStatus:c.coverage};
 return{source:"NO_CURRENT_CHAIN_WINDOW",coverage:c?.coverage||"FAILED",from:c?.from,to:c?.to,head:c?.head,gap:null,coin:null,windowStatus:"NO_RECENT_CHAIN_COVERAGE"};
}
function classify({symbol,spot,chain,pool,now}){
 const p=spot.coins?.find(x=>x.symbol===symbol),v=pool.coins?.find(x=>x.symbol===symbol);
 const holder=pool.holderObservations?.filter(x=>x.symbol===symbol)||[];
 const live=highestRecentChain(chain,symbol),onchain=live.coin;
 const spotFresh=fresh(spot.asOfUtc,now),poolFresh=fresh(pool.asOfUtc,now),chainFresh=fresh(chain.asOfUtc,now);
 const spotUsable=spotFresh&&p?.status==="OHLCV_RECEIVED"&&p.priceUSDT>0;
 const price=spotUsable?p.priceUSDT:null;
 const price24=spotUsable?num(p.change24hPct):null,price6=spotUsable?num(p.change6hPct):null,price1=spotUsable?num(p.close1hChangePct):null;
 const late=(price24!=null&&price24>=25)||(price6!=null&&price6>=20)||(price1!=null&&price1>=12);
 const preBreakout=!late&&price24!=null&&price6!=null&&price1!=null;
 const dec=poolFresh?(Number.isInteger(v?.decimals)?v.decimals:(Number.isInteger(pool.tokenDecimals?.[symbol])?pool.tokenDecimals[symbol]:null)):null;
 const code=[],counter=[];
 const evidences={};
 const flowValid=chainFresh&&["SUCCESS","PARTIAL"].includes(live.coverage)&&!!onchain;
 if(live.gap)counter.push("UNSCANNED_MIDDLE_BLOCK_GAP");
 if(!flowValid)counter.push("NO_VERIFIED_RECENT_TRANSFER_WINDOW");
 if(!spotUsable)counter.push("SPOT_DATA_MISSING_OR_STALE");
 if(!poolFresh)counter.push("POOL_SNAPSHOT_MISSING_OR_STALE");
 if(price24==null)counter.push("24H_PRICE_HISTORY_UNAVAILABLE");
 if(late)counter.push("PRICE_ALREADY_EXPANDED_OR_LATE");
 const v3=(poolFresh&&v?.status==="READ_OK")?v:null;
 const delta=v3?.deltas?.poolTokenBalanceDeltaRaw??null;
 const prior=delta!=null?BigInt(v3.poolTokenBalanceRaw)-BigInt(delta):null;
 const poolPct=prior!=null&&prior>0n?100*Number(BigInt(delta))/Number(prior):null;
 const poolUSD=money(delta,dec,price);
 const poolDepletion=v3&&poolUSD!=null&&poolPct!=null&&poolUSD<=-10000&&poolPct<=-2;
 if(poolDepletion)code.push("DEX_POOL_INVENTORY_DECLINE");
 evidences.poolBalance=v3?{pool:v3.poolAddress,fromBlock:v3.deltas?.fromBlock,toBlock:v3.deltas?.toBlock,rawDelta:delta,deltaPct:ROUND(poolPct),deltaUSD:ROUND(poolUSD,2),interpretation:"Pool token balance decreased. Swaps, LP changes, and other pool operations indistinguishable without matched receipts."}:null;
 // Raw block receipts are a separate proof of TRANSFER, but do not prove which entity controlled the funds.
 const seedFlows=flowValid?(onchain.tokenFlows?.walletFlows||[]):[];
 const watchMovements=seedFlows.map(w=>({
  address:w.address,label:w.thirdPartyLabel,identityVerified:false,
  netOutUSD:money(w.rawNetOut,dec,price),netOutRaw:w.rawNetOut,
  rawNonPoolOut:w.rawNonPoolOut,recipientCount:w.distinctNonPoolRecipients,
  txProof:w.directProof||[]
 })).filter(w=>w.netOutUSD!=null&&w.netOutUSD>=25000&&w.recipientCount>=1&&w.txProof.length>0);
 if(watchMovements.length)code.push("WATCHED_ADDRESS_OUTFLOW_TX");
 evidences.watchedAddressOutflows=watchMovements;
 const significantHolder=poolFresh?holder.filter(h=>h.status==="READ_OK"&&h.deltaRaw!=null).map(h=>({
  address:h.address,label:h.thirdPartyLabel,verifiedOwner:h.identityVerified===true,
  balanceDeltaUSD:money(h.deltaRaw,dec,price),rawDelta:h.deltaRaw,fromBlock:h.fromBlock,toBlock:h.toBlock
 })).filter(h=>h.balanceDeltaUSD!=null&&Math.abs(h.balanceDeltaUSD)>=25000):[];
 evidences.watchedBalanceChanges=significantHolder;
 if(significantHolder.length)code.push("WATCHED_ADDRESS_BALANCE_CHANGE");
 const lpNet=flowValid?onchain.lpNet:null;
 const lpRemoval=(lpNet?.netPositions||[]).filter(x=>{try{return BigInt(x.netLiquidityDeltaRaw)<0n}catch{return false}});
 const lpAdds=(lpNet?.netPositions||[]).filter(x=>{try{return BigInt(x.netLiquidityDeltaRaw)>0n}catch{return false}});
 if(lpRemoval.length)code.push("NET_LP_POSITION_REMOVAL");
 if(lpAdds.length)code.push("NET_LP_POSITION_ADDITION");
 evidences.lp={
  eventCount:lpNet?.grossLpEvents??null,netPositions:lpNet?.netPositionCount??null,
  zeroNetRoundTrips:lpNet?.zeroNetRoundTripPositions??null,
  removals:lpRemoval.slice(0,8),additions:lpAdds.slice(0,8),
  caveat:"LP position delta is liquidity-unit change within the scanned window, NOT USD market depth or confirmed directional intent."
 };
 const rawPoolFlow=flowValid?onchain.tokenFlows?.poolFlow:null;
 evidences.poolTransferFlow=rawPoolFlow?{...rawPoolFlow,netOutUSD:ROUND(money(rawPoolFlow.rawNetOut,dec,price),2)}:null;
 const micro=spotUsable?p.microstructure:null,trade=micro?.takerTradeSample;
 const tradeFresh=spotUsable&&fresh(trade?.lastSampleUtc,now,12);
 const buyFlow=tradeFresh&&trade?.last15mSampleComplete===true&&
   trade.last15mBuysUSD>=10000&&trade.last15mBuysUSD>=1.4*Math.max(1,trade.last15mSellsUSD);
 const spotIgnition=spotUsable&&p.rvol15m?.status==="OK"&&p.rvol15m.rvol>=3&&
   p.rvol15m.volumeUSD>=5000&&price1!=null&&price1>=0&&price1<=12;
 if(buyFlow)code.push("INDEPENDENT_GATE_SPOT_TAKER_BUY");
 if(spotIgnition)code.push("SPOT_FIRST_IGNITION_CANDIDATE");
 evidences.spot={venue:p?.venue||null,priceUSDT:price,price24hPct:ROUND(price24),price6hPct:ROUND(price6),price1hPct:ROUND(price1),
   rvol15m:p?.rvol15m?.rvol??null,volume15mUSD:p?.rvol15m?.volumeUSD??null,
   takerBuysUSD:tradeFresh?trade?.last15mBuysUSD:null,takerSellsUSD:tradeFresh?trade?.last15mSellsUSD:null,
   takerSnapshotFresh:tradeFresh,spotVerdict:p?.verdict??null};
 // Stage P2 needs meaningful movement involving two non-identical economic locations,
 // and the onchain address ownership and causal interpretation remain UNVERIFIED.
 const walletEvidence=watchMovements.length>0||significantHolder.some(x=>x.balanceDeltaUSD<=-25000);
 const poolEvidence=poolDepletion||lpRemoval.length>0;
 const multi=walletEvidence&&poolEvidence;
 const preliminary=walletEvidence||poolEvidence||lpAdds.length>0;
 let stage="P0_NO_PREPARATION_EVIDENCE";
 if(!spotUsable||!chainFresh||!poolFresh)stage="P0_DATA_INCOMPLETE";
 else if(late)stage=preliminary||spotIgnition?"LATE_ACTIVITY_NOT_EARLY":"P0_NO_PREPARATION_EVIDENCE";
 else if(preBreakout&&multi&&spotIgnition&&buyFlow)stage="P3_PREPARATION_PLUS_SPOT_IGNITION_REVIEW";
 else if(preBreakout&&multi)stage="P2_MULTISOURCE_PREPARATION_REVIEW";
 else if(preBreakout&&preliminary)stage="P1_ONCHAIN_PREPARATION_WATCH";
 else if(spotIgnition)stage="SPOT_ONLY_NOT_PREPARATION";
 else if(!preBreakout)stage="P0_NO_24H_PRICE_CONTEXT";
 if(lpNet?.grossLpEvents>0&&lpNet.netPositionCount===0)counter.push("LP_ROUND_TRIP_ZERO_NET");
 if(significantHolder.length&&!watchMovements.length)counter.push("WALLET_BALANCE_NOT_TRACED_TO_DIRECT_TX_IN_RECENT_WINDOW");
 if(poolDepletion&&!walletEvidence)counter.push("POOL_MOVEMENT_ONLY_NOT_INDEPENDENT_ACCUMULATION");
 if(buyFlow&&!multi)counter.push("BUY_FLOW_NOT_PROOF_OF_PREPARATION");
 const alertEligible=["P1_ONCHAIN_PREPARATION_WATCH","P2_MULTISOURCE_PREPARATION_REVIEW","P3_PREPARATION_PLUS_SPOT_IGNITION_REVIEW"].includes(stage);
 return {symbol,stage,isFresh:spotFresh&&chainFresh&&poolFresh,eligibleForEarlyResearch:preBreakout,
  signalResearchOnly:true,verifiedCexOutflow:false,predicted10x:false,observedAtUtc:new Date(now).toISOString(),
  earlyCandidate:alertEligible,signalReasons:code,negativeControls:counter,
  chainWindow:{source:live.source,coverage:live.coverage,from:live.from,to:live.to,head:live.head,gap:live.gap},
  evidence:evidences};
}
function evaluate(input){
 const now=Date.parse(input.nowUtc||new Date().toISOString());
 const coins=SYMBOLS.map(symbol=>classify({...input,symbol,now}));
 return {schema:"15coin-preparation-evidence-v1",asOfUtc:new Date(now).toISOString(),
  status:coins.every(x=>x.isFresh)?"DATA_FRESH":"PARTIAL_OR_STALE_DATA",
  objective:"Observational early preparation hypothesis screening on exactly 15 preselected symbols. Not a validated predictive or profitable signal.",
  caveats:["Three watched addresses have UNVERIFIED owner attribution; transfer out does NOT establish institution-wide CEX reserves",
  "Pool balances may change due to swaps or liquidity movements. LP net liquidity-unit deltas are NOT equivalent to sell-side USD market depth",
  "P2/P3 are review hypotheses, not proof of a future pump; thresholds are unvalidated", 
  "Missed blocks and missing historical wallet coverage are never interpreted as no transactions"],
  counts:{coins:coins.length,currentData:coins.filter(c=>c.isFresh).length,p1:coins.filter(c=>c.stage.startsWith("P1_")).length,
    p2:coins.filter(c=>c.stage.startsWith("P2_")).length,p3:coins.filter(c=>c.stage.startsWith("P3_")).length,late:coins.filter(c=>c.stage.startsWith("LATE_")).length},
  coins};
}
function updateHistory(report,history){
 const asof=Date.parse(report.asOfUtc),older=asof-45*DAY;
 const h=history&&history.schema==="15coin-preparation-events-v1"?history:{schema:"15coin-preparation-events-v1",events:[],observations:[]};
 h.events=h.events.filter(e=>Date.parse(e.firstSeenUtc)>=older);
 h.observations=h.observations.filter(e=>Date.parse(e.atUtc)>=asof-14*DAY);
 const newAlerts=[];
 for(const c of report.coins){
  if(!c.earlyCandidate)continue;
  const prev=[...h.events].reverse().find(e=>e.symbol===c.symbol&&e.stage===c.stage);
  // Onchain evidence in liveTip overlaps on consecutive scans: do NOT emit it repeatedly.
  if(prev&&asof-Date.parse(prev.firstSeenUtc)<12*HOUR)continue;
  const event={id:c.symbol+"_"+asof+"_"+c.stage,symbol:c.symbol,stage:c.stage,
   firstSeenUtc:report.asOfUtc,venue:c.evidence.spot.venue,priceAtFirstSeen:c.evidence.spot.priceUSDT,
   reasons:c.signalReasons,proofWindow:c.chainWindow,negativeControls:c.negativeControls,
   caveat:"Research alert only. CEX attribution unverified. No trading recommendation.",
   followup:{},ruleVersion:"preparation-v1-unvalidated"};
  h.events.push(event);newAlerts.push(event);
 }
 h.events=h.events.slice(-800);
 h.observations.push({atUtc:report.asOfUtc,stages:Object.fromEntries(report.coins.map(c=>[c.symbol,c.stage]))});
 h.observations=h.observations.slice(-1344);
 report.newAlerts=newAlerts;report.previousAlertCount=h.events.length;
 return h;
}
function main(){
 const input={chain:read("latest.json"),spot:read("spot_latest.json"),pool:read("pool_state_latest.json"),nowUtc:new Date().toISOString()};
 const report=evaluate(input);
 let old=null;try{old=read("prep_history.json")}catch{}
 const history=updateHistory(report,old);
 save("prep_latest.json",report);save("prep_history.json",history);
 console.log(JSON.stringify({status:report.status,counts:report.counts,newAlerts:report.newAlerts?.map(e=>({symbol:e.symbol,stage:e.stage,firstSeenUtc:e.firstSeenUtc})),problems:report.coins.filter(c=>!c.isFresh).map(c=>c.symbol)}));
}
module.exports={evaluate,classify,updateHistory,money};
if(require.main===module)main();
