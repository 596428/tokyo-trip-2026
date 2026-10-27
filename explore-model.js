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
      if(!reviewMatch(p,c.reviewFilter,c.records?.[p.id]))return false;
      if(!mealMatch(p,c.meal||'all',c.day||'all',c.includeUnknown))return false;
      if(q&&![p.name,p.area,p.summary,p.address,p.hotelFood?.menu,...(p.videoIds||[])].join(' ').toLocaleLowerCase().includes(q))return false;
      if(c.scope==='route'||c.scope==='nearby')return referenceDistance(p,c)<=c.radiusKm;
      return true;
    }).sort((a,b)=>c.scope==='hotel30'?a.hotelFood.travel.minutes-b.hotelFood.travel.minutes:referenceDistance(a,c)-referenceDistance(b,c));
  }
  function isMust(p,record){return p.reviewSelection==='가고 싶음'&&record?.priority==='must';}
  function reviewMatch(p,filter,record){
    if(!filter||filter==='all')return true;
    if(filter==='must')return isMust(p,record);
    if(filter==='regular')return p.reviewSelection==='가고 싶음'&&!isMust(p,record);
    return p.reviewSelection===filter;
  }
  function normalizeRecord(r){
    const clean={done:r?.done===true,interested:r?.interested===true,note:typeof r?.note==='string'?r.note.slice(0,4000):''};
    if(['must','normal'].includes(r?.priority))clean.priority=r.priority;
    if(['food','bar'].includes(r?.mapCategory))clean.mapCategory=r.mapCategory;
    if(typeof r?.preferenceUpdatedAt==='string'&&Number.isFinite(Date.parse(r.preferenceUpdatedAt)))clean.preferenceUpdatedAt=r.preferenceUpdatedAt;
    return clean;
  }
  function mergePreferenceBaseline(baseline,local){
    const merged={...local},stamp=baseline?.exportedAt;
    if(!stamp||!Number.isFinite(Date.parse(stamp)))return merged;
    for(const [id,pref] of Object.entries(baseline.recordPreferences||{})){
      const saved=local[id]||{};
      if((Date.parse(saved.preferenceUpdatedAt)||0)>=Date.parse(stamp))continue;
      const next={...saved,priority:pref.priority==='must'?'must':'normal',preferenceUpdatedAt:stamp};
      if(['food','bar'].includes(pref.mapCategory))next.mapCategory=pref.mapCategory;
      else delete next.mapCategory;
      merged[id]=normalizeRecord(next);
    }
    return merged;
  }
  return {distanceKm,nearest,category,mealMatch,referenceDistance,candidates,normalizeRecord,isMust,reviewMatch,mergePreferenceBaseline};
});
