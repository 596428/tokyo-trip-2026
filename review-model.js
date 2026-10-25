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
  function stats(videos,reviews){
    const result=Object.fromEntries(statuses.map(s=>[s,0]));
    for(const v of videos)result[selection(v,reviews)]++;
    return {...result,total:videos.length,reviewed:videos.length-result['미검토']};
  }
  function filter(videos,reviews,status,query){
    const q=(query||'').trim().toLocaleLowerCase();
    return videos.filter(v=>(status==='all'||selection(v,reviews)===status)&&(!q||[v.id,v.restaurant,v.title,v.area,v.menu,reviews[v.id]?.note].join(' ').toLocaleLowerCase().includes(q)));
  }
  function placeSelection(place,videoMap,reviews){
    const values=(place.videoIds||[]).map(id=>videoMap.get(id)).filter(v=>v&&!v.isCompilation).map(v=>selection(v,reviews));
    if(!values.length)return null;
    // A duplicate video left unreviewed must not hide a positively reviewed place.
    return ['가고 싶음','검토','보류','미검토','제외'].find(s=>values.includes(s));
  }
  return {statuses,labels,normalizeReviews,selection,stats,filter,placeSelection};
});
