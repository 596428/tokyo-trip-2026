'use strict';
const KEY = 'tokyo-trip-20261030-records-v1';
const REVIEW_KEY='tokyo-trip-20261030-video-reviews-v1';
const REVIEW_UI_KEY='tokyo-trip-20261030-review-ui-v1';
const REVIEW_PAGE_SIZE=20;
const kinds = {pokemon:'포켓몬',card:'카드숍',shoe:'신발',fabric:'원단',whisky:'위스키',food:'맛집',hotel:'숙소',shopping:'쇼핑',sight:'관광'};
const kindIcons = {pokemon:'P',card:'C',shoe:'S',fabric:'F',whisky:'W',food:'食',hotel:'H',shopping:'S',sight:'T'};
const dayColors = {fri:'#b94936',sat:'#3c6256',sun:'#476a94'};
const state = {view:'map',day:'all',showFood:true,showFabric:false,foodScope:'city',foodMeal:'all',foodQuery:'',mapStyle:'simple',kind:'all',query:'',includeUnreviewed:false,listTab:'food',radiusKm:1,center:null,anchorId:'city',centerLabel:'도쿄 전체',includeUnknownHours:false,categories:['picked','unreviewed','recommended'],showRecommendations:false,showRoute:false,userPosition:null};
Object.assign(state,{reviewFilter:'가고 싶음',reviewStatus:'all',reviewQuery:'',reviewPage:0,foodDisplay:'pins',mapCategories:['food','bar']});
let data, places, records={}, map, mapLayer, foodLayer, baseLayer, dialogPlace, focusLayer;
let foodLayerMode;
let videoReviews={},reviewVideoMap=new Map(),reviewGroups=[];
let dialogBackPending=false;
const DIALOG_HISTORY_KEY='tokyoTripPlace';
const markers=new Map();
const $ = selector => document.querySelector(selector);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => {try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}};
const link = (url,label,cls='') => `<a class="${cls}" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const badge = (text, tone='') => `<span class="badge ${tone}">${esc(text)}</span>`;
const tone = p => /필요|선택 전|예약 도전/.test(p.status)?'warn':/후보|미검토/.test(p.status)?'soft':'';
const isDone = id => records[id]?.done === true;
const check = p => `<label class="check-control"><input type="checkbox" data-check="${esc(p.id)}" ${isDone(p.id)?'checked':''}>방문 완료</label>`;
const purposeCategory=p=>TripMap.category(p,records[p.id]);
const isMust=p=>TripExplore.isMust(p,records[p.id]);
const reviewFilterLabel=value=>TripReview.filterLabels[value]||value;

function foodPreferences(p,selection=p.reviewSelection){
  if(p.kind!=='food')return '';
  const record=records[p.id]||{},eligible=selection==='가고 싶음',role=record.mapCategory||'auto';
  const automatic=TripMap.categories[TripMap.category(p)].label;
  return `<fieldset class="food-preferences"><legend>이번 여행의 분류</legend><label class="must-choice"><input type="checkbox" data-must-place="${esc(p.id)}" aria-label="${esc(p.name)} 꼭 가고 싶음" ${eligible&&record.priority==='must'?'checked':''} ${eligible?'':'disabled'}>꼭 가고 싶음</label><small>${eligible?'체크하지 않으면 일반 후보 · 기존 검토 결과와 메모는 유지됩니다.':'검토 결과가 ‘가고 싶음’인 식당에서 체크할 수 있습니다.'}</small><label class="food-role-choice">지도 분류<select data-food-role="${esc(p.id)}" aria-label="${esc(p.name)} 지도 분류">${[['auto','자동 분류 · '+automatic],['food','맛집'],['bar','술집']].map(([value,label])=>`<option value="${value}" ${role===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><small>술을 중심으로 들를 곳은 ‘술집’으로 선택하세요.</small></fieldset>`;
}

function message(text){ $('#app-message').hidden=false; $('#app-message').textContent=text; }
function loadRecords(){try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');records=validateRecords(saved);}catch{records={};message('이 브라우저에서는 저장한 기록을 읽지 못했습니다. 내보내기로 기록을 보관해 주세요.');}}
function validateRecords(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('잘못된 기록');
  const clean={};
  for(const [id,r] of Object.entries(input)){
    if(!places.has(id)||!r||typeof r!=='object')continue;
    clean[id]=TripExplore.normalizeRecord(r);
  }
  return clean;
}
function saveRecords(){try{localStorage.setItem(KEY,JSON.stringify(records));}catch{message('브라우저 저장 공간을 사용할 수 없습니다. 준비 화면에서 기록을 내보내 주세요.');}renderProgress();}
function renderProgress(){
  const n=Object.values(records).filter(r=>r.done).length;
  $('#progress-label').textContent=n?`${n}곳의 방문을 기록했어요`:'아직 방문 전 · 나만의 여행을 준비하는 중';
}
function loadVideoReviews(){
  try{videoReviews=TripReview.normalizeReviews(JSON.parse(localStorage.getItem(REVIEW_KEY)||'{}'),new Set(reviewVideoMap.keys()));}
  catch{message('검토 기록을 읽지 못했습니다. 내보내 둔 파일이 있다면 준비 화면에서 가져와 주세요.');}
  if(data.reviewBaseline){
    const shared=TripReview.normalizeReviews(data.reviewBaseline.videoReviews,new Set(reviewVideoMap.keys()));
    videoReviews=TripReview.mergeBaseline(shared,videoReviews);
  }
  try{
    const saved=JSON.parse(localStorage.getItem(REVIEW_UI_KEY)||'{}');
    state.reviewStatus=TripReview.filters.includes(saved.status)?saved.status:'all';
    state.reviewQuery=typeof saved.query==='string'?saved.query.slice(0,4000):'';
    state.reviewPage=Number.isInteger(saved.page)&&saved.page>=0?saved.page:0;
  }catch{}
}
function saveReviewUI(){try{localStorage.setItem(REVIEW_UI_KEY,JSON.stringify({status:state.reviewStatus,query:state.reviewQuery,page:state.reviewPage}));}catch{}}
function saveVideoReviews(){
  try{localStorage.setItem(REVIEW_KEY,JSON.stringify(videoReviews));return true;}
  catch{message('검토 기록을 브라우저에 저장하지 못했습니다. 내보내기로 보관해 주세요.');return false;}
}
function applyReviewSelections(){
  for(const p of data.places){
    if(p.kind!=='food')continue;
    if(p.initialSelected===undefined)p.initialSelected=!!p.selected;
    const selection=TripReview.placeSelection(p,reviewVideoMap,videoReviews);
    p.reviewSelection=selection;
    if(selection!==null)p.selected=['가고 싶음','검토'].includes(selection)||(p.initialSelected&&selection==='미검토'&&!p.videoIds.some(id=>videoReviews[id]));
    p.compilationMention=selection!=='제외'&&(p.videoIds||[]).some(id=>{
      const v=reviewVideoMap.get(id);return v?.isCompilation&&TripReview.selection(v,videoReviews)==='가고 싶음';
    });
    for(const v of p.videos||[]){const source=reviewVideoMap.get(v.id);if(source)v.selection=TripReview.selection(source,videoReviews);}
  }
}
function setVideoReview(id,change){
  const group=reviewGroups.find(g=>g.id===id);if(!group)return;
  videoReviews=TripReview.updateGroup(group,videoReviews,change,new Date().toISOString());
  const saved=saveVideoReviews();applyReviewSelections();
  if($('#review-save-status'))$('#review-save-status').textContent=saved?'이 브라우저에 저장됨':'저장 실패 · 내보내기로 보관해 주세요';
}
function reviewCard(v){
  const current=TripReview.groupSelection(v,videoReviews),note=TripReview.groupNote(v,videoReviews);
  const related=v.placeId&&places.get(v.placeId);
  const sources=v.videos.length>1?`<details class="review-source-videos"><summary>관련 Shorts ${v.videos.length}개 · 엑셀 번호·이전 메모</summary>${v.videos.map(x=>`<div class="review-source-video">${link(x.url,x.id+' · '+x.title)}<small>엑셀 원본: ${esc(TripReview.labels[x.selection]||x.selection)}</small>${videoReviews[x.id]?.note&&x.id!==v.id?`<p>${esc(x.id+' 메모: '+videoReviews[x.id].note)}</p>`:''}</div>`).join('')}</details>`:'';
  const original=[...new Set(v.videos.map(x=>TripReview.labels[x.selection]||x.selection))].join(' / ');
  return `<article class="review-card" data-review-card="${esc(v.id)}"><div class="place-card-top"><b>${esc(v.videoIds.join(' · '))}</b><span>${esc(v.area)}${v.isCompilation?' · 모음 영상':''}</span>${badge(related&&isMust(related)?'꼭 가고 싶음':TripReview.labels[current],related&&isMust(related)?'must':current==='가고 싶음'?'':'soft')}</div><h3>${esc(v.restaurant||v.title)}</h3><p>${esc(v.menu||v.title)}</p><div class="review-actions">${link(v.url,'Shorts 보기 ↗','button-link')}${related?`<button class="button-link" data-place="${esc(related.id)}">메뉴·지도 상세</button>`:''}</div>${sources}${v.isCompilation?`<details><summary>영상 속 장소 ${v.restaurantNames.length}곳 · 이번 여행 지도에서는 제외</summary><p>${esc(v.restaurantNames.join(' / '))}</p><p>모음 영상은 검토 중으로 보관해도 됩니다. 개별 식당으로 나누기 전까지 핀을 자동 추가하지 않습니다.</p></details>`:''}<label class="review-selection">검토 결과<select data-video-review="${esc(v.id)}" aria-label="${esc(v.id)} 검토 결과">${TripReview.statuses.map(s=>`<option value="${esc(s)}" ${current===s?'selected':''}>${esc(TripReview.labels[s])}</option>`).join('')}</select></label>${related?foodPreferences(related,current):''}<details class="review-note" ${note?'open':''}><summary>내 검토 메모${note?' · 작성됨':''}</summary><textarea data-video-note="${esc(v.id)}" aria-label="${esc(v.id)} 검토 메모" maxlength="4000" placeholder="먹고 싶은 메뉴, 고민하는 이유…">${esc(note)}</textarea></details><small>엑셀 원본: ${esc(original)}${v.videos.some(x=>videoReviews[x.id])?' · 웹 검토 기록 있음':''}${v.videos.length>1?' · 결과 변경 시 연결된 엑셀 항목에 함께 반영':''}</small></article>`;
}
function renderReviewResults(){
  const all=reviewGroups,stats=TripReview.stats(all,videoReviews);
  const list=TripReview.filter(all,videoReviews,state.reviewStatus,state.reviewQuery,records);
  const pages=Math.max(1,Math.ceil(list.length/REVIEW_PAGE_SIZE));state.reviewPage=Math.min(state.reviewPage,pages-1);
  const start=state.reviewPage*REVIEW_PAGE_SIZE;
  $('#review-progress').innerHTML=`<b>${stats.reviewed} / ${stats.total}개 항목 검토</b><small>같은 가게는 한 번만 표시 · 원본 영상 ${data.reviewVideos.length}개${all.some(g=>g.isCompilation)?' · 모음 영상은 별도 항목':''}</small><progress value="${stats.reviewed}" max="${stats.total}" aria-label="맛집 검토 진행률"></progress><span>${TripReview.statuses.map(s=>esc(TripReview.labels[s])+' '+stats[s]).join(' · ')} · 그중 꼭 가고 싶음 ${TripReview.filter(all,videoReviews,'must','',records).length}</span>`;
  const pager=`<div class="review-pagination"><button class="button-link" data-review-page="${state.reviewPage-1}" ${state.reviewPage===0?'disabled':''}>이전 20개</button><span>${state.reviewPage+1} / ${pages}쪽 · ${list.length}개</span><button class="button-link" data-review-page="${state.reviewPage+1}" ${state.reviewPage>=pages-1?'disabled':''}>다음 20개</button></div>`;
  $('#review-results').innerHTML=pager+`<div class="review-grid">${list.slice(start,start+REVIEW_PAGE_SIZE).map(reviewCard).join('')||'<div class="empty-state">이 조건에 해당하는 영상이 없습니다.</div>'}</div>`+pager;
  saveReviewUI();
}
function renderReview(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">REVIEW YOUR EXCEL LIST</span><h2>엑셀 목록 검토</h2></div></div><p class="section-intro">같은 가게의 Shorts를 한 카드로 묶었습니다. 관련 영상을 골라 보고 가게별로 검토하세요. 결과를 변경하면 연결된 엑셀 항목에 함께 반영되며 자동 저장됩니다.</p><div id="review-progress" class="review-progress" role="status"></div><div class="review-tools"><label>검토 상태<select id="review-status">${TripReview.filters.map(s=>`<option value="${esc(s)}" ${state.reviewStatus===s?'selected':''}>${esc(reviewFilterLabel(s))}</option>`).join('')}</select></label><button class="button-link" data-action="review-unreviewed">미검토부터 이어 보기</button><button class="button-link" data-action="review-map-wanted">가고 싶은 곳 지도</button><button class="button-link" data-action="review-map-must">꼭 갈 곳 지도</button><button class="button-link" data-action="export">검토·메모 내보내기</button></div><label class="search-box"><span aria-hidden="true">⌕</span><input id="review-search" type="search" aria-label="엑셀 영상 검색" placeholder="T051, 가게·지역·메뉴 검색" value="${esc(state.reviewQuery)}"></label><p id="review-save-status" class="review-save-status" role="status">이 브라우저에 자동 저장 · 다른 기기로 옮길 때는 내보내기</p><p class="section-intro">‘가고 싶음’에서 ‘꼭 가고 싶음’을 체크하면 우선 방문 후보가 됩니다. 검토 상태에서 두 단계를 나눠 보세요. 술집 분류는 각 카드에서 변경할 수 있습니다. 모음 영상은 검토 중으로 보관하고 이번 여행 지도에서 생략할 수 있습니다. 별표 관심은 별도로 유지합니다.</p><div id="review-results"></div>`;
  renderReviewResults();
}
function selectedDays(){return data.days.filter(d=>state.day==='all'||d.id===state.day);}
function routePlaces(){return selectedDays().flatMap(d=>{
  let n=0;
  return d.steps.filter(s=>s.place).map(s=>{
    const p=places.get(s.place);
    return {...p,routeOrder:p.kind==='hotel'?'H':++n,routeDay:d.id};
  });
});}
function mappedRoutePlaces(){
  const unique=new Map();
  for(const p of routePlaces()){
    if(!p.coords)continue;
    if(!unique.has(p.id))unique.set(p.id,{...p,visits:[]});
    const item=unique.get(p.id);
    if(!item.visits.some(v=>v.day===p.routeDay))item.visits.push({day:p.routeDay,order:p.routeOrder});
  }
  return [...unique.values()];
}
function defaultVisible(p){return !p.duplicateOf&&(p.kind!=='food'||p.selected||p.compilationMention||p.hotelFood?.group==='hotel-bars');}
const distanceKm=TripExplore.distanceKm;
function kmLabel(km){return km<.05?'50m 이내':km<1?`${Math.round(km*1000/50)*50}m`:`${km.toFixed(1)}km`;}
function proximity(p){
  if(!p.coords)return null;
  const hotel=places.get(data.routePlan.hotelId);
  const shops=mappedRoutePlaces().filter(x=>x.kind!=='hotel');
  const nearest=shops.map(x=>({place:x,km:distanceKm(p.coords,x.coords)})).sort((a,b)=>a.km-b.km)[0];
  return {hotel:distanceKm(p.coords,hotel.coords),nearest};
}
function distanceHtml(p){
  const d=proximity(p);if(!d)return '';
  return `<span>호텔에서 약 ${kmLabel(d.hotel)}</span>${d.nearest?`<span>${esc(d.nearest.place.name)}에서 약 ${kmLabel(d.nearest.km)}</span>`:''}<small>대략적인 직선거리 · 도보/전철 이동거리가 아닙니다</small>`;
}
const mealLabels={breakfast:'아침',lunch:'점심',dinner:'저녁',drinks:'저녁 + 술',afterDinner:'호텔 근처의 술집'};
function mealsFor(p){
  const h=p.hotelFood;if(!h)return [];
  return state.day==='all'?h.meals:(h.mealsByDay?.[state.day]??h.meals);
}
function hotelTravelHtml(p){
  const t=p.hotelFood?.travel;if(!t)return '';
  return `<div class="hotel-travel"><b>${t.minutes===0?'호텔 내 조식':'호텔에서 '+esc(t.label)}</b><small>${esc(t.route)} · ${t.estimated?'주소 기준 추정 · 실제 도보시간은 길찾기에서 확인':t.mode==='walk'?'도보 경로 확인':'10.30 금 18시 출발 길찾기 기준'}${t.mode==='transit'?' · 출발시각에 따라 변동':''}</small></div>`;
}
function diningHtml(p,detail=false){
  const h=p.hotelFood;
  if(!h)return '<div class="hours-unchecked">영업시간·식사 목적은 아직 재확인하지 않은 후보입니다.</div>';
  return `${hotelTravelHtml(p)}<div class="meal-tags">${h.meals.filter(m=>m!=='drinks'||h.group!=='hotel-bars').map(m=>badge(mealLabels[m],m==='drinks'?'wine':m==='breakfast'?'morning':'soft')).join('')}</div><p class="meal-menu">${esc(h.menu)}</p>${h.caution?`<p class="dining-caution">${esc(h.caution)}</p>`:''}<div class="hours-grid">${data.days.map(d=>`<div class="${state.day===d.id?'chosen-day':''}"><b>${esc(d.date)} ${esc(d.weekday[0])}</b><span>${esc(h.hours[d.id])}</span></div>`).join('')}</div><small class="hours-evidence">10.25 확인 · ${esc(h.hoursEvidence)} · 통상 영업 기준</small>${detail?`<p class="dining-note">${esc(h.note)}</p><div class="dining-sources">${h.sources.map(x=>link(x.url,x.label+' ↗')).join('')}</div>`:`<details class="dining-details"><summary>이용 조건·확인 출처</summary><p>${esc(h.note)}</p>${h.sources.map(x=>link(x.url,x.label+' ↗')).join('')}</details>`}`;
}

function explorationContext(){
  return {scope:state.foodScope,anchors:mappedRoutePlaces(),center:state.center,radiusKm:state.radiusKm,day:state.day,meal:state.foodMeal,query:state.foodQuery,categories:state.categories,includeUnknown:state.includeUnknownHours,reviewFilter:state.reviewFilter,records};
}
function foodCandidates(){return TripExplore.candidates(data.places,explorationContext()).filter(p=>state.mapCategories.includes(purposeCategory(p))&&(state.showFood||purposeCategory(p)!=='food'));}
function referenceDistance(p){return TripExplore.referenceDistance(p,explorationContext());}
function nearbyLabel(p){
  if(!p.coords)return '위치 확인 필요';
  const nearest=TripExplore.nearest(p,mappedRoutePlaces());
  if(state.foodScope==='nearby')return `${state.centerLabel}에서 직선 약 ${kmLabel(distanceKm(p.coords,state.center))}`;
  return nearest?`${nearest.place.name}에서 직선 약 ${kmLabel(nearest.km)}`:'';
}
function interestButton(p){return `<button class="interest-button ${records[p.id]?.interested?'saved':''}" data-interest="${esc(p.id)}" aria-pressed="${records[p.id]?.interested===true}" aria-label="${esc(p.name)} 관심 ${records[p.id]?.interested?'해제':'저장'}">${records[p.id]?.interested?'★ 관심 저장됨':'☆ 관심 저장'}</button>`;}
function arrivalHtml(p,detail=false){
  if(!p.buildingName)return '';
  return `<div class="arrival-info"><b>건물 핀 · ${esc(p.buildingName)} ${esc(p.floor)}</b><small>${esc(p.openingNote)}</small>${detail?`<p>${esc(p.accessNote)}</p>${link(p.floorGuideUrl,'공식 층별 안내 ↗','small-link')}<small>핀은 건물 대표 위치입니다. 건물 도착 후 층수를 확인하세요.</small>`:''}</div>`;
}
function contextDirections(p){
  if(state.foodScope==='hotel30')return hotelDirections(p);
  let url='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent((p.addressUncertain?p.name:p.address)||p.name);
  if(state.foodScope==='nearby')url+='&origin='+encodeURIComponent(state.center.join(','));
  return url+'&travelmode=walking';
}
function recommendationPlaces(){return data.places.filter(p=>p.exploreRecommended&&!p.duplicateOf);}
function nearbyRecommendations(){
  const context=explorationContext();
  return TripMap.recommendations(recommendationPlaces(),state.showRecommendations).filter(p=>state.foodScope==='hotel30'?distanceKm(p.coords,places.get(data.routePlan.hotelId).coords)<=state.radiusKm:!['route','nearby'].includes(state.foodScope)||TripExplore.referenceDistance(p,context)<=state.radiusKm);
}
function syncExploreControls(){
  $('[data-action="route-overview"]').disabled=false;
  $('[data-action="dining-guide"]').disabled=false;
  const id=state.foodScope==='city'?'city':state.foodScope==='route'?'route':state.anchorId;
  $('#explore-anchor').innerHTML='<option value="city">도쿄 전체 · 반경 제한 없음</option><option value="route">전체 방문권역 · 참고 동선</option>'+`<option value="map">지도에서 선택한 지역</option>${state.userPosition?'<option value="user">내 위치</option>':''}`+
    '<optgroup label="방문할 장소">'+[...new Map(data.days.flatMap(d=>d.steps.filter(s=>s.place).map(s=>[s.place,places.get(s.place)]))).values()].map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup><optgroup label="동선을 넓힐 후보">'+recommendationPlaces().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup>';
  $('#explore-anchor').value=id;
  $('#explore-radius').value=String(state.radiusKm);
  $('#explore-radius').closest('label').style.display=state.foodScope==='city'?'none':'';
  $('#include-unknown-hours').checked=state.includeUnknownHours;
  $('#food-review').value=state.reviewFilter;
  $('#food-display').value=state.foodDisplay;
  $('#map-categories').innerHTML=Object.entries(TripMap.categories).map(([id,c])=>`<label class="map-category-chip ${state.mapCategories.includes(id)?'enabled':''}" style="--category-color:${c.color}"><input type="checkbox" data-map-category="${id}" ${state.mapCategories.includes(id)?'checked':''}><span aria-hidden="true">${c.icon}</span>${c.label}</label>`).join('');
  $('#show-recommendations').checked=state.showRecommendations;$('#show-route').checked=state.showRoute;
  document.querySelectorAll('[data-food-category]').forEach(el=>el.checked=state.categories.includes(el.dataset.foodCategory));
  $('#explore-center-label').textContent=state.foodScope==='city'?`도쿄 전체 · 반경 제한 없음 · ${state.reviewFilter==='all'?'모든 검토 상태':reviewFilterLabel(state.reviewFilter)+' 맛집'} · 선택한 종류만 지도에 표시`:state.foodScope==='route'?`선택 날짜의 각 방문 장소에서 직선 ${state.radiusKm}km 주변 · 순서는 자유롭게 변경`:
    state.foodScope==='nearby'?`${state.centerLabel} · 직선 반경 ${state.radiusKm}km${state.anchorId==='user'?' · 위치는 저장하지 않습니다':''}`:
    state.foodScope==='hotel30'?`호텔 출발 약 30분권 · 이동·영업 안내가 있는 ${data.places.filter(p=>p.hotelFood?.travel?.within30).length}곳`:'넓게 비교하는 보기 · 장소를 선택하면 그 주변으로 좁힐 수 있습니다';
}
function enableMapCategory(id){if(!state.mapCategories.includes(id))state.mapCategories.push(id);if(id==='food')state.showFood=true;}
function enableRouteCategories(){for(const p of mappedRoutePlaces())enableMapCategory(purposeCategory(p));}
function showRouteOverview(){
  if(!data)return;
  Object.assign(state,{view:'map',foodScope:'route',anchorId:'route',centerLabel:'전체 방문권역',listTab:'route',showRoute:true,showRecommendations:false,foodQuery:''});
  enableRouteCategories();render();updateMap(true);$('#map-pane').scrollIntoView({block:'start'});
}
function showCityWanted(foodOnly=false,reviewFilter='가고 싶음'){
  Object.assign(state,{view:'map',day:'all',listTab:'food',foodScope:'city',anchorId:'city',centerLabel:'도쿄 전체',reviewFilter,foodMeal:'all',foodQuery:'',showFood:true,showRoute:false,showRecommendations:false,includeUnknownHours:false,categories:['picked','unreviewed','recommended'],mapCategories:['food','bar'],foodDisplay:foodOnly?'clusters':'pins'});
  render();updateMap(true);$('#map-pane').scrollIntoView({block:'start'});
}
function selectFocus(id){
  let coords,label;
  if(id==='city'){showCityWanted();return;}
  if(id==='route'){
    state.foodScope='route';state.anchorId='route';state.centerLabel='전체 방문권역';state.foodQuery='';
    render();updateMap(true);$('#map-pane').scrollIntoView({behavior:'smooth',block:'start'});return;
  }
  if(id==='map'){const c=map.getCenter();coords=[c.lat,c.lng];label='지도 중심';}
  else if(id==='user'&&state.userPosition){coords=state.userPosition.coords;label='내 위치';}
  else {const p=places.get(id);if(!p?.coords)return;coords=p.coords;label=p.name;}
  state.view='map';state.foodScope='nearby';state.anchorId=id;state.center=coords;state.centerLabel=label;state.foodQuery='';state.showFood=true;state.listTab='food';
  closePlace();
  render();fitFocus();$('#map-pane').scrollIntoView({behavior:'smooth',block:'start'});
}
function fitFocus(){if(map&&state.center)map.fitBounds(L.latLng(state.center).toBounds(state.radiusKm*2000),{padding:[20,20],animate:false});}
function getMyLocation(){
  const msg=$('#geo-message');msg.hidden=false;
  if(!window.isSecureContext){msg.textContent='내 위치는 HTTPS 페이지에서 이용할 수 있습니다. 지금은 방문 장소나 지도 중심을 선택해 주세요.';return;}
  if(!navigator.geolocation){msg.textContent='이 브라우저는 위치 확인을 지원하지 않습니다. 지도 중심으로 찾아 주세요.';return;}
  const button=$('[data-action="my-location"]');button.disabled=true;msg.textContent='브라우저 위치 권한을 확인하고 있습니다. 위치는 저장하지 않습니다.';
  navigator.geolocation.getCurrentPosition(position=>{
    button.disabled=false;state.userPosition={coords:[position.coords.latitude,position.coords.longitude],accuracy:position.coords.accuracy};
    selectFocus('user');msg.textContent=`현재 위치 기준 · 위치 오차 약 ${Math.round(position.coords.accuracy)}m. 위치 기록은 저장하지 않습니다.`;
  },()=>{button.disabled=false;msg.textContent='위치를 확인하지 못했습니다. 권한·GPS 상태를 확인하거나 장소를 골라 찾아 주세요.';},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}

function locationLabel(p){return {poi:'지도 검색 위치',address:'주소 기준 위치',block:'주소 블록 위치'}[p.locationPrecision]||'위치 미확인';}
function hotelDirections(p){return 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(places.get(data.routePlan.hotelId).address)+'&destination='+encodeURIComponent(p.address.split(' / ')[0]||p.name)+'&travelmode='+(p.hotelFood?.travel?.mode==='walk'?'walking':'transit');}
function renderTabs(){
  $('#day-tabs').innerHTML=data.days.map(d=>`<button class="day-tab ${state.day===d.id?'active':''}" data-day="${d.id}" aria-pressed="${state.day===d.id}"><b>${d.date}</b>${d.weekday[0]}</button>`).join('')+`<button class="day-tab ${state.day==='all'?'active':''}" data-day="all" aria-pressed="${state.day==='all'}">전체</button>`;
}
function render(){
  document.body.dataset.view=state.view;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
  renderTabs();
  if(state.view==='today')renderToday();
  else if(state.view==='map')renderMapList();
  else if(state.view==='places')renderPlaces();
  else if(state.view==='review')renderReview();
  else renderPrepare();
  updateMap(false);
}
function renderStop(s){
  if(!s.place)return `<article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card ${s.type==='meal'?'meal':'transport'}"><h3>${esc(s.title)}</h3><p>${esc(s.note)}</p></div></article>`;
  const p=places.get(s.place);
  return `<article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card ${isDone(p.id)?'completed':''}"><div class="stop-meta"><span class="area-label">${esc(p.area)} · ${esc(kinds[p.kind])}</span>${badge(isMust(p)?'꼭 가고 싶음':p.status,isMust(p)?'must':tone(p))}</div><h3><button data-place="${esc(p.id)}" style="text-align:left;padding:0;font-weight:700">${esc(p.name)}</button></h3><p>${esc(s.note)}</p><div class="stop-actions">${check(p)}<div><button class="small-link" data-place="${esc(p.id)}">상세</button><span aria-hidden="true"> · </span>${link(p.directionsUrl,'길안내 ↗','small-link')}</div></div></div></article>`;
}
function daySection(d){return `<section class="day-section"><div class="day-summary"><div class="route-heading"><div class="date-square"><small>${esc(d.weekday[0])}</small>${esc(d.date.split('.')[1])}</div><div><span class="eyebrow">${d.id==='fri'?'DAY 01':d.id==='sat'?'DAY 02':'DAY 03'} / ${esc(d.date)}</span><h2>${esc(d.title)}</h2></div></div><p>${esc(d.subtitle)}</p><div class="day-note">${esc(d.note)}</div></div><div class="timeline">${d.steps.map(renderStop).join('')}</div></section>`;}
function renderToday(){
  $('#left-pane').innerHTML=(state.day==='all'?'<div class="overview-note"><h3>전체 흐름부터 살펴보세요.</h3><p>금요일은 메가도쿄·치이카와랜드가 있는 이케부쿠로, 토요일은 아키하바라에서 니혼바시·도쿄역을 거쳐 긴자 쇼핑, 일요일은 귀국 이동입니다. 식사는 후보 상태로 두었습니다.</p></div>':'')+selectedDays().map(daySection).join('<hr class="section-divider">')+
    `<div class="overview-note"><h3>APA 우에노 히로코지 숙박 확정</h3><p>예약한 숙소를 기준으로 한 쇼핑 동선입니다. 음식점은 후보 단계이고, 원단은 현재 동선에서 제외했습니다. Break Beats 예약 결과와 PRAS 지점 재고에 따라 조정합니다.</p><button class="small-link" data-view="prepare">예약과 준비 확인하기 →</button></div>`;
}
function placeCard(p){return `<article class="place-card ${isDone(p.id)?'done':''}"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(TripMap.categories[purposeCategory(p)].label)}</span>${badge(isMust(p)?'꼭 가고 싶음':p.status,isMust(p)?'must':tone(p))}</div><h3><button data-place="${esc(p.id)}" style="font-weight:700;text-align:left;padding:0">${esc(p.name)}</button></h3><p>${esc(p.summary)}</p><div class="place-card-bottom"><span class="card-count">${p.kind==='food'?esc(p.videoIds?.join(' · ')||''):p.day?'동선에 포함':'비교·선택 후보'}</span><button class="small-link" data-place="${esc(p.id)}">자세히 보기 ↗</button></div></article>`;}

function hoursLabel(p){return p.diningResearch?p.diningResearch.hours:p.hotelFood?(p.hotelFood.hoursEvidence==='공식 안내'?'공식 영업 안내 있음':'영업 정보·주의사항 있음'):'영업 미확인 · 영상 정보는 참고용';}
function researchHtml(p,detail=false){
  const r=p.diningResearch;if(!r)return '';
  return `<div class="dining-research ${r.closed?'closed-venue':''}"><b>${r.closed?'폐점 확인':esc(r.queue)}</b>${detail?`<div class="detail-info">${esc(r.hours)}</div>`:''}<p>${esc(r.queueNote||'기다림이 짧다는 뜻은 아닙니다. 공개된 대기 정보를 확인하지 못했습니다.')}</p>${r.arrival?`<p class="dining-arrival">방문 제안: ${esc(r.arrival)}</p>`:''}${detail?`<p>${esc(r.caution)}</p><small>2026.10.27 확인 · ${esc(r.hoursEvidence)} · 통상 영업 기준, 방문일 임시휴무 별도</small><div class="dining-sources">${r.sources.map(s=>link(s.url,s.label+' ↗')).join('')}</div>`:''}</div>`;
}
function diningGuideHtml(){
  const guide=data.diningResearch;if(!guide)return '';
  const profiles=data.places.filter(p=>isMust(p)&&p.diningResearch);
  return `<article class="prepare-card dining-guide" id="dining-guide"><span class="eyebrow">SATURDAY / 10.31</span><h3>토요일 아침·점심, 먼저 먹을 한 곳 고르기</h3><p>오전 식사 후보입니다. 기존 쇼핑 동선을 자동 변경하거나 예약하지 않았습니다. 마루카·에비마루 중 한 곳, 또는 쓰키지·히가시긴자 아침 중에서 고르는 구성을 권합니다.</p>${guide.plans.map(plan=>`<section class="morning-plan"><h4>${esc(plan.title)}</h4><p>${esc(plan.summary)}</p><small>${esc(plan.note)}</small><div>${plan.places.filter(id=>places.has(id)&&isMust(places.get(id))).map(id=>`<button class="button-link" data-place="${id}">${esc(places.get(id).name)} →</button>`).join(' ')}</div></section>`).join('')}<details class="dining-research-list"><summary>내 꼭 갈 곳 영업·대기 조사 ${profiles.length}개 항목 · 10.27 확인</summary>${profiles.map(p=>`<section><h4><button class="small-link" data-place="${esc(p.id)}">${esc(p.name)} →</button></h4><p>${esc(p.diningResearch.hours)}</p>${researchHtml(p,true)}</section>`).join('')}</details><p>${esc(guide.limits)}</p></article>`;
}
function foodCard(p){
  const cat=TripExplore.category(p),label=p.hotelFood?.group==='hotel-bars'?'호텔 근처의 술집':{picked:'내 선택·모음 영상',unreviewed:'엑셀 미검토',recommended:'추가 추천'}[cat];
  return `<article class="place-card food-map-card" data-food-card="${esc(p.id)}"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(p.videoIds.join(' · ')||'추천·보완')}</span>${badge(purposeCategory(p)==='bar'?'술집':label,cat==='unreviewed'?'soft':'')}${isMust(p)?badge('꼭 가고 싶음','must'):''}</div><h3><button data-place="${esc(p.id)}">${esc(p.name)}</button></h3><div class="explore-distance">${state.foodScope==='hotel30'?hotelTravelHtml(p):esc(nearbyLabel(p))}</div><p>${esc(p.hotelFood?.menu||p.summary)}</p><div class="quick-hours">${p.diningResearch?esc(p.diningResearch.hours):p.hotelFood?esc(state.day==='all'?hoursLabel(p)+' · 상세에서 요일별 확인':p.hotelFood.hours[state.day]):'영업 미확인 · 영상 메뉴·가격은 참고용'}</div>${researchHtml(p)}${!p.diningResearch&&p.hotelFood?.caution?`<p class="dining-caution">${esc(p.hotelFood.caution)}</p>`:''}<div class="food-card-actions">${interestButton(p)}<button data-locate="${esc(p.id)}" class="small-link">핀 보기</button><button data-place="${esc(p.id)}" class="small-link">${p.videoIds.length?'메뉴·시간·Shorts':'메뉴·시간'} →</button></div></article>`;
}
function renderFoodResults(){
  const list=foodCandidates(),mapped=list.filter(p=>p.coords),missing=list.filter(p=>!p.coords);
  const counts={picked:0,unreviewed:0,recommended:0};list.forEach(p=>counts[TripExplore.category(p)]++);
  const unresolved=TripExplore.candidates(data.places,{...explorationContext(),scope:'city'}).filter(p=>!p.coords&&state.mapCategories.includes(purposeCategory(p)));
  const areas=TripMap.areas(mapped,records);
  const areaSummary=areas.length?`<details class="food-area-summary" ${state.foodScope==='city'?'open':''}><summary>권역별 맛집 개수</summary><div>${areas.map(a=>`<button data-food-area="${esc(a.name)}">${esc(a.name)} <b>${a.places.length}</b></button>`).join('')}</div><small>등록 지역명 기준 · 누르면 해당 권역으로 확대합니다. 다른 권역의 선택은 유지됩니다.</small></details>`:'';
  $('#food-results').innerHTML=`<div class="result-count" role="status">${mapped.length}곳 표시 · 내 선택 ${counts.picked} / 미검토 ${counts.unreviewed} / 추가 추천 ${counts.recommended}<br>가까운 순 · 직선거리이며 도보시간은 길찾기에서 확인 · 영상 메뉴·가격은 참고용${state.foodMeal!=='all'&&state.includeUnknownHours?'<br>식사 목적 미확인 후보도 포함합니다. ‘영업 미확인’ 표기를 확인하세요.':''}</div>${areaSummary}<div class="places-grid">${mapped.map(foodCard).join('')||'<div class="empty-state">주변 후보가 없습니다. 반경을 넓히거나 후보·식사 필터를 조정해 주세요.</div>'}</div>${missing.length?`<details class="unmapped-food"><summary>위치 미확인 ${missing.length}곳</summary>${missing.map(foodCard).join('')}</details>`:''}${unresolved.length&&!missing.length?`<details class="unmapped-food"><summary>위치 미확인 ${unresolved.length}곳 · 주변 판정 보류</summary><p class="section-intro">주소가 없거나 가게명과 주소가 맞지 않아 핀을 보류했습니다.</p>${unresolved.map(foodCard).join('')}</details>`:''}`;
}
function optionalCard(p){return `<article class="place-card optional-card"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(kinds[p.kind])}</span>${badge('선택 방문','soft')}</div><h3>${esc(p.name)}</h3><p>${esc(p.summary)}</p><div class="explore-distance">${esc(nearbyLabel(p))}</div><div class="food-card-actions">${interestButton(p)}<button class="button-link" data-nearby="${esc(p.id)}">이 장소 주변 탐색</button><button class="small-link" data-place="${esc(p.id)}">상세 →</button></div></article>`;}
function renderExplorerResults(){
  if(!$('#food-results'))return;
  if(state.listTab==='food'){renderFoodResults();return;}
  if(state.listTab==='recommendations'){
    const local=nearbyRecommendations(),localIds=new Set(local.map(p=>p.id)),other=recommendationPlaces().filter(p=>!localIds.has(p.id));
    $('#food-results').innerHTML=`<p class="section-intro">일정에 고정하지 않은 추천입니다. ‘이 장소 주변 탐색’으로 동선을 넓혀 보세요. 시부야 PARCO는 이미 가는 건물 안에서 더 둘러볼 수 있습니다. <button class="small-link" data-place="pc-shibuya">같은 층 매장 안내 →</button></p><div class="result-count">현재 범위 주변 ${local.length}곳 · 다른 지역 ${other.length}곳</div><div class="places-grid">${local.map(optionalCard).join('')}</div>${other.length?`<details class="outside-recommendations" open><summary>동선을 넓힐 다른 지역 ${other.length}곳</summary><div class="places-grid">${other.map(optionalCard).join('')}</div></details>`:''}`;
  }else if(state.listTab==='saved'){
    const saved=data.places.filter(p=>records[p.id]?.interested&&!p.duplicateOf);
    $('#food-results').innerHTML=`<p class="section-intro">관심은 방문 날짜·시간을 정하지 않은 나만의 후보입니다. 이 브라우저에 저장되며 준비 화면에서 내보낼 수 있습니다.</p><div class="places-grid">${saved.map(p=>p.kind==='food'?foodCard(p):optionalCard(p)).join('')||'<div class="empty-state">아직 저장한 관심 장소가 없습니다. 후보 카드의 ☆ 관심 저장을 눌러 보세요.</div>'}</div>`;
  }else{
    $('#food-results').innerHTML=`<p class="section-intro">번호는 참고 순서입니다. 예약 시간이 정해진 곳을 제외하면 현장에서 순서를 바꾸거나 건너뛰어도 됩니다.</p><div class="places-grid">${mappedRoutePlaces().map(p=>`<article class="place-card"><span class="area-label">${esc(p.area)} · ${esc(kinds[p.kind])}</span><h3>${esc(p.name)}</h3><p>${esc(p.exploreTip||p.summary)}</p><div class="food-card-actions"><button class="button-link" data-nearby="${esc(p.id)}">여기 주변 맛집</button><button class="small-link" data-place="${esc(p.id)}">상세·메모 →</button></div></article>`).join('')}</div>`;
  }
}
function renderMapList(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">EXPLORE AS YOU GO</span><h2>주변에서 다음 장소 고르기</h2></div></div><p class="section-intro">기본 지도에는 가고 싶은 맛집만 표시합니다. ‘도쿄 전체’는 반경 제한이 없고, ‘맛집 분포만’에서는 가까운 맛집을 개수로 묶어 비교할 수 있습니다. 장소를 고르면 그 주변으로 좁혀 볼 수 있습니다.</p><div class="explore-tabs" role="group" aria-label="주변 후보 목록"><button data-list-tab="food" aria-pressed="${state.listTab==='food'}">맛집</button><button data-list-tab="recommendations" aria-pressed="${state.listTab==='recommendations'}">추천 장소</button><button data-list-tab="route" aria-pressed="${state.listTab==='route'}">방문 장소</button><button data-list-tab="saved" aria-pressed="${state.listTab==='saved'}">★ 관심</button></div>${state.listTab==='food'?`<label class="search-box"><span aria-hidden="true">⌕</span><input id="food-search" type="search" aria-label="지도 맛집 검색" placeholder="메뉴·가게·엑셀 번호 검색" value="${esc(state.foodQuery)}"></label>`:''}<div id="food-results"></div>`;
  renderExplorerResults();
}

function filteredPlaces(){
  const q=state.query.trim().toLocaleLowerCase();
  return data.places.filter(p=>!p.duplicateOf&&(state.includeUnreviewed||defaultVisible(p))&&(state.kind==='all'||purposeCategory(p)===state.kind)&&(!q||[p.name,p.area,p.summary,p.address,...(p.videoIds||[])].join(' ').toLocaleLowerCase().includes(q)));
}
function compilationHtml(){
  const selected=data.compilations.filter(v=>data.selectedVideoIds.includes(v.id));
  return selected.map(v=>`<details class="prepare-card"><summary>${esc(v.id)} · 선택한 모음 영상의 가게들</summary><p>모음 영상 선택을 모든 가게의 필수 방문으로 처리하지 않았습니다.</p>${link(v.video_url,v.title)}<ul>${v.restaurant_names.map((name,i)=>`<li>${v.source_map_urls?.[i]?link(v.source_map_urls[i],name):esc(name)}</li>`).join('')}</ul></details>`).join('');
}
function renderPlaceResults(){
  const list=filteredPlaces();
  const groups=Object.entries(TripMap.categories).map(([id,c])=>({id,...c,items:list.filter(p=>purposeCategory(p)===id)})).filter(g=>g.items.length);
  $('#place-results').innerHTML=`<div class="result-count">${list.length}곳 · 지도와 같은 분류 · 음식점은 같은 가게의 영상을 묶어서 표시</div>${groups.map(g=>`<section class="collection-group" aria-label="${esc(g.label)}"><h3 class="collection-heading"><span class="purpose-legend" style="background:${g.color}">${g.icon}</span>${esc(g.label)} <small>${g.items.length}곳</small></h3><div class="places-grid">${g.items.map(placeCard).join('')}</div></section>`).join('')||'<div class="empty-state">검색 결과가 없습니다. 다른 이름이나 지역으로 찾아보세요.</div>'}`;
}
function renderPlaces(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">YOUR COLLECTION</span><h2>장소 보관함</h2></div>${badge('지도와 같은 분류')}</div><p class="section-intro">방문 장소와 엑셀에서 고른 맛집을 모았습니다. 음식점의 식사 시간은 아직 미확정입니다.</p><label class="search-box"><span aria-hidden="true">⌕</span><input id="place-search" type="search" placeholder="가게 이름, 지역, 엑셀 번호로 검색" aria-label="장소 검색" value="${esc(state.query)}"></label><div class="chip-row" role="group" aria-label="장소 종류"><button data-kind="all" class="${state.kind==='all'?'active':''}">전체</button>${Object.entries(TripMap.categories).map(([k,c])=>`<button data-kind="${k}" class="${state.kind===k?'active':''}">${c.icon} ${c.label}</button>`).join('')}</div><label class="check-control" style="margin-bottom:16px"><input type="checkbox" id="unreviewed-toggle" ${state.includeUnreviewed?'checked':''}>보류·제외·미검토 맛집도 포함하기</label><div id="place-results"></div><div style="margin-top:20px">${compilationHtml()}</div><p class="data-note">원본 ${data.videoCount}개 도쿄 후보 영상에서 가게별로 묶었습니다. 모음 영상은 별도로 보관합니다. 엑셀 상태는 사이트를 생성한 시점의 사본입니다.</p>`;
  renderPlaceResults();
}
function renderPrepare(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">BEFORE YOU GO</span><h2>예약과 준비</h2></div></div>${diningGuideHtml()}
    <article class="prepare-card featured">${badge('미예약 · 공개 시각 재확인','red')}<h3>Ramen Break Beats</h3><p>10.31 토요일 · 성인 1명 · 이른 점심 도전</p><div class="reserve-date">10.24 SAT / 21:00 <small>KST · JST</small></div><p>현재 공지에 따른 예약 공개 예상 시각입니다. 실제 영업·시간대는 예약 화면에서 확인합니다. 예약 결과가 토요일 동선을 결정합니다.</p>${link('https://www.tablecheck.com/ja/shops/ramenbreakbeats/reserve','TableCheck 예약 페이지 ↗','button-link')}<ul><li>예약 15분 전 도착 안내</li><li>수수료 500엔 · 전날부터 취소료 2,000엔 안내</li><li>실패 시 스즈하루 등 후보로 전환</li></ul><p>조건은 예약 시 표시되는 최신 안내를 우선합니다.</p></article>
    <article class="prepare-card">${badge('숙소 예약 완료')}<h3>APA 우에노 히로코지 기준 동선</h3><p>10.30 체크인 → 11.01 체크아웃 · 성인 1명 / 1실 / 2박. 사용자가 APA 우에노 히로코지 예약 완료를 확인했습니다. 결제 금액과 취소 조건은 예약 확인서 기준입니다.</p><div class="hotel-links">${link('https://www.apahotel.com/hotel/syutoken/tokyo/ueno-hirokoji/','APA 호텔 우에노 히로코지 ↗')}${link('https://www.booking.com/hotel/jp/apa-hotel-ueno-hirokoji.ko.html?checkin=2026-10-30&checkout=2026-11-01&group_adults=1&no_rooms=1&group_children=0&selected_currency=KRW','예약 사이트 ↗')}</div></article>
    <article class="prepare-card">${badge('약 $100 · 약간 초과 가능')}<h3>달콤한 한 병, 혹은 스모키한 한 병</h3><p>리커즈 하세가와에서 비교할 후보입니다. 아래는 10.20 웹 표시 가격(세금 포함, 700ml)이며 방문일 재고·가격은 별도입니다.</p>${data.whisky.candidates.map(w=>`<div class="whisky-row"><div><b>${link(w.url,w.name+' ↗')}</b><small>${esc(w.style)}</small></div><span>¥${w.price.toLocaleString('ja-JP')}</span></div>`).join('')}<p>두 스타일을 함께 고르면 글렌알라키 12년 + 탈리스커 10년 = 14,880엔도 비교 후보입니다. 최종 구매는 현장에서 결정합니다.</p></article>
    <article class="prepare-card"><h3>쇼핑에서 남은 확인</h3><ul><li>신발: RFW·SPINGLE 긴자에서 피팅할 상품 확인. PRAS 하라주쿠는 이번 동선에서 보류</li><li>포켓몬: 30주년·그 밖의 한정 굿즈 우선, 재고는 미확인</li><li>음식점은 후순위, 원단 매장은 현재 동선에서 제외. 기존 후보는 장소 보관함에 유지</li><li>항공편: 예상 시간 기준이며 발권 완료 여부 미확인</li></ul></article>
    <article class="prepare-card"><h3>내 기록 보관하기</h3><p>방문 체크·관심·메모는 이 브라우저에 저장됩니다. 다른 기기로 옮기거나 보관하려면 내보내기 파일을 사용하세요. 가져오기는 파일에 있는 같은 장소의 기록을 덮어씁니다.</p><button class="button-link" data-action="export">체크·메모 내보내기</button> <button class="button-link" data-action="import">가져오기</button></article>`;
}

function mapPlaces(){
  const hotelBars=data.places.filter(p=>p.hotelFood?.group==='hotel-bars'&&p.coords&&TripExplore.reviewMatch(p,state.reviewFilter,records[p.id]));
  const candidates=[...mappedRoutePlaces(),...foodCandidates().filter(p=>p.coords),...hotelBars,...nearbyRecommendations(),...(state.showFabric?data.places.filter(p=>p.kind==='fabric'&&p.coords):[])];
  return [...new Map(candidates.map(p=>[p.id,p])).values()].filter(p=>state.mapCategories.includes(purposeCategory(p)));
}

function setMapStyle(style){
  if(!map)return;
  if(baseLayer)map.removeLayer(baseLayer);
  state.mapStyle=style;
  if(style==='simple'&&window.maplibregl&&L.maplibreGL){
    try{
      baseLayer=L.maplibreGL({style:'https://tiles.openfreemap.org/styles/positron',attribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
    }catch{
      state.mapStyle='detail';
      message('이 환경에서는 간략 지도를 표시하지 못해 상세 지도로 전환했습니다.');
    }
  }else state.mapStyle='detail';
  if(state.mapStyle==='detail')baseLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
  $('#map-style').value=state.mapStyle;
}

function initMap(){
  if(!window.L){$('#map').hidden=true;$('#map-fallback').hidden=false;return;}
  map=L.map('map',{scrollWheelZoom:true,minZoom:1,maxZoom:19}).setView(state.center,14);
  setMapStyle(state.mapStyle);mapLayer=L.layerGroup().addTo(map);focusLayer=L.layerGroup().addTo(map);
  ensureFoodLayer();
  map.on('moveend',()=>{const center=map.getCenter();const moved=distanceKm([center.lat,center.lng],state.center)>.05;const b=$('[data-action="search-map-center"]');b.classList.toggle('pending',moved);b.textContent=moved?'⌖ 이 지역에서 다시 찾기':'⌖ 이 주변에서 찾기';});
}
function ensureFoodLayer(){
  if(foodLayer&&foodLayerMode===state.foodDisplay)return;
  if(foodLayer)map.removeLayer(foodLayer);
  foodLayer=(state.foodDisplay==='clusters'&&L.markerClusterGroup?L.markerClusterGroup({maxClusterRadius:55,showCoverageOnHover:false,spiderfyOnMaxZoom:true,animate:false,iconCreateFunction:cluster=>L.divIcon({className:'food-cluster purpose-cluster',html:`<span>食 ${cluster.getChildCount()}</span>`,iconSize:[48,38]})}):L.layerGroup()).addTo(map);
  foodLayerMode=state.foodDisplay;
}
function updateMap(fit=true){
  if(!map)return;
  ensureFoodLayer();
  mapLayer.clearLayers();foodLayer.clearLayers();focusLayer.clearLayers();markers.clear();syncExploreControls();
  $('#show-food').checked=state.showFood;$('#show-fabric').checked=state.showFabric;
  $('#food-scope').value=state.foodScope;$('#food-meal').value=state.foodMeal;
  const visible=mapPlaces(),list=foodCandidates();
  $('#map-legend').innerHTML=Object.entries(TripMap.categories).filter(([id])=>state.mapCategories.includes(id)).map(([id,c])=>`<span><i class="purpose-legend" style="background:${c.color}">${c.icon}</i>${c.label}</span>`).join('')+(state.showRoute?selectedDays().filter(d=>d.steps.filter(s=>s.place).length>1).map(d=>`<span><i class="route-legend-line" style="--route-color:${dayColors[d.id]}"></i>${esc(d.date)} ${esc(d.weekday[0])} 참고 순서</span>`).join(''):'');
  $('#map-scope-note').textContent=state.foodDisplay==='clusters'?'食 뒤 숫자는 화면에서 가까운 맛집을 묶은 개수입니다. 원을 누르면 확대됩니다. 도보 반경이나 인구 밀도가 아닙니다.':'개별 핀: 확대 전에도 선택한 맛집의 위치를 모두 표시합니다. 같은 위치의 핀은 겹칠 수 있어 묶음 보기로도 비교할 수 있습니다.';
  const foodCount=visible.filter(p=>purposeCategory(p)==='food').length,barCount=visible.filter(p=>purposeCategory(p)==='bar').length;
  $('#food-map-count').textContent=`맛집 ${foodCount}곳 · 술집 ${barCount}곳 · 다른 방문 장소 ${visible.length-foodCount-barCount}곳`;
  if(state.showRoute)for(const d of selectedDays()){
    const stops=d.steps.filter(s=>s.place).map(s=>places.get(s.place)).filter(p=>p.coords);
    for(let i=1;i<stops.length;i++)L.polyline([stops[i-1].coords,stops[i].coords],{color:dayColors[d.id],weight:2,opacity:.5,dashArray:'5 8',interactive:false}).addTo(mapLayer);
  }
  if(state.foodScope==='nearby'){
    L.circle(state.center,{radius:state.radiusKm*1000,color:'#537b9c',weight:1,dashArray:'4 6',fillOpacity:.035,interactive:false}).addTo(focusLayer);
    L.circleMarker(state.center,{radius:5,color:'#537b9c',fillColor:'#fff',fillOpacity:1,weight:2,interactive:false}).addTo(focusLayer);
    if(state.anchorId==='user'&&state.userPosition)L.circle(state.center,{radius:Math.min(state.userPosition.accuracy,5000),color:'#537b9c',weight:0,fillOpacity:.08,interactive:false}).addTo(focusLayer);
  }
  for(const p of visible){
    const route=!!p.visits,purpose=purposeCategory(p),design=TripMap.categories[purpose],must=isMust(p);
    const icon=L.divIcon({className:'',html:`<span class="map-pin purpose-pin purpose-${purpose}${must?' priority-must':''}" style="--pin-color:${design.color}">${design.icon}${must?'<small class="pin-priority">꼭</small>':''}${route&&state.showRoute&&p.kind!=='hotel'?`<small class="pin-order">${esc(p.routeOrder)}</small>`:''}</span>`,iconSize:[32,32],iconAnchor:[16,16]});
    const quick=p.kind==='food'?`<span class="popup-note">${esc(nearbyLabel(p))}<br>${esc(p.hotelFood?.menu||p.summary)}<br>${esc(p.diningResearch?p.diningResearch.hours:p.hotelFood?(state.day==='all'?hoursLabel(p)+' · 상세에서 확인':p.hotelFood.hours[state.day]):'영업 미확인 · 지도에서 재확인')}</span>${link(contextDirections(p),state.foodScope==='nearby'?'기준점에서 길찾기 ↗':'Google 길찾기 ↗','popup-link')}`:`${p.buildingName?arrivalHtml(p):`<span class="popup-note">${esc(p.exploreTip||p.summary)}</span>`}<button class="popup-link" data-nearby="${esc(p.id)}">이 장소 주변 맛집 →</button>`;
    const marker=L.marker(p.coords,{icon,title:p.name,keyboard:true,zIndexOffset:p.kind==='hotel'?500:route?300:0}).addTo(purpose==='food'?foodLayer:mapLayer).bindPopup(`<b>${esc(p.name)}</b>${must?' · 꼭 가고 싶음':''}<br>${esc(design.label)} · ${esc(p.area)} · ${esc(p.status)}${quick}<button class="popup-link" data-place="${esc(p.id)}">${p.kind==='food'?'메뉴·시간·메모':p.buildingName?'상세·층수·메모':'상세·메모'} →</button> &nbsp;${interestButton(p)}`,p.buildingName?{minWidth:250,maxWidth:290,autoPanPaddingTopLeft:[12,52],autoPanPaddingBottomRight:[12,12]}:{});
    markers.set(p.id,marker);
  }
  const hotelBars=state.foodScope==='hotel30'&&state.foodMeal==='afterDinner';
  $('#map-title').textContent=hotelBars?'호텔 근처의 술집':state.foodScope==='city'?'도쿄 전체 · '+(state.reviewFilter==='must'?'꼭 가고 싶은 맛집':state.reviewFilter==='regular'?'가고 싶은 맛집 · 일반 후보':state.reviewFilter==='가고 싶음'?'가고 싶은 맛집':'선택한 후보'):state.foodScope==='route'?'방문권역 주변에서 탐색':state.foodScope==='nearby'?state.centerLabel+' 주변':'후보를 넓게 비교하기';
  requestAnimationFrame(()=>{const container=map.getContainer();if(!container.clientWidth||!container.clientHeight)return;map.invalidateSize();const fitPlaces=hotelBars?[places.get(data.routePlan.hotelId),...list.filter(p=>p.coords)]:state.showRoute?mappedRoutePlaces():visible;if(fit&&fitPlaces.length)map.fitBounds(L.latLngBounds(fitPlaces.map(p=>p.coords)),{padding:[30,30],maxZoom:hotelBars?16:14,animate:false});});
}
function locatePlace(id){
  const p=places.get(id);if(!p?.coords)return;
  if(p.kind!=='food'){selectFocus(id);return;}
  if(!foodCandidates().some(x=>x.id===id)){
    state.foodScope='nearby';state.center=p.coords;state.centerLabel=p.name;state.anchorId='map';state.foodMeal='all';state.foodQuery='';state.reviewFilter='all';state.categories=['picked','unreviewed','recommended'];
  }
  enableMapCategory(purposeCategory(p));
  state.view='map';state.showFood=true;render();
  $('#map-pane').scrollIntoView({behavior:'smooth',block:'start'});
  const marker=markers.get(id);if(!marker)return;
  map.setView(p.coords,16,{animate:false});
  if(foodLayer.zoomToShowLayer&&foodLayer.hasLayer(marker))foodLayer.zoomToShowLayer(marker,()=>marker.openPopup());else marker.openPopup();
}

function closePlace(){
  const dialog=$('#place-dialog');
  if(!dialog.open)return;
  dialog.close();dialogPlace=null;
  if(history.state?.[DIALOG_HISTORY_KEY]){
    dialogBackPending=true;
    history.back();
  }
}
window.addEventListener('popstate',e=>{
  dialogBackPending=false;
  const id=e.state?.[DIALOG_HISTORY_KEY];
  if(places?.has(id)){openPlace(id,false);return;}
  if($('#place-dialog').open)$('#place-dialog').close();
  dialogPlace=null;
});
$('#place-dialog').addEventListener('cancel',e=>{e.preventDefault();closePlace();});

function openPlace(id,syncHistory=true){
  const p=places.get(id);if(!p||dialogBackPending)return;
  dialogPlace=id;
  $('#dialog-content').innerHTML=`<span class="area-label">${esc(p.area)} / ${esc(kinds[p.kind])}</span><h2>${esc(p.name)}</h2>${badge(p.status,tone(p))}<p>${esc(p.summary)}</p><div class="detail-address">${esc(p.address||'주소 확인 필요')}</div><div class="detail-actions">${link(p.directionsUrl,'길안내 ↗','primary')}${link(p.mapUrl,'Google 지도 ↗')}${p.url?link(p.url,p.id==='food-G034'?'예약 페이지 ↗':'사이트 ↗'):''}${p.browse?link(p.browse,'상품 둘러보기 ↗'):''}${p.store?link(p.store,'매장 안내 ↗'):''}</div>${p.detail&&!p.hotelFood&&!p.diningResearch?`<p>${esc(p.detail)}</p>`:''}${p.hours&&!p.hotelFood&&!p.diningResearch?`<div class="detail-info">영상에 안내된 영업시간: ${esc(p.hours)}<br>방문일 영업시간은 다시 확인해 주세요.</div>`:''}${p.diningResearch?researchHtml(p,true):p.hotelFood?diningHtml(p,true):''}${p.exploreTip?`<div class="detail-info">${esc(p.exploreTip)}<br>${link(p.exploreTipUrl,'같은 층 공식 매장 안내 ↗')}</div>`:''}<div class="detail-info">${esc(p.coordinateNote)}</div>${p.kind==='food'?foodPreferences(p):''}${check(p)} ${interestButton(p)}${p.kind!=='food'?`<button class="button-link" data-nearby="${esc(p.id)}">이 장소 주변 맛집</button>`:''}<label class="note-label" for="place-note">나의 메모</label><textarea id="place-note" maxlength="4000" placeholder="사고 싶은 상품, 고를 메뉴, 현장에서 확인할 것…">${esc(records[id]?.note||'')}</textarea><div class="note-hint">자동 저장 · 현재 브라우저에만 보관</div>${p.videos?.length?`<details class="source-videos"><summary>관련 Shorts ${p.videos.length}개 · 원본 확인</summary>${p.videos.map(v=>link(v.url,v.id+' · '+v.title+(v.selection==='가고 싶음'?' ✓':''))).join('')}</details>`:''}`;
  if(p.buildingName)$('#dialog-content .detail-address').insertAdjacentHTML('afterend',arrivalHtml(p,true));
  if(p.kind==='food')$('#dialog-content').insertAdjacentHTML('beforeend',`${link(contextDirections(p),state.foodScope==='nearby'?'탐색 기준점에서 길찾기 ↗':'Google 길찾기 ↗','button-link')}<div class="food-distance">${distanceHtml(p)}${link(hotelDirections(p),'호텔에서 길찾기 ↗')}</div>${p.locationWarning?`<div class="detail-info">${esc(p.locationWarning)}${p.originalAddress?'<br>영상 속 주소: '+esc(p.originalAddress):''}${p.addressSource?'<br>'+link(p.addressSource,'현재 주소 출처 ↗'):''}</div>`:''}${p.coordinateSource?link(p.coordinateSource,'위치 검색 근거 ↗','small-link'):''}`);
  if(!$('#place-dialog').open)$('#place-dialog').showModal();
  if(syncHistory){
    const entry={...history.state,[DIALOG_HISTORY_KEY]:id};
    if(history.state?.[DIALOG_HISTORY_KEY])history.replaceState(entry,'');
    else history.pushState(entry,'');
  }
}
function exportRecords(){
  const reviewRows=(data.reviewVideos||[]).map(v=>({id:v.id,restaurant:v.restaurant,videoUrl:v.url,excelSelection:v.selection,selection:TripReview.selection(v,videoReviews),note:videoReviews[v.id]?.note||'',reviewedAt:videoReviews[v.id]?.reviewedAt||'',source:videoReviews[v.id]?'web':'excel'}));
  const groupedReviews=reviewGroups.map(g=>({placeId:g.placeId,videoIds:g.videoIds,restaurant:g.restaurant,selection:TripReview.groupSelection(g,videoReviews),note:TripReview.groupNote(g,videoReviews),priority:g.placeId&&isMust(places.get(g.placeId))?'must':'normal',mapCategory:g.placeId?purposeCategory(places.get(g.placeId)):null}));
  const content=JSON.stringify({format:'tokyo-trip-records',version:2,trip:'2026-10-30',exportedAt:new Date().toISOString(),records,videoReviews,reviewRows,groupedReviews},null,2);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));a.download='tokyo-trip-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);message('검토 결과·방문 체크·관심·메모를 내보냈습니다. 다운로드한 파일을 보관해 주세요.');
}

document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.view){const sameMap=state.view==='map'&&b.dataset.view==='map';state.view=b.dataset.view;if(!sameMap){render();if(state.view==='map')updateMap(true);}if(sameMap)$('#map-pane').scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(b.dataset.day){state.day=b.dataset.day;render();if(state.foodScope==='route')updateMap(true);return;}
  if(b.dataset.listTab){state.listTab=b.dataset.listTab;renderMapList();return;}
  if(b.dataset.foodArea){const points=foodCandidates().filter(p=>p.coords&&purposeCategory(p)==='food'&&TripMap.area(p)===b.dataset.foodArea);if(points.length){map.fitBounds(L.latLngBounds(points.map(p=>p.coords)),{padding:[35,35],maxZoom:15,animate:false});$('#map-pane').scrollIntoView({block:'start'});}return;}
  if(b.dataset.reviewPage!==undefined){state.reviewPage=Math.max(0,Number(b.dataset.reviewPage)||0);renderReviewResults();$('#review-results').scrollIntoView({block:'start'});return;}
  if(b.dataset.nearby){selectFocus(b.dataset.nearby);return;}
  if(b.dataset.interest){
    const id=b.dataset.interest;records[id]={...(records[id]||{}),interested:!records[id]?.interested};saveRecords();
    document.querySelectorAll('[data-interest]').forEach(button=>{if(button.dataset.interest===id){button.textContent=records[id].interested?'★ 관심 저장됨':'☆ 관심 저장';button.classList.toggle('saved',records[id].interested);button.setAttribute('aria-pressed',String(records[id].interested));button.setAttribute('aria-label',places.get(id).name+' 관심 '+(records[id].interested?'해제':'저장'));}});
    if(state.view==='map'&&state.listTab==='saved')renderExplorerResults();return;
  }
  if(b.dataset.locate){locatePlace(b.dataset.locate);return;}
  if(b.dataset.kind){state.kind=b.dataset.kind;renderPlaces();return;}
  if(b.dataset.place){openPlace(b.dataset.place);return;}
  switch(b.dataset.action){
    case 'close-dialog':closePlace();break;
    case 'map-fit':updateMap(true);break;
    case 'route-overview':showRouteOverview();break;
    case 'city-wanted':showCityWanted();break;
    case 'food-distribution':showCityWanted(true);break;
    case 'dining-guide':state.view='prepare';render();$('#dining-guide')?.scrollIntoView({block:'start'});break;
    case 'search-map-center':selectFocus('map');break;
    case 'my-location':getMyLocation();break;
    case 'list-jump':$('#left-pane').scrollIntoView({behavior:'smooth',block:'start'});break;
    case 'hotel-food-fit':state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;render();updateMap(true);break;
    case 'hotel-bars':enableMapCategory('bar');state.view='map';state.showFood=true;state.listTab='food';state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;state.foodMeal='afterDinner';state.foodQuery='';state.reviewFilter='all';state.includeUnknownHours=false;state.categories=['picked','unreviewed','recommended'];render();updateMap(true);break;
    case 'review-unreviewed':state.reviewStatus='미검토';state.reviewPage=0;state.reviewQuery='';renderReview();break;
    case 'review-map-wanted':showCityWanted();break;
    case 'review-map-must':showCityWanted(false,'must');break;
    case 'city-must':showCityWanted(false,'must');break;
    case 'food-toggle':enableMapCategory('food');state.view='map';render();break;
    case 'export':exportRecords();break;
    case 'import':$('#import-file').click();break;
  }
});
document.addEventListener('change',e=>{
  if(e.target.dataset.mustPlace||e.target.dataset.foodRole){
    const id=e.target.dataset.mustPlace||e.target.dataset.foodRole,p=places.get(id);
    if(!p||p.kind!=='food')return;
    const next={...(records[id]||{})};
    if(e.target.dataset.mustPlace){
      if(p.reviewSelection!=='가고 싶음')return;
      next.priority=e.target.checked?'must':'normal';
    }else if(['food','bar'].includes(e.target.value))next.mapCategory=e.target.value;
    else delete next.mapCategory;
    next.preferenceUpdatedAt=new Date().toISOString();
    records[id]=TripExplore.normalizeRecord(next);saveRecords();
    if(state.view==='review')renderReviewResults();
    if(state.view==='places')renderPlaceResults();
    if(state.view==='map'){renderExplorerResults();updateMap(false);}
    return;
  }
  if(e.target.dataset.mapCategory){state.mapCategories=[...document.querySelectorAll('[data-map-category]:checked')].map(x=>x.dataset.mapCategory);state.showFood=state.mapCategories.includes('food');renderExplorerResults();updateMap(e.target.checked);return;}
  if(e.target.id==='food-display'){state.foodDisplay=e.target.value;updateMap(false);return;}
  if(e.target.dataset.videoReview){setVideoReview(e.target.dataset.videoReview,{selection:e.target.value});renderReviewResults();return;}
  if(e.target.id==='review-status'){state.reviewStatus=e.target.value;state.reviewPage=0;renderReviewResults();return;}
  if(e.target.id==='food-review'){state.reviewFilter=e.target.value;renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='map-style'){setMapStyle(e.target.value);return;}
  if(e.target.id==='explore-anchor'){selectFocus(e.target.value);return;}
  if(e.target.id==='explore-radius'){state.radiusKm=Number(e.target.value);renderExplorerResults();updateMap(false);if(state.foodScope==='nearby')fitFocus();return;}
  if(e.target.id==='show-food'){state.showFood=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-fabric'){state.showFabric=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-route'){state.showRoute=e.target.checked;if(state.showRoute)enableRouteCategories();renderExplorerResults();updateMap(state.showRoute);return;}
  if(e.target.id==='show-recommendations'){state.showRecommendations=e.target.checked;renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='include-unknown-hours'){state.includeUnknownHours=e.target.checked;renderExplorerResults();updateMap(false);return;}
  if(e.target.dataset.foodCategory){state.categories=[...document.querySelectorAll('[data-food-category]:checked')].map(x=>x.dataset.foodCategory);renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='food-meal'){state.foodMeal=e.target.value;if(state.foodMeal==='afterDinner'){enableMapCategory('bar');state.reviewFilter='all';state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;state.includeUnknownHours=false;syncExploreControls();$('#food-scope').value=state.foodScope;}if(state.view==='map')renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='food-scope'){state.foodScope=e.target.value;if(state.view==='map')renderMapList();updateMap(!['nearby'].includes(state.foodScope));if(state.foodScope==='nearby')fitFocus();return;}
  if(e.target.dataset.check){const id=e.target.dataset.check;records[id]={...(records[id]||{}),done:e.target.checked};saveRecords();render();}
  if(e.target.id==='unreviewed-toggle'){state.includeUnreviewed=e.target.checked;renderPlaceResults();}
});
document.addEventListener('input',e=>{
  if(e.target.dataset.videoNote){setVideoReview(e.target.dataset.videoNote,{note:e.target.value});return;}
  if(e.target.id==='review-search'){state.reviewQuery=e.target.value;state.reviewPage=0;renderReviewResults();return;}
  if(e.target.id==='food-search'){state.foodQuery=e.target.value;renderFoodResults();updateMap(false);return;}
  if(e.target.id==='place-search'){state.query=e.target.value;renderPlaceResults();}
  if(e.target.id==='place-note'&&dialogPlace){records[dialogPlace]={...(records[dialogPlace]||{}),note:e.target.value};saveRecords();}
});
$('#import-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>8*1024*1024)throw new Error('파일 크기');
    const parsed=JSON.parse(await file.text());
    if(parsed.format!=='tokyo-trip-records'||![1,2].includes(parsed.version)||parsed.trip!=='2026-10-30')throw new Error('형식');
    const imported=validateRecords(parsed.records);
    for(const record of Object.values(imported))if(!record.preferenceUpdatedAt)record.preferenceUpdatedAt=parsed.exportedAt||new Date().toISOString();
    records={...records,...imported};
    if(parsed.version===2)videoReviews={...videoReviews,...TripReview.normalizeReviews(parsed.videoReviews,new Set(reviewVideoMap.keys()))};
    saveRecords();saveVideoReviews();applyReviewSelections();render();message('저장한 기록을 가져왔습니다. 같은 항목은 파일의 기록으로 갱신했습니다.');
  }catch{message('기록을 가져오지 못했습니다. 이 여행 노트에서 내보낸 JSON 파일인지 확인해 주세요.');}
  e.target.value='';
});
async function start(){
  const response=await fetch('./trip-data.json?v=20261027-dining',{cache:'no-cache'});if(!response.ok)throw new Error('데이터 불러오기');
  data=await response.json();places=new Map(data.places.map(p=>[p.id,p]));
  reviewVideoMap=new Map((data.reviewVideos||[]).map(v=>[v.id,v]));
  reviewGroups=TripReview.groups(data.reviewVideos||[],data.places);
  state.center=places.get(data.routePlan.hotelId).coords;loadRecords();records=TripExplore.mergePreferenceBaseline(data.reviewBaseline||{},records);loadVideoReviews();applyReviewSelections();initMap();render();renderProgress();updateMap(true);
  if(places.has(history.state?.[DIALOG_HISTORY_KEY]))openPlace(history.state[DIALOG_HISTORY_KEY],false);
}
start().catch(()=>message('여행 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
