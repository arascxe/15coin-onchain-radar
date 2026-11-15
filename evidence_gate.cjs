#!/usr/bin/env node
"use strict";
/*
 Independent fail-closed 15-coin coverage and evidence gate.
 Does not predict profit, place trades, or mistake a recent scan for full historical coverage.
 Pure buildReport() is regression-tested with both positive and negative controls.
*/
const fs=require("node:fs"),path=require("node:path");
const ROOT=path.join(__dirname,"radar_data");
const SYMBOLS=["ON","DOS","HANA","COLLECT","LIGHT","APR","IN","TRUST","B2","CYS","STBL","BSB","AIO","STAR","LYN"];
const number=x=>x==null||x===""?null:(Number.isFinite(Number(x))?Number(x):null);
function fresh(ts,now,maxMinutes){
 const t=Date.parse(ts||""),delta=now-t;
 return Number.isFinite(t)&&delta>=-60000&&delta<=maxMinutes*60000;
}
function buildReport({spot,prep,health,chain},now=Date.now()){
 if(!(spot&&prep&&health&&chain))throw Error("Missing evidence file");
 const seen=new Set(SYMBOLS);
 if(SYMBOLS.length!==15||seen.size!==15)throw Error("15-symbol universe invalid");
 if(!Array.isArray(spot.coins)||!Array.isArray(prep.coins))throw Error("No coin arrays");
 const extra=[...spot.coins,...prep.coins].filter(x=>!seen.has(x.symbol));
 if(extra.length||spot.coins.length!==15||prep.coins.length!==15||
  new Set(spot.coins.map(x=>x.symbol)).size!==15||new Set(prep.coins.map(x=>x.symbol)).size!==15)
  throw Error("Coin coverage must be EXACTLY 15 unique symbols");
 const healthy=health.status==="LIVE_HEALTHY_WITH_COVERAGE_LIMITS"&&
  (health.errors||[]).length===0&&fresh(health.asOfUtc,now,30);
 const spotTimeValid=fresh(spot.asOfUtc,now,30);
 const prepTimeValid=fresh(prep.asOfUtc,now,30)&&prep.status==="DATA_FRESH";
 const chainTimeValid=fresh(chain.asOfUtc,now,30);
 const symbols=SYMBOLS.map(symbol=>{
  const p=spot.coins.find(x=>x.symbol===symbol),e=prep.coins.find(x=>x.symbol===symbol);
  const venue=p.venue||null,exchange=venue?.startsWith("Gate Spot")?"gateio":venue?.startsWith("Bitget Spot")?"bitget":venue?.startsWith("GeckoTerminal")?"dex":null;
  const chainName=symbol==="TRUST"?"base":"bsc",quality=health.quality?.[chainName]||{};
  const freshTip=healthy&&chainTimeValid&&e.chainWindow?.coverage==="SUCCESS"&&quality.tipCoverage==="SUCCESS";
  const historicBacklog=number(quality.historicBacklog);
  const historicalComplete=freshTip&&historicBacklog===0&&!e.chainWindow?.gap;
  const ohlcv=spotTimeValid&&p.status==="OHLCV_RECEIVED"&&p.rvol15m?.status==="OK"&&
   fresh(p.lastCandleUtc,now,40); // candle OPEN timestamp, not the close
  const tape=p.microstructure?.takerTradeSample;
  const tapeComplete=ohlcv&&!!tape&&tape.last15mSampleComplete===true&&
   fresh(tape.lastSampleUtc,now,12)&&Number.isFinite(tape.last15mBuysUSD)&&
   Number.isFinite(tape.last15mSellsUSD);
  const book=p.microstructure?.orderbook;
  const bookCurrent=ohlcv&&!!book&&Number.isFinite(book.spreadPct)&&
   (Number.isFinite(book.askDepth2pctUSD)||Number.isFinite(book.askDepth5pctUSD))&&
   fresh(p.microstructure?.asOfUtc,now,15);
  const index=p.indexConstituents;
  const indexCurrent=index?.status==="OK"&&fresh(index.asOfUtc,now,40);
  const priorities=indexCurrent?index.prioritySpots:[];
  const primaryWeight=priorities.find(v=>v.exchange===exchange)?.weight??null;
  const price24=number(p.change24hPct);
  const price6=number(p.change6hPct);
  const early=price24!==null&&price6!==null&&price24>=-10&&price24<=15&&price6<=15;
  const quoteVolume=number(p.rvol15m?.volumeUSD);
  const buyFlow=tapeComplete&&early&&quoteVolume>=5000&&tape.last15mBuysUSD>=10000&&
   tape.last15mBuysUSD>=1.4*Math.max(1,tape.last15mSellsUSD);
  const wallet=(e.evidence?.dynamicEoaAccumulation||[]).length+
   (e.evidence?.immediateEoaNetReceipts||[]).length;
  const lpRemovals=(e.evidence?.lp?.removals||[]).length;
  const prepFresh=prepTimeValid&&e.isFresh===true&&freshTip;
  const stage=e.stage||"UNKNOWN";
  const suspiciousPrep=prepFresh&&/^P[123]_/.test(stage);
  const spotReview=healthy&&buyFlow&&bookCurrent&&book.spreadPct<=1;
  let decision="NO_VERIFIED_EARLY_SIGNAL";
  if(!healthy||!spotTimeValid||!prepTimeValid||!chainTimeValid||!ohlcv||!freshTip)
   decision="DATA_INCOMPLETE";
  else if(suspiciousPrep&&spotReview)decision="MULTISOURCE_EARLY_REVIEW_NOT_PROVEN";
  else if(suspiciousPrep)decision="ONCHAIN_PREPARATION_REVIEW_NOT_PROVEN";
  else if(spotReview)decision="SPOT_BUY_PRESSURE_REVIEW_NO_CHAIN_CONFIRMATION";
  // Never elevate review labels into confirmation: no independently verified CEX ownership,
  // no replayed orderbook replenishment, incomplete cross-exchange tape.
  const limitations=[];
  if(!ohlcv)limitations.push("SPOT_OHLCV_MISSING_OR_STALE");
  if(!tapeComplete)limitations.push("NO_COMPLETE_FRESH_15M_TAKER_TAPE");
  if(!bookCurrent)limitations.push("NO_FRESH_FULLY_MEASURED_BOOK");
  if(!indexCurrent)limitations.push("INDEX_VENUE_PRIORITY_UNKNOWN");
  if(!freshTip)limitations.push("CHAIN_LIVE_TIP_NOT_VERIFIED");
  if(!historicalComplete)limitations.push("UNSCANNED_HISTORICAL_BLOCK_GAP");
  if(e.verifiedCexOutflow!==true)limitations.push("CEX_NET_OUTFLOW_NOT_ATTRIBUTED");
  if(!spotReview)limitations.push("INDEPENDENT_SPOT_BUY_PRESSURE_NOT_CONFIRMED");
  return {
   symbol,decision,preparationStage:stage,signalResearchOnly:true,
   coverage:{ohlcv:!!ohlcv,takerTape15mComplete:!!tapeComplete,orderbookSnapshot:!!bookCurrent,
    priorityIndexCurrent:!!indexCurrent,liveChainTip:!!freshTip,historicalChainComplete:!!historicalComplete,
    verifiedCexOutflow:e.verifiedCexOutflow===true,
    independentSpotBuyReview:!!spotReview,orderbookReplenishmentMeasured:false},
   venue,chain:chainName,observations:{
    priceUSDT:number(p.priceUSDT),change24hPct:price24,rvol15m:number(p.rvol15m?.rvol),
    last15mBuysUSD:tapeComplete?number(tape.last15mBuysUSD):null,
    last15mSellsUSD:tapeComplete?number(tape.last15mSellsUSD):null,
    askDepth2pctUSD:bookCurrent?number(book.askDepth2pctUSD):null,
    indexAsOfUtc:indexCurrent?index.asOfUtc:null,
    indexSpotPriority:priorities,
    trackedSpotIndexWeight:primaryWeight,
    historicMissingBlocks:historicBacklog,
    unverifiedEOAWithGrowth:wallet,netLpRemovalPositions:lpRemovals,
    evidenceCodes:e.signalReasons||[]},
   limitations,
   evidenceProvenance:{spotAsOfUtc:spot.asOfUtc,prepAsOfUtc:prep.asOfUtc,
    healthAsOfUtc:health.asOfUtc,mostRecentTapeUtc:tape?.lastSampleUtc||null,
    chainTipFrom:e.chainWindow?.from??null,chainTipTo:e.chainWindow?.to??null}
  };
 });
 const count=key=>symbols.filter(x=>x.coverage[key]===true).length;
 const decisions={};for(const s of symbols)decisions[s.decision]=(decisions[s.decision]||0)+1;
 return {schema:"15coin-evidence-coverage-v1",asOfUtc:new Date(now).toISOString(),status:healthy&&spotTimeValid&&prepTimeValid&&chainTimeValid?"LIVE_SNAPSHOT_WITH_KNOWN_LIMITS":"STALE_OR_INCOMPLETE",
   objective:"Evidence review and data coverage for exactly 15 symbols; NO validated 5x/10x predictor or trading signal",
   meaning:"All coverage fields explicitly typed. UNKNOWN never equals no movement or verified preparation.",
   counts:{requested:15,ohlcv:count("ohlcv"),takerTape15mComplete:count("takerTape15mComplete"),
    orderbookSnapshot:count("orderbookSnapshot"),priorityIndexCurrent:count("priorityIndexCurrent"),
    liveChainTip:count("liveChainTip"),historicalChainComplete:count("historicalChainComplete"),
    verifiedCexOutflow:count("verifiedCexOutflow"),independentSpotBuyReview:count("independentSpotBuyReview"),
    decisions},coins:symbols};
}
function main(){
 const read=name=>JSON.parse(fs.readFileSync(path.join(ROOT,name),"utf8"));
 const input={spot:read("spot_latest.json"),prep:read("prep_latest.json"),
  health:read("health_latest.json"),chain:read("latest.json")};
 const output=buildReport(input);
 const file=path.join(ROOT,"coverage_latest.json"),tmp=file+".tmp";
 fs.writeFileSync(tmp,JSON.stringify(output,null,2)+"\n");fs.renameSync(tmp,file);
 console.log(JSON.stringify({status:output.status,asOfUtc:output.asOfUtc,counts:output.counts,
  candidates:output.coins.filter(x=>!/^(NO_VERIFIED|DATA_INCOMPLETE)/.test(x.decision)).map(x=>({symbol:x.symbol,decision:x.decision}))},null,2));
 if(output.status!=="LIVE_SNAPSHOT_WITH_KNOWN_LIMITS")process.exitCode=2;
}
if(require.main===module)main();
module.exports={buildReport,SYMBOLS,fresh};
