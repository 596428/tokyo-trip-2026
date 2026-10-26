(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.TripMap=model;
})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const categories={
    food:{label:'맛집',icon:'食',color:'#bd5129'},
    bar:{label:'술집',icon:'🍸',color:'#7651a6'},
    shopping:{label:'쇼핑·신발·위스키',icon:'🛍',color:'#197e83'},
    hobby:{label:'포켓몬·카드·캐릭터 굿즈',icon:'★',color:'#d43c59'},
    sight:{label:'관광',icon:'◇',color:'#637b64'},
    hotel:{label:'숙소',icon:'H',color:'#263c42'}
  };
  function category(p,record){
    if(p.kind==='hotel')return 'hotel';
    if(p.kind==='food'&&['food','bar'].includes(record?.mapCategory))return record.mapCategory;
    if(p.hotelFood?.group==='hotel-bars'||p.mapCategory==='bar')return 'bar';
    if(p.mapCategory==='goods'||['kbooks-akiba','chiikawa-ikebukuro'].includes(p.id)||['pokemon','card'].includes(p.kind))return 'hobby';
    if(p.kind==='food')return 'food';
    if(p.kind==='sight')return 'sight';
    return 'shopping';
  }
  function area(p){
    const name=p.area||'지역 확인 필요';
    if(/시부야|하라주쿠|오모테산도/.test(name))return '시부야·하라주쿠';
    if(/우에노|오카치마치|유시마|아키하바라|간다/.test(name))return '우에노·아키하바라';
    if(/도쿄역|니혼바시|긴자|히비야/.test(name))return '도쿄역·긴자';
    return name;
  }
  function recommendations(places,includeShopping){
    return places.filter(p=>category(p)==='sight'||includeShopping);
  }
  function areas(places,records={}){
    const grouped=new Map();
    for(const p of places){if(category(p,records[p.id])!=='food'||!p.coords)continue;const name=area(p);if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(p);}
    return [...grouped].map(([name,places])=>({name,places})).sort((a,b)=>b.places.length-a.places.length||a.name.localeCompare(b.name));
  }
  return {categories,category,area,areas,recommendations};
});
