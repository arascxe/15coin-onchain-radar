#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path");
const p=path.join(__dirname,"radar_data","receipt_probe.json"),URL="https://bsc-dataseed.bnbchain.org";
const manager="0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b";
const MOD="0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const BSB="0x26a8e4591b7a0efcd45a577ad0d54aa64a99efaf2546ad4d5b0454c99eb70eab";
const pool="0xc1a780989734a0e5df875cebe410748562e1c5e6"; // B2 PancakeV3
const res={asOfUtc:new Date().toISOString(),method:"eth_getBlockReceipts",testOnly:true,chainId:56};
async function rpc(method,params){const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);try{const response=await fetch(URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:c.signal});if(!response.ok)throw Error("HTTP "+response.status);const x=await response.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result}finally{clearTimeout(t)}}
async function main(){try{const head=Number(BigInt(await rpc("eth_blockNumber",[])));const check=head-15;res.head=head;res.testBlock=check;
const block=await rpc("eth_getBlockByNumber",["0x"+check.toString(16),false]);res.blockTimestampUtc=block?.timestamp?new Date(Number(BigInt(block.timestamp))*1000).toISOString():null;
const receipts=await rpc("eth_getBlockReceipts",["0x"+check.toString(16)]);if(!Array.isArray(receipts))throw Error("missing block receipts");
res.status="READ_OK";res.receipts=receipts.length;res.logsCount=receipts.reduce((n,x)=>n+(x.logs?.length||0),0);
res.targetLogs=receipts.flatMap(x=>x.logs||[]).filter(l=>String(l.address).toLowerCase()===manager||String(l.address).toLowerCase()===pool).slice(0,8).map(l=>({tx:l.transactionHash,topic0:l.topics?.[0],poolId:l.topics?.[1],mod:Boolean(String(l.topics?.[0]).toLowerCase()===MOD&&String(l.topics?.[1]).toLowerCase()===BSB)}));
const old=Math.max(1,head-300);try{const oldCall=await rpc("eth_call",[{to:pool,data:"0x1a686502"},"0x"+old.toString(16)]);res.historyCallStatus=/^0x[0-9a-f]+$/i.test(oldCall||"")?"READ_OK":"EMPTY";res.historyBlock=old}catch(e){res.historyCallStatus="FAILED";res.historyError=String(e.message).slice(0,180)}
}catch(e){res.status="FAILED";res.error=String(e.message).slice(0,200)}
fs.writeFileSync(p,JSON.stringify(res,null,2)+"\n");console.log(JSON.stringify(res));}
main().catch(e=>{console.error(e);process.exitCode=1});