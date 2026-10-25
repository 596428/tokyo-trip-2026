(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.TripReview=model;
})(typeof window==='undefined'?this:window,function(){
  'use strict';
  const statuses=['미검토','검토','가고 싶음','보류','제외'];
  const labels={'미검토':'미검토','검토':'검토 중','가고 싶음':'가고 싶음','보류':'보류','제외':'제외'};
  function normalizeReviews(input,validIds){
    const clean={};
    if(!input||typeof input!=='object'||Array.isArray(input))return clean;
    for(const [id,r] of Object.entries(input)){
      if(!validIds.has(id)||!r||typeof r!=='object'||!statuses.includes(r.selection))continue;
      clean[id]={selection:r.selection,note:typeof r.note==='string'?r.note.slice(0,4000):'',reviewedAt:typeof r.reviewedAt==='string'&&Number.isFinite(Date.parse(r.reviewedAt))?r.reviewedAt:''};
    }
    return clean;
  }
  function selection(video,reviews){return reviews[video.id]?.selection??(statuses.includes(video.selection)?video.selection:'미검토');}
  function groups(videos,places){
    const placeByVideo=new Map();
    for(const p of places)if(p.kind==='food'&&!p.duplicateOf)for(const id of p.videoIds||[])if(!placeByVideo.has(id))placeByVideo.set(id,p);
    const result=new Map();
    for(const v of videos){
      const p=!v.isCompilation&&placeByVideo.get(v.id);
      const key=p?p.id:'video-'+v.id;
      if(!result.has(key))result.set(key,{...v,placeId:p?.id||null,restaurant:p?.name||v.restaurant,area:p?.area||v.area,videos:[],videoIds:[]});
      result.get(key).videos.push(v);result.get(key).videoIds.push(v.id);
    }
    return [...result.values()];
  }
  function groupSelection(group,reviews){
    const edited=group.videos.filter(v=>reviews[v.id]).sort((a,b)=>(Date.parse(reviews[b.id].reviewedAt)||0)-(Date.parse(reviews[a.id].reviewedAt)||0));
    if(edited.length)return selection(edited[0],reviews);
    const values=group.videos.map(v=>selection(v,reviews));
    return ['가고 싶음','검토','보류','미검토','제외'].find(s=>values.includes(s))||'미검토';
  }
  function groupNote(group,reviews){
    return reviews[group.id]?.note??group.videos.map(v=>reviews[v.id]?.note).find(Boolean)??'';
  }
  function updateGroup(group,reviews,change,reviewedAt){
    const result={...reviews},current=groupSelection(group,reviews);
    const targets=change.selection?group.videos:[group.videos[0]];
    for(const v of targets)result[v.id]={selection:change.selection||current,note:reviews[v.id]?.note??(v.id===group.id?groupNote(group,reviews):''),...change,reviewedAt};
    return result;
  }
  function stats(videos,reviews){
    const result=Object.fromEntries(statuses.map(s=>[s,0]));
    for(const v of videos)result[v.videos?groupSelection(v,reviews):selection(v,reviews)]++;
    return {...result,total:videos.length,reviewed:videos.length-result['미검토']};
  }
  function filter(videos,reviews,status,query){
    const q=(query||'').trim().toLocaleLowerCase();
    return videos.filter(v=>(status==='all'||(v.videos?groupSelection(v,reviews):selection(v,reviews))===status)&&(!q||[v.id,v.restaurant,v.title,v.area,v.menu,...(v.videos||[v]).flatMap(x=>[x.id,x.title,x.menu,reviews[x.id]?.note])].join(' ').toLocaleLowerCase().includes(q)));
  }
  function placeSelection(place,videoMap,reviews){
    const videos=(place.videoIds||[]).map(id=>videoMap.get(id)).filter(v=>v&&!v.isCompilation);
    return videos.length?groupSelection({videos},reviews):null;
  }
  return {statuses,labels,normalizeReviews,selection,stats,filter,placeSelection,groups,groupSelection,groupNote,updateGroup};
});
