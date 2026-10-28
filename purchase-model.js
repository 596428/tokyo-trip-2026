(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.TripPurchase=model;
})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const categories={general:'일반물품',alcohol:'주류',other:'기타 지출'};
  function localTime(now=new Date()){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }
  function validTime(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return false;
    const d=new Date(value+':00+09:00');
    return Number.isFinite(d.getTime())&&localTime(d)===value&&Number(value.slice(0,4))>=2000;
  }
  function amount(value,currency){
    const raw=typeof value==='number'?String(value):String(value??'').trim().replace(/,/g,'');
    if(!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(raw))throw new Error('금액은 0보다 큰 숫자로 입력해 주세요.');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<=0||n>100000000)throw new Error('금액 범위를 확인해 주세요.');
    if(currency==='JPY'&&!Number.isInteger(n))throw new Error('엔화 금액은 정수로 입력해 주세요.');
    return Math.round(n*100)/100;
  }
  function entry(input){
    if(!input||typeof input!=='object')throw new Error('구매 기록 형식을 확인해 주세요.');
    const {id,currency,category,purchasedAt}=input;
    if(typeof id!=='string'||!/^[\w-]{1,100}$/.test(id)||!['JPY','USD'].includes(currency)||!Object.hasOwn(categories,category)||!validTime(purchasedAt))throw new Error('구매 기록의 날짜·분류·통화를 확인해 주세요.');
    const store=String(input.store??'').trim(),memo=String(input.memo??'').trim();
    if(!store||store.length>120||memo.length>500)throw new Error('구매처를 입력해 주세요. 구매처는 120자, 메모는 500자까지입니다.');
    return {id,store,memo,currency,category,purchasedAt,amount:amount(input.amount,currency)};
  }
  function rate(value){
    if(value===''||value===null||value===undefined)return null;
    const n=Number(value);
    if(!Number.isFinite(n)||n<=0||n>1000000)throw new Error('환율은 0보다 큰 숫자로 입력해 주세요.');
    return n;
  }
  function normalize(input){
    if(!input||input.version!==1||!Array.isArray(input.entries)||input.entries.length>10000)throw new Error('구매 기록 파일 형식을 확인해 주세요.');
    const entries=input.entries.map(entry);
    if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new Error('중복된 구매 기록 ID입니다.');
    return {version:1,entries,jpyPerUsd:rate(input.jpyPerUsd)};
  }
  function empty(){return {version:1,entries:[],jpyPerUsd:null};}
  function merge(current,incoming){
    const a=normalize(current),b=normalize(incoming),byId=new Map(a.entries.map(e=>[e.id,e]));
    b.entries.forEach(e=>byId.set(e.id,e));
    return normalize({version:1,entries:[...byId.values()],jpyPerUsd:b.jpyPerUsd??a.jpyPerUsd});
  }
  function totals(log){
    const clean=normalize(log),sums={all:{JPY:0,USD:0},general:{JPY:0,USD:0},alcohol:{JPY:0,USD:0},other:{JPY:0,USD:0}};
    for(const e of clean.entries){const cents=Math.round(e.amount*100);sums.all[e.currency]+=cents;sums[e.category][e.currency]+=cents;}
    return Object.fromEntries(Object.entries(sums).map(([key,value])=>[key,{JPY:value.JPY/100,USD:value.USD/100,usdReference:clean.jpyPerUsd?value.JPY/100/clean.jpyPerUsd+value.USD/100:null}]));
  }
  return {categories,localTime,validTime,entry,normalize,empty,merge,totals,rate};
});
