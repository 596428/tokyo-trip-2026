(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.TripExplore=model;
})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const validCoords=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
  function distanceKm(a,b){
    if(!validCoords(a)||!validCoords(b))return Infinity;
    const rad=x=>x*Math.PI/180;
    const h=Math.sin(rad(b[0]-a[0])/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(rad(b[1]-a[1])/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function nearest(p,anchors){
    return anchors.filter(a=>validCoords(a.coords)).map(a=>({place:a,km:distanceKm(p.coords,a.coords)})).sort((a,b)=>a.km-b.km)[0]||null;
  }
  function category(p){return p.sourceType==='hotel-research'?'recommended':p.selected||p.compilationMention?'picked':'unreviewed';}
  function mealMatch(p,meal,day,includeUnknown){
    if(meal==='all')return true;
    const h=p.hotelFood;
    if(!h)return includeUnknown;
    const meals=day==='all'?h.meals:(h.mealsByDay?.[day]??h.meals);
    return meals.includes(meal);
  }
  function referenceDistance(p,c){
    return c.scope==='nearby'?distanceKm(p.coords,c.center):nearest(p,c.anchors)?.km??Infinity;
  }
  function candidates(all,c){
    const q=(c.query||'').trim().toLocaleLowerCase();
    return all.filter(p=>{
      if(p.kind!=='food'||p.duplicateOf)return false;
      if(c.scope==='hotel30'&&!p.hotelFood?.travel?.within30)return false;
      if(c.scope==='selected'&&!(p.selected||p.compilationMention))return false;
      if(c.scope==='all'&&p.sourceType==='hotel-research')return false;
      if(c.categories&&!c.categories.includes(category(p)))return false;
      if(c.interestedOnly&&!c.records?.[p.id]?.interested)return false;
      if(c.reviewFilter&&c.reviewFilter!=='all'&&p.reviewSelection!==c.reviewFilter)return false;
      if(!mealMatch(p,c.meal||'all',c.day||'all',c.includeUnknown))return false;
      if(q&&![p.name,p.area,p.summary,p.address,p.hotelFood?.menu,...(p.videoIds||[])].join(' ').toLocaleLowerCase().includes(q))return false;
      if(c.scope==='route'||c.scope==='nearby')return referenceDistance(p,c)<=c.radiusKm;
      return true;
    }).sort((a,b)=>c.scope==='hotel30'?a.hotelFood.travel.minutes-b.hotelFood.travel.minutes:referenceDistance(a,c)-referenceDistance(b,c));
  }
  function normalizeRecord(r){return {done:r?.done===true,interested:r?.interested===true,note:typeof r?.note==='string'?r.note.slice(0,4000):''};}
  return {distanceKm,nearest,category,mealMatch,referenceDistance,candidates,normalizeRecord};
});
