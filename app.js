'use strict';
const KEY = 'tokyo-trip-20261030-records-v1';
const REVIEW_KEY='tokyo-trip-20261030-video-reviews-v1';
const REVIEW_UI_KEY='tokyo-trip-20261030-review-ui-v1';
const REVIEW_PAGE_SIZE=20;
const PURCHASE_KEY='tokyo-trip-20261030-purchases-v1';
const REVIEW_MENU_KEY='tokyo-trip-20261030-show-review-menu-v1';
let showReviewMenu=false;
let purchaseLog=TripPurchase.empty(),purchaseDraft=null,purchaseUndo=null,purchaseLoadError=false;
const kinds = {pokemon:'포켓몬',card:'카드숍',shoe:'신발',fabric:'원단',whisky:'위스키',food:'맛집',hotel:'숙소',shopping:'쇼핑',sight:'관광'};
const kindIcons = {pokemon:'P',card:'C',shoe:'S',fabric:'F',whisky:'W',food:'食',hotel:'H',shopping:'S',sight:'T'};
const dayColors = {fri:'#b94936',sat:'#3c6256',sun:'#476a94'};
const state = {view:'map',day:'all',showFood:true,showFabric:false,foodScope:'city',foodMeal:'all',foodQuery:'',mapStyle:'simple',kind:'all',query:'',includeUnreviewed:false,listTab:'food',radiusKm:1,center:null,anchorId:'city',centerLabel:'도쿄 전체',includeUnknownHours:false,categories:['picked','unreviewed','recommended'],showRecommendations:false,showRoute:false,userPosition:null};
Object.assign(state,{reviewFilter:'가고 싶음',reviewStatus:'all',reviewQuery:'',reviewPage:0,foodDisplay:'pins',mapCategories:['food','bar'],akibaRoute:null});
Object.assign(state,{mapFocusId:null,mapFocusViewport:null});
Object.assign(state,{browseMode:'map',browseCollection:'current'});
let data, places, records={}, map, mapLayer, foodLayer, baseLayer, dialogPlace, focusLayer;
let foodLayerMode;
let mapUpdateRevision=0;
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
  if(data.manualPlacePreferences?.videoReviews){
    const requested=TripReview.normalizeReviews(data.manualPlacePreferences.videoReviews,new Set(reviewVideoMap.keys()));
    videoReviews=TripReview.mergeBaseline(requested,videoReviews);
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
function routePlaces(){return selectedDays().flatMap(d=>TripMap.routeStops(d,places));}
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
const mealLabels={breakfast:'아침',lunch:'점심',dinner:'저녁',drinks:'저녁 + 술',afterDinner:'식후 한잔·술집'};
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
  const google=h.googleReview;
  const googleHtml=google?`<div class="detail-info"><b>${link(google.url,`Google ★ ${google.rating.toFixed(1)} · 리뷰 ${google.reviewCount.toLocaleString('ko-KR')}개 ↗`)}</b><br><small>${esc(google.checkedAt)} 확인 · 실시간 연동 아님 · 일부 후기 요약</small><p>${esc(google.summary)}</p></div>`:'';
  return `${hotelTravelHtml(p)}${googleHtml}<div class="meal-tags">${h.meals.filter(m=>m!=='drinks'||h.group!=='hotel-bars').map(m=>badge(mealLabels[m],m==='drinks'?'wine':m==='breakfast'?'morning':'soft')).join('')}</div><p class="meal-menu">${esc(h.menu)}</p>${h.caution?`<p class="dining-caution">${esc(h.caution)}</p>`:''}<div class="hours-grid">${data.days.map(d=>`<div class="${state.day===d.id?'chosen-day':''}"><b>${esc(d.date)} ${esc(d.weekday[0])}</b><span>${esc(h.hours[d.id])}</span></div>`).join('')}</div><small class="hours-evidence">${esc(h.checkedAt||data.hotelFood.asOf)} 확인 · ${esc(h.hoursEvidence)} · 통상 영업 기준</small>${detail?`<p class="dining-note">${esc(h.note)}</p><div class="dining-sources">${h.sources.map(x=>link(x.url,x.label+' ↗')).join('')}</div>`:`<details class="dining-details"><summary>이용 조건·확인 출처</summary><p>${esc(h.note)}</p>${h.sources.map(x=>link(x.url,x.label+' ↗')).join('')}</details>`}`;
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
  return `<div class="arrival-info"><b>건물 핀 · ${esc(p.buildingName)} ${esc(p.floor)}</b><small>${esc(p.openingNote)}</small>${detail?`<p>${esc(p.accessNote)}</p>${p.floorGuideUrl?link(p.floorGuideUrl,'공식 층별 안내 ↗','small-link'):''}<small>핀은 건물 대표 위치입니다. 건물 도착 후 층수를 확인하세요.</small>`:''}</div>`;
}
function indoorShopsHtml(p){
  if(!p.indoorShops)return '';
  return `<section class="indoor-shops"><h3>같은 건물에서 골라 보기</h3><p>한 건물 핀에 묶었습니다. 관심 있는 층만 방문하세요.</p>${p.indoorShops.map(s=>`<article><b>${esc(s.floor)} · ${esc(s.name)}</b><small>${esc(s.hours)}</small><p>${esc(s.purpose)}</p>${link(s.url,'공식 매장 안내 ↗','small-link')}</article>`).join('')}</section>`;
}
function akibaStops(){return TripMap.excursionStops(data.akihabara,places,state.akibaRoute||'north');}
function showAkibaRoute(mode='north'){
  if(!data.akihabara?.routes[mode])return;
  clearMapPlace(false);
  state.browseMode='map';state.browseCollection='current';state.foodQuery='';
  Object.assign(state,{akibaRoute:mode,view:'map',day:'sat',showRoute:false,showRecommendations:false,foodScope:'route',anchorId:'route',mapCategories:['hobby','hotel','shopping'],listTab:'route'});
  render();updateMap(true);$('#map-pane').scrollIntoView({block:'start'});
}
function akibaGuideHtml(){
  const guide=data.akihabara,route=guide.routes[state.akibaRoute];
  return `<section class="akiba-guide"><span class="eyebrow">AKIHABARA / OPTIONAL STOPS</span><h2>체력에 맞춰 골라 보기</h2><p>${esc(guide.note)}</p><div class="akiba-route-note">${esc(route.note)}</div><p><b>가볍게 볼 때:</b> 라디오회관 + 중고 매장 한 곳 + 카드숍. 식사·휴식은 자유롭게 끼워 넣으세요.</p><div class="akiba-stop-list">${akibaStops().map(p=>`<article class="akiba-stop"><span class="akiba-number">${p.akibaOrder}</span><div><h3><button data-place="${esc(p.id)}">${esc(p.akiba.shortName)}</button></h3><b>${esc(p.akiba.close)}</b><p>${esc(p.akiba.purpose)}</p><small>${esc(p.akiba.hours)} · ${esc(p.akiba.stay)}</small><div class="food-card-actions"><button class="small-link" data-akiba-pin="${esc(p.id)}">지도 핀 보기</button><button class="small-link" data-place="${esc(p.id)}">${p.indoorShops?'층별 매장·상세':'상세·메모'}</button>${link(contextWalking(p),'Google 도보 길찾기 ↗','small-link')}</div></div></article>`).join('')}</div><details class="akiba-targets"><summary>찾을 경주마 인형 · 한·일 이름</summary><p>${guide.horseTargets.map(esc).join('<br>')}</p><small>우마무스메 캐릭터 굿즈와 실제 말 인형은 별개입니다. 매장별 재고는 미확인입니다.</small></details></section>`;
}
function contextWalking(p){return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(p.destinationQuery||p.address||p.name)+'&travelmode=walking';}
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
function syncPlaceBrowser(){
  document.body.dataset.browseMode=state.browseMode;
  document.querySelectorAll('[data-browser-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.browserMode===state.browseMode)));
  if($('#food-search').value!==state.foodQuery)$('#food-search').value=state.foodQuery;
  $('#browse-collection').value=state.browseCollection;
  $('#food-review').value=state.reviewFilter;$('#food-review').disabled=state.browseCollection!=='current';
  const scope={current:'현재 후보',all:'전체 장소',saved:'★ 관심'}[state.browseCollection];
  const labels=state.mapCategories.map(id=>TripMap.categories[id].label);
  $('#browse-filter-summary').textContent='분류·목록 필터 · '+(labels.length===6?'전체 종류':labels.length?labels.join(' / '):'선택한 종류 없음')+' · '+scope;
  $('#browse-collection-note').textContent=state.browseCollection==='current'?'선택한 맛집과 현재 동선·추가 후보를 표시합니다. 지도에서 정한 탐색 범위와 식사 필터를 따릅니다.':state.browseCollection==='all'?'동선·날짜·검토 상태와 관계없이 보관한 모든 장소를 검색합니다. 종류와 검색어는 그대로 적용됩니다.':'관심을 저장한 장소를 동선과 관계없이 표시합니다. 종류와 검색어는 그대로 적용됩니다.';
}
function setBrowseMode(mode){
  if(!['map','list'].includes(mode))return;
  if(mode==='list'&&state.akibaRoute){state.akibaRoute=null;renderMapList();}
  state.browseMode=mode;syncPlaceBrowser();
  if(mode==='map')updateMap(false);
  $('#place-browser').scrollIntoView({block:'start'});
}
function refreshPlaceBrowser(){
  if(state.akibaRoute){state.akibaRoute=null;renderMapList();}else renderExplorerResults();
  updateMap(false);
}
function syncExploreControls(){
  syncPlaceBrowser();
  $('#map-pane').classList.toggle('collection-wide',state.browseCollection!=='current');
  const selected=places.get(state.mapFocusId),focusBox=$('#map-place-focus');
  $('#map-pane').classList.toggle('place-focused',!!selected);
  focusBox.hidden=!selected;
  if(selected){$('#map-focus-name').textContent=selected.name;$('#map-focus-status').textContent=state.userPosition?'선택 장소 · 숙소 · 확인한 내 위치만 표시합니다.':'선택 장소 · 숙소만 표시 중 · ‘내 위치’를 누르면 현재 위치가 추가됩니다.';}
  $('[data-action="route-overview"]').disabled=false;
  $('[data-action="dining-guide"]').disabled=false;
  const akibaTools=$('#akiba-map-tools');akibaTools.hidden=!state.akibaRoute;
  $('#map-pane').classList.toggle('akiba-active',!!state.akibaRoute);
  if(state.akibaRoute)akibaTools.innerHTML=`<b>아키하바라 · 선택 방문 순서</b><div>${Object.entries(data.akihabara.routes).map(([id,r])=>`<button class="button-link" data-action="akiba-${id}" aria-pressed="${state.akibaRoute===id}">${esc(r.label)}</button>`).join('')}</div><small>번호 핀 5곳 · 라디오회관은 건물 하나로 표시 · 매장 수와 순서는 현장에서 조절</small><button class="small-link" data-action="list-jump">매장·마감시간 목록 ↓</button>`;
  $('[data-action="akiba-route"]').setAttribute('aria-pressed',String(!!state.akibaRoute));
  const id=state.foodScope==='city'?'city':state.foodScope==='route'?'route':state.anchorId;
  $('#explore-anchor').innerHTML='<option value="city">도쿄 전체 · 반경 제한 없음</option><option value="route">전체 방문권역 · 참고 동선</option>'+`<option value="map">지도에서 선택한 지역</option>${state.userPosition?'<option value="user">내 위치</option>':''}`+
    '<optgroup label="방문할 장소">'+[...new Map(data.days.flatMap(d=>TripMap.routeStops(d,places).map(p=>[p.id,p]))).values()].map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup><optgroup label="동선을 넓힐 후보">'+recommendationPlaces().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup>';
  $('#explore-anchor').value=id;
  $('#explore-radius').value=String(state.radiusKm);
  $('#explore-radius').closest('label').style.display=state.foodScope==='city'?'none':'';
  $('#include-unknown-hours').checked=state.includeUnknownHours;
  $('#food-review').value=state.reviewFilter;
  $('#food-display').value=state.foodDisplay;
  $('#map-categories').innerHTML=Object.entries(TripMap.categories).map(([id,c])=>`<label class="map-category-chip ${state.mapCategories.includes(id)?'enabled':''}" style="--category-color:${c.color}"><input type="checkbox" data-map-category="${id}" ${state.mapCategories.includes(id)?'checked':''}><span aria-hidden="true">${c.icon}</span>${c.label}</label>`).join('');
  $('#show-recommendations').checked=state.showRecommendations;$('#show-route').checked=state.showRoute;
  document.querySelectorAll('[data-food-category]').forEach(el=>el.checked=state.categories.includes(el.dataset.foodCategory));
  $('#explore-center-label').textContent=state.akibaRoute?'아키하바라 굿즈숍만 확대 · 점선은 선택 순서 · 실제 길찾기는 Google 지도':state.foodScope==='city'?`도쿄 전체 · 반경 제한 없음 · ${state.reviewFilter==='all'?'모든 검토 상태':reviewFilterLabel(state.reviewFilter)+' 맛집'} · 선택한 종류만 지도에 표시`:state.foodScope==='route'?`선택 날짜의 각 방문 장소에서 직선 ${state.radiusKm}km 주변 · 순서는 자유롭게 변경`:
    state.foodScope==='nearby'?`${state.centerLabel} · 직선 반경 ${state.radiusKm}km${state.anchorId==='user'?' · 위치는 저장하지 않습니다':''}`:
    state.foodScope==='hotel30'?`호텔 출발 약 30분권 · 이동·영업 안내가 있는 ${data.places.filter(p=>p.hotelFood?.travel?.within30).length}곳`:'넓게 비교하는 보기 · 장소를 선택하면 그 주변으로 좁힐 수 있습니다';
  if(selected)$('#explore-center-label').textContent='선택한 장소만 보기 · 후보 목록은 기존 필터를 유지합니다.';
  else if(state.browseCollection!=='current')$('#explore-center-label').textContent=state.browseCollection==='all'?'전체 보관함 · 동선·날짜·식사 필터와 관계없이 검색합니다.':'★ 관심 저장한 장소 · 동선과 관계없이 검색합니다.';
}
function enableMapCategory(id){if(!state.mapCategories.includes(id))state.mapCategories.push(id);if(id==='food')state.showFood=true;}
function enableRouteCategories(){for(const p of mappedRoutePlaces())enableMapCategory(purposeCategory(p));}
function showRouteOverview(){
  if(!data)return;
  clearMapPlace(false);
  state.browseMode='map';state.browseCollection='current';
  state.akibaRoute=null;
  Object.assign(state,{view:'map',foodScope:'route',anchorId:'route',centerLabel:'전체 방문권역',listTab:'route',showRoute:true,showRecommendations:false,foodQuery:''});
  enableRouteCategories();render();updateMap(true);$('#map-pane').scrollIntoView({block:'start'});
}
function showCityWanted(foodOnly=false,reviewFilter='가고 싶음'){
  clearMapPlace(false);
  state.browseMode='map';state.browseCollection='current';
  state.akibaRoute=null;
  Object.assign(state,{view:'map',day:'all',listTab:'food',foodScope:'city',anchorId:'city',centerLabel:'도쿄 전체',reviewFilter,foodMeal:'all',foodQuery:'',showFood:true,showRoute:false,showRecommendations:false,includeUnknownHours:false,categories:['picked','unreviewed','recommended'],mapCategories:['food','bar'],foodDisplay:foodOnly?'clusters':'pins'});
  render();updateMap(true);$('#map-pane').scrollIntoView({block:'start'});
}
function selectFocus(id){
  clearMapPlace(false);
  state.browseMode='map';state.browseCollection='current';
  state.akibaRoute=null;
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
    if(state.mapFocusId)updateMap(false);else selectFocus('user');msg.textContent=`현재 위치 확인 · 위치 오차 약 ${Math.round(position.coords.accuracy)}m. 위치 기록은 저장하지 않습니다.`;
  },()=>{button.disabled=false;msg.textContent='위치를 확인하지 못했습니다. 권한·GPS 상태를 확인하거나 장소를 골라 찾아 주세요.';},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}

function locationLabel(p){return {poi:'지도 검색 위치',address:'주소 기준 위치',block:'주소 블록 위치'}[p.locationPrecision]||'위치 미확인';}
function hotelDirections(p){return 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(places.get(data.routePlan.hotelId).address)+'&destination='+encodeURIComponent(p.address.split(' / ')[0]||p.name)+'&travelmode='+(p.hotelFood?.travel?.mode==='walk'?'walking':'transit');}
function renderTabs(){
  $('#day-tabs').innerHTML=data.days.map(d=>`<button class="day-tab ${state.day===d.id?'active':''}" data-day="${d.id}" aria-pressed="${state.day===d.id}"><b>${d.date}</b>${d.weekday[0]}</button>`).join('')+`<button class="day-tab ${state.day==='all'?'active':''}" data-day="all" aria-pressed="${state.day==='all'}">전체</button>`;
}
function render(){
  document.body.dataset.view=state.view;
  syncPlaceBrowser();
  document.body.dataset.reviewMenu=showReviewMenu?'shown':'hidden';
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
  renderTabs();
  if(state.view==='today')renderToday();
  else if(state.view==='map')renderMapList();
  else if(state.view==='places')renderPlaces();
  else if(state.view==='review')renderReview();
  else if(state.view==='purchases')renderPurchases();
  else renderPrepare();
  updateMap(false);
}
function renderStop(s){
  if(s.alternatives)return `<section class="morning-alternatives"><article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card meal"><h3>${esc(s.title)}</h3><p>${esc(s.note)}</p><b>아래 A/B 중 한 곳만 선택</b></div></article>${s.alternatives.map(option=>renderStop(option)).join('')}</section>`;
  if(!s.place)return `<article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card ${s.type==='meal'?'meal':'transport'}"><h3>${esc(s.title)}</h3><p>${esc(s.note)}</p></div></article>`;
  const p=places.get(s.place);
  return `<article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card ${isDone(p.id)?'completed':''}"><div class="stop-meta"><span class="area-label">${esc(p.area)} · ${esc(kinds[p.kind])}</span>${badge(isMust(p)?'꼭 가고 싶음':p.status,isMust(p)?'must':tone(p))}</div><h3><button data-place="${esc(p.id)}" style="text-align:left;padding:0;font-weight:700">${esc(p.name)}</button></h3><p>${esc(s.note)}</p><div class="stop-actions">${check(p)}<div><button class="small-link" data-place="${esc(p.id)}">상세</button><span aria-hidden="true"> · </span>${link(p.directionsUrl,'길안내 ↗','small-link')}</div></div></div></article>`;
}
function daySection(d){return `<section class="day-section"><div class="day-summary"><div class="route-heading"><div class="date-square"><small>${esc(d.weekday[0])}</small>${esc(d.date.split('.')[1])}</div><div><span class="eyebrow">${d.id==='fri'?'DAY 01':d.id==='sat'?'DAY 02':'DAY 03'} / ${esc(d.date)}</span><h2>${esc(d.title)}</h2></div></div><p>${esc(d.subtitle)}</p><div class="day-note">${esc(d.note)}</div></div><div class="timeline">${d.steps.map(renderStop).join('')}</div></section>`;}
function renderToday(){
  $('#left-pane').innerHTML=(state.day==='all'?'<div class="overview-note"><h3>전체 흐름부터 살펴보세요.</h3><p>금요일은 이케부쿠로, 토요일은 라팡·하치고 뒤 긴자 → 도쿄역·니혼바시 → 아키하바라 쇼핑입니다. 일요일 아침은 두 카페 중 한 곳을 고른 뒤 공항으로 이동합니다.</p></div>':'')+selectedDays().map(daySection).join('<hr class="section-divider">')+
    `<div class="overview-note"><h3>APA 우에노 히로코지 숙박 확정</h3><p>토요일 첫 식사는 긴자 하치고를 선택했습니다. 대기 입장은 미확보이며 이후 쇼핑은 유동적입니다. 일요일 호텔 출발은 09:45–09:50 권장, 표준 체크아웃은 10시입니다. 원단·하라주쿠는 현재 동선에서 보류합니다.</p><button class="small-link" data-view="prepare">예약과 준비 확인하기 →</button></div>`;
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
  return `<article class="prepare-card dining-guide" id="dining-guide"><span class="eyebrow">SATURDAY / SUNDAY</span><h3>토·일 아침 계획</h3><p>토요일은 라팡 커피 뒤 긴자 하치고를 우선합니다. 일요일은 두 카페 중 한 곳만 선택하고 호텔에서 09:45–09:50 출발합니다. 현장 입장·대기 시간은 미확보입니다.</p>${guide.plans.map(plan=>`<section class="morning-plan"><h4>${esc(plan.title)}</h4><p>${esc(plan.summary)}</p><small>${esc(plan.note)}</small><div>${plan.places.filter(id=>places.has(id)).map(id=>`<button class="button-link" data-place="${id}">${esc(places.get(id).name)} →</button>`).join(' ')}</div></section>`).join('')}<details class="dining-research-list"><summary>내 꼭 갈 곳 영업·대기 조사 ${profiles.length}개 항목 · 10.27 확인</summary>${profiles.map(p=>`<section><h4><button class="small-link" data-place="${esc(p.id)}">${esc(p.name)} →</button></h4><p>${esc(p.diningResearch.hours)}</p>${researchHtml(p,true)}</section>`).join('')}</details><p>${esc(guide.limits)}</p></article>`;
}
function foodCard(p){
  const cat=TripExplore.category(p),label=p.hotelFood?.group==='hotel-bars'?'술집 후보':{picked:'내 선택·모음 영상',unreviewed:'엑셀 미검토',recommended:'추가 추천'}[cat];
  return `<article class="place-card food-map-card" data-food-card="${esc(p.id)}"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(p.videoIds.join(' · ')||'추천·보완')}</span>${badge(purposeCategory(p)==='bar'?'술집':label,cat==='unreviewed'?'soft':'')}${isMust(p)?badge('꼭 가고 싶음','must'):''}</div><h3><button data-place="${esc(p.id)}">${esc(p.name)}</button></h3><div class="explore-distance">${state.foodScope==='hotel30'?hotelTravelHtml(p):esc(nearbyLabel(p))}</div><p>${esc(p.hotelFood?.menu||p.summary)}</p><div class="quick-hours">${p.diningResearch?esc(p.diningResearch.hours):p.hotelFood?esc(state.day==='all'?hoursLabel(p)+' · 상세에서 요일별 확인':p.hotelFood.hours[state.day]):'영업 미확인 · 영상 메뉴·가격은 참고용'}</div>${researchHtml(p)}${!p.diningResearch&&p.hotelFood?.caution?`<p class="dining-caution">${esc(p.hotelFood.caution)}</p>`:''}<div class="food-card-actions">${interestButton(p)}<button data-locate="${esc(p.id)}" class="small-link" ${p.coords?'':'disabled'}>${p.coords?'지도에서 보기':'위치 미확인'}</button><button data-place="${esc(p.id)}" class="small-link">${p.videoIds.length?'메뉴·시간·Shorts':'메뉴·시간'} →</button></div></article>`;
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
function browsePlaceCard(p){
  if(p.kind==='food')return foodCard(p);
  return `<article class="place-card"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(TripMap.categories[purposeCategory(p)].label)}</span>${badge(p.status,tone(p))}</div><h3><button data-place="${esc(p.id)}">${esc(p.name)}</button></h3><p>${esc(p.summary)}</p>${p.coords?'':'<p class="browser-hint">위치 미확인 · 목록에만 표시</p>'}<div class="food-card-actions">${interestButton(p)}<button class="small-link" data-locate="${esc(p.id)}" ${p.coords?'':'disabled'}>${p.coords?'지도에서 보기':'위치 미확인'}</button><button class="small-link" data-place="${esc(p.id)}">상세·메모 →</button></div></article>`;
}
function renderExplorerResults(){
  if(!$('#food-results'))return;
  const list=browseCandidates(),mapped=list.filter(p=>p.coords),missing=list.filter(p=>!p.coords);
  const groups=Object.entries(TripMap.categories).map(([id,c])=>({id,...c,items:mapped.filter(p=>purposeCategory(p)===id)})).filter(g=>g.items.length);
  const areas=TripMap.areas(mapped,records);
  const areaSummary=areas.length?`<details class="food-area-summary"><summary>권역별 맛집 개수</summary><div>${areas.map(a=>`<button data-food-area="${esc(a.name)}">${esc(a.name)} <b>${a.places.length}</b></button>`).join('')}</div><small>등록 지역명 기준 · 누르면 지도 보기로 이동해 해당 권역을 확대합니다.</small></details>`:'';
  $('#food-results').innerHTML=`<div class="result-count" role="status">${list.length}곳 · 지도에 표시 가능한 ${mapped.length}곳${missing.length?' · 위치 미확인 '+missing.length+'곳':''}<br>지도와 목록에 같은 검색·종류 필터 적용${state.mapFocusId?' · 지도는 선택한 장소만 표시 중':''}</div>${areaSummary}${groups.map(g=>`<section class="collection-group" aria-label="${esc(g.label)}"><h3 class="collection-heading"><span class="purpose-legend" style="background:${g.color}">${g.icon}</span>${esc(g.label)} <small>${g.items.length}곳</small></h3><div class="places-grid">${g.items.map(browsePlaceCard).join('')}</div></section>`).join('')}${missing.length?`<details class="unmapped-food" ${state.foodQuery.trim()?'open':''}><summary>위치 미확인 ${missing.length}곳 · 목록 전용</summary><p class="browser-hint">주소를 특정하지 못해 지도에는 핀을 찍지 않았습니다. 상세 정보와 메모는 확인할 수 있습니다.</p><div class="places-grid">${missing.map(browsePlaceCard).join('')}</div></details>`:''}${!list.length?'<div class="empty-state">이 조건에 맞는 장소가 없습니다. 검색어와 종류를 확인하거나 <button class="small-link" data-action="browse-reset-all">전체 장소·전체 종류에서 찾기</button>를 눌러 주세요.</div>':''}`;
  syncPlaceBrowser();
}
function renderMapList(){
  if(state.akibaRoute){$('#left-pane').innerHTML=akibaGuideHtml();return;}
  const compilations=compilationHtml();
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">PLACES TO EXPLORE</span><h2>장소 목록</h2></div></div><p class="section-intro">장소 이름이나 ‘지도에서 보기’를 누르면 해당 장소·숙소·확인한 내 위치만 볼 수 있습니다. 동선 밖 후보는 위의 ‘분류·목록 필터 → 전체 장소’에서 찾으세요.</p><div id="food-results"></div>${compilations?`<details class="browser-compilations"><summary>모음 영상 보관함</summary>${compilations}</details>`:''}`;
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
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">YOUR COLLECTION</span><h2>장소 보관함</h2></div>${badge('지도와 같은 분류')}</div><p class="section-intro">방문 장소와 고른 맛집·카페를 모았습니다. 토요일 첫 식사는 하치고, 일요일 아침은 두 카페 중 한 곳 선택입니다.</p><label class="search-box"><span aria-hidden="true">⌕</span><input id="place-search" type="search" placeholder="가게 이름, 지역, 엑셀 번호로 검색" aria-label="장소 검색" value="${esc(state.query)}"></label><div class="chip-row" role="group" aria-label="장소 종류"><button data-kind="all" class="${state.kind==='all'?'active':''}">전체</button>${Object.entries(TripMap.categories).map(([k,c])=>`<button data-kind="${k}" class="${state.kind===k?'active':''}">${c.icon} ${c.label}</button>`).join('')}</div><label class="check-control" style="margin-bottom:16px"><input type="checkbox" id="unreviewed-toggle" ${state.includeUnreviewed?'checked':''}>보류·제외·미검토 맛집도 포함하기</label><div id="place-results"></div><div style="margin-top:20px">${compilationHtml()}</div><p class="data-note">원본 ${data.videoCount}개 도쿄 후보 영상에서 가게별로 묶었습니다. 모음 영상은 별도로 보관합니다. 엑셀 상태는 사이트를 생성한 시점의 사본입니다.</p>`;
  renderPlaceResults();
}
function transportGuideHtml(){
  const search=q=>link('https://www.google.com/search?q='+encodeURIComponent(q),q+' 검색 ↗','transport-search');
  return `<section class="transport-guide" aria-labelledby="transport-heading">
    <div class="transport-heading"><span class="eyebrow">GETTING AROUND</span><h3 id="transport-heading">교통 · 이것만 보고 출발</h3><p>시내는 Suica, 공항 왕복은 스카이라이너 별도 표. 2026.10.27 공식 안내 확인.</p></div>
    <article class="prepare-card transport-card">${badge('도시락유심 · 예약 완료')}<h3>출국 전 유심 수령</h3><p>10.30 금요일 · <b>인천공항 제2여객터미널 1층 3번 출구 옆</b></p><p>와이파이도시락 로밍센터에서 수령한 뒤 3층 출발층으로 이동하세요. 출국심사 전에 수령합니다.</p></article>
    <article class="prepare-card transport-card">${badge('시내 이동 · 실물 카드 기준')}<h3>① Welcome Suica · 웰컴 스이카</h3>
      <ol><li><b>구매:</b> 나리타 제1터미널 지하 1층의 <b>JR 쪽</b> Welcome Suica 전용 발매기 또는 JR EAST 여행 서비스 센터. 스카이라이너를 사는 게이세이 창구와 별도입니다.</li><li><b>금액:</b> 우선 <b>2,000엔</b> 충전을 제안합니다. 부족할 때 추가하고, 충전용 엔화 현금을 준비하세요.</li><li><b>사용:</b> 전철·지하철은 들어갈 때와 나올 때 같은 카드를 터치. 버스는 차량의 IC 안내에 따라 터치합니다. Google 지도에서 목적지·대중교통을 검색하세요.</li></ol>
      <p class="transport-caution">충전은 역 충전기·편의점·세븐은행 ATM에서 <b>엔화 현금</b>으로. 보증금 없이 28일 사용하며 <b>남은 잔액은 환불되지 않습니다.</b> 귀국 전 편의점 등에서 사용하세요. 구입 시 참조서도 보관합니다.</p>
      <div class="transport-searches">${search('나리타 1터미널 웰컴스이카 구매 위치')}${search('스이카 세븐은행 ATM 충전 방법')}</div>
      <div class="transport-sources">${link('https://www.jreast.co.jp/ko/multi/welcomesuica/purchase.html','JR 공식 한국어 · 구매·충전 ↗')}</div>
    </article>
    <article class="prepare-card transport-card">${badge('금요일 · 현장 구매 계획')}<h3>② 나리타공항 → 게이세이우에노</h3>
      <ol><li><b>입국 후:</b> 수하물을 찾고 <b>제1터미널 지하 1층 게이세이 Skyliner 티켓 카운터</b>로 갑니다.</li><li><b>요청:</b> “게이세이우에노까지, 성인 1명, 가장 빨리 탈 수 있는 스카이라이너”라고 말하세요. 창구에서 열차·지정석을 정합니다.</li><li><b>탑승:</b> 표의 출발 시각·승강장·호차·좌석을 확인합니다. 우에노 도착 후 호텔까지는 Google 지도 도보 길찾기.</li></ol>
      <p class="transport-caution"><b>현장 편도 2,580엔</b>(승차권+특급권). 신용카드 이용 가능, 결제 실패에 대비해 현금도 준비. <b>Suica 터치만으로는 스카이라이너를 탈 수 없습니다.</b> 위 금액으로 종이 승차권까지 샀다면 개찰구에서도 그 표를 사용합니다.</p>
      <details class="transport-extra"><summary>온라인 구매를 다시 시도한다면</summary><p>공식 할인 왕복권 4,500엔 / 현장 편도 2회 총 5,160엔으로 차이는 660엔입니다. 현재는 현장 구매 계획이며 표는 미구매 상태입니다.</p>${link('https://www.keisei.co.jp/keisei/tetudou/skyliner/e-ticket/ko/','공식 온라인 구매 ↗')}</details>
      <div class="transport-searches">${search('나리타 1터미널 스카이라이너 현장 구매')}${search('게이세이우에노역 APA 우에노 히로코지 도보')}</div>
      <div class="transport-sources">${link('https://www.keisei.co.jp/keisei/tetudou/skyliner/kr/skyliner/purchase.php','게이세이 공식 · 판매 장소·요금 ↗')}${link('https://www.keisei.co.jp/keisei/tetudou/skyliner/kr/tickets/coupon.php','온라인 할인 요금 ↗')}</div>
    </article>
    <article class="prepare-card transport-card">${badge('일요일 · 14:00 비행기')}<h3>③ 호텔 → 나리타공항 제1터미널</h3>
      <p class="transport-plan"><b>호텔 09:45–09:50 출발 → 게이세이우에노역 → 스카이라이너 10:20 → 나리타 제1터미널역 11:03 도착</b></p>
      <ol><li><b>돌아오는 표:</b> 게이세이우에노역에서 별도 구매. 원하는 10:20편은 금요일 역에 도착했을 때 미리 구매하는 것을 권합니다.</li><li><b>역 구분:</b> <b>JR 우에노역이 아닌 게이세이우에노역</b>입니다. 짐 수령·도보·발권에 여유를 두세요.</li><li><b>공항 도착 후:</b> 제1터미널 출발층에서 대한항공 체크인 카운터·전광판을 확인합니다.</li></ol>
      <p class="transport-caution">10:20–11:03은 현재 일정에 넣은 <b>계획 시각이며 좌석은 미예약</b>입니다. 전날 공식 토·휴일 시간표와 당일 운행 정보를 다시 확인하세요.</p>
      <div class="transport-searches">${search('게이세이우에노 스카이라이너 나리타 1터미널 시간표 토요일 휴일')}${search('스카이라이너 운행 정보')}</div>
      <div class="transport-sources">${link('https://www.keisei.co.jp/keisei/tetudou/skyliner/kr/traffic/skyliner.php?id=time','게이세이 공식 · 시각표(토·휴일 선택) ↗')}</div>
    </article>
  </section>`;
}
function renderPrepare(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">BEFORE YOU GO</span><h2>예약과 준비</h2></div></div><article class="prepare-card"><h3>화면 설정</h3><label class="review-menu-setting"><input id="show-review-menu" type="checkbox" ${showReviewMenu?'checked':''}>엑셀 목록 검토 메뉴 표시</label><p>여행 중에는 메뉴를 숨겨두고, 다음 여행을 준비할 때 다시 켜실 수 있습니다. 맛집 선택·메모·지도와 백업 기능은 그대로 유지됩니다. 이 설정은 현재 브라우저에 저장됩니다.</p></article>${transportGuideHtml()}${diningGuideHtml()}
    <article class="prepare-card featured">${badge('토요일 첫 식사 · 현장 입장 미확보','warn')}<h3>긴자 하치고</h3><p>10.31 토요일 · 라팡 커피 후 09시대 도착 목표</p><div class="reserve-date">11:00 <small>현장 줄 순서 안내</small></div><p>오전을 하치고 대기에 우선 배정합니다. 공식 안내상 12–16시는 예약 손님을 받습니다. 09시대 도착은 계획값이며 입장 보장이 아닙니다.</p>${link('https://www.tablecheck.com/ja/shops/ginza-hachigou/reserve','공식 입장·예약 안내 ↗','button-link')}<p>토요일 09시에 다음 주 화–일 예약을 공개합니다. 10/31분 최초 공개는 지났으며 취소분은 별도 확인합니다. 예약·결제는 진행하지 않았습니다.</p></article>
    <article class="prepare-card">${badge('숙소 예약 완료')}<h3>APA 우에노 히로코지 기준 동선</h3><p>10.30 체크인 → 11.01 체크아웃 · 성인 1명 / 1실 / 2박. 사용자가 APA 우에노 히로코지 예약 완료를 확인했습니다. 결제 금액과 취소 조건은 예약 확인서 기준입니다.</p><div class="hotel-links">${link('https://www.apahotel.com/hotel/syutoken/tokyo/ueno-hirokoji/','APA 호텔 우에노 히로코지 ↗')}${link('https://www.booking.com/hotel/jp/apa-hotel-ueno-hirokoji.ko.html?checkin=2026-10-30&checkout=2026-11-01&group_adults=1&no_rooms=1&group_children=0&selected_currency=KRW','예약 사이트 ↗')}</div></article>
    <article class="prepare-card">${badge('약 $100 · 약간 초과 가능')}<h3>달콤한 한 병, 혹은 스모키한 한 병</h3><p>리커즈 하세가와에서 비교할 후보입니다. 아래는 10.20 웹 표시 가격(세금 포함, 700ml)이며 방문일 재고·가격은 별도입니다.</p>${data.whisky.candidates.map(w=>`<div class="whisky-row"><div><b>${link(w.url,w.name+' ↗')}</b><small>${esc(w.style)}</small></div><span>¥${w.price.toLocaleString('ja-JP')}</span></div>`).join('')}<p>두 스타일을 함께 고르면 글렌알라키 12년 + 탈리스커 10년 = 14,880엔도 비교 후보입니다. 최종 구매는 현장에서 결정합니다.</p></article>
    <article class="prepare-card"><h3>쇼핑에서 남은 확인</h3><ul><li>신발: RFW·SPINGLE 긴자에서 피팅할 상품 확인. PRAS 하라주쿠는 이번 동선에서 보류</li><li>포켓몬: 30주년·그 밖의 한정 굿즈 우선, 재고는 미확인</li><li>토요일: 라팡 커피 → 긴자 하치고 우선. 일요일 아침은 크리에·우사기야 중 한 곳 선택</li><li>원단 매장은 현재 동선에서 보류. 기존 후보는 장소 보관함에 유지</li><li>항공권 확인: 대한항공 KE703 입국 / KE704 11.01 14:00 나리타 제1터미널 출국</li></ul></article>
    <article class="prepare-card"><h3>내 기록 보관하기</h3><p>방문 체크·관심·메모는 이 브라우저에 저장됩니다. 다른 기기로 옮기거나 보관하려면 내보내기 파일을 사용하세요. 가져오기는 파일에 있는 같은 장소의 기록을 덮어씁니다.</p><button class="button-link" data-action="export">체크·메모 내보내기</button> <button class="button-link" data-action="import">가져오기</button></article>`;
}

function browseCandidates(){
  let candidates;
  if(state.browseCollection==='all'||state.browseCollection==='saved')candidates=data.places;
  else{
    const hotelBars=data.places.filter(p=>p.hotelFood?.group==='hotel-bars'&&TripExplore.reviewMatch(p,state.reviewFilter,records[p.id]));
    candidates=[...mappedRoutePlaces().filter(p=>p.kind!=='food'||TripExplore.reviewMatch(p,state.reviewFilter,records[p.id])),...data.places.filter(p=>p.mapPinned),...foodCandidates(),...hotelBars,...nearbyRecommendations(),...(state.showFabric?data.places.filter(p=>p.kind==='fabric'):[])];
  }
  return TripMap.browsePlaces(candidates,{categories:state.mapCategories,query:state.foodQuery,interestedOnly:state.browseCollection==='saved'},records);
}
function mapPlaces(){
  if(state.mapFocusId)return TripMap.focusTargets(places,state.mapFocusId,data.routePlan.hotelId,state.userPosition).places;
  if(state.akibaRoute)return [...akibaStops(),...data.akihabara.contextIds.map(id=>places.get(id)).filter(p=>p?.coords)].filter(p=>state.mapCategories.includes(purposeCategory(p)));
  return browseCandidates().filter(p=>p.coords);
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
  const display=state.mapFocusId?'pins':state.foodDisplay;
  if(foodLayer&&foodLayerMode===display)return;
  if(foodLayer)map.removeLayer(foodLayer);
  foodLayer=(display==='clusters'&&L.markerClusterGroup?L.markerClusterGroup({maxClusterRadius:55,showCoverageOnHover:false,spiderfyOnMaxZoom:true,animate:false,iconCreateFunction:cluster=>L.divIcon({className:'food-cluster purpose-cluster',html:`<span>食 ${cluster.getChildCount()}</span>`,iconSize:[48,38]})}):L.layerGroup()).addTo(map);
  foodLayerMode=display;
}
function updateMap(fit=true,afterUpdate=null){
  if(!map)return;
  const revision=++mapUpdateRevision;
  ensureFoodLayer();
  mapLayer.clearLayers();foodLayer.clearLayers();focusLayer.clearLayers();markers.clear();syncExploreControls();
  $('#show-food').checked=state.showFood;$('#show-fabric').checked=state.showFabric;
  $('#food-scope').value=state.foodScope;$('#food-meal').value=state.foodMeal;
  const visible=mapPlaces(),list=foodCandidates();
  $('#map-legend').innerHTML=Object.entries(TripMap.categories).filter(([id])=>state.mapCategories.includes(id)).map(([id,c])=>`<span><i class="purpose-legend" style="background:${c.color}">${c.icon}</i>${c.label}</span>`).join('')+(state.showRoute?selectedDays().filter(d=>d.steps.filter(s=>s.place).length>1).map(d=>`<span><i class="route-legend-line" style="--route-color:${dayColors[d.id]}"></i>${esc(d.date)} ${esc(d.weekday[0])} 참고 순서</span>`).join(''):'');
  if(state.akibaRoute)$('#map-legend').innerHTML+='<span><i class="route-legend-line" style="--route-color:#d43c59"></i>1–5 · 선택 방문 순서</span>';
  $('#map-scope-note').textContent=state.foodDisplay==='clusters'?'食 뒤 숫자는 화면에서 가까운 맛집을 묶은 개수입니다. 원을 누르면 확대됩니다. 도보 반경이나 인구 밀도가 아닙니다.':'개별 핀: 확대 전에도 선택한 맛집의 위치를 모두 표시합니다. 같은 위치의 핀은 겹칠 수 있어 묶음 보기로도 비교할 수 있습니다.';
  if(state.akibaRoute)$('#map-scope-note').textContent='번호는 해당 보기의 추천 순서입니다. 라디오회관은 핀을 눌러 3·4·6·8층 중 선택하세요. 호텔·2k540은 축소하면 보이는 위치 참고용 핀입니다. 통상 영업시간이며 자동 영업 판정은 하지 않습니다.';
  const foodCount=visible.filter(p=>purposeCategory(p)==='food').length,barCount=visible.filter(p=>purposeCategory(p)==='bar').length;
  $('#food-map-count').textContent=`맛집 ${foodCount}곳 · 술집 ${barCount}곳 · 다른 방문 장소 ${visible.length-foodCount-barCount}곳`;
  if(state.akibaRoute)$('#food-map-count').textContent=`굿즈·카드 건물 ${visible.filter(p=>p.akibaOrder).length}곳 · 호텔·2k540 위치 참고`;
  if(!state.mapFocusId&&state.akibaRoute)for(const segment of TripMap.excursionSegments(data.akihabara,places,state.akibaRoute)){
    if(!visible.some(p=>p.id===segment.from)||!visible.some(p=>p.id===segment.to))continue;
    L.polyline(segment.coords,{color:'#d43c59',weight:3,opacity:.7,dashArray:'6 8',interactive:false}).addTo(mapLayer);
  }
  if(!state.mapFocusId&&state.showRoute)for(const d of selectedDays())for(const segment of TripMap.routeSegments(d,places)){
    if(!visible.some(p=>p.id===segment.from)||!visible.some(p=>p.id===segment.to))continue;
    L.polyline(segment.coords,{color:dayColors[d.id],weight:2,opacity:segment.alternative?.35:.5,dashArray:segment.alternative?'3 8':'5 8',interactive:false}).addTo(mapLayer);
  }
  if(!state.mapFocusId&&state.foodScope==='nearby'){
    L.circle(state.center,{radius:state.radiusKm*1000,color:'#537b9c',weight:1,dashArray:'4 6',fillOpacity:.035,interactive:false}).addTo(focusLayer);
    L.circleMarker(state.center,{radius:5,color:'#537b9c',fillColor:'#fff',fillOpacity:1,weight:2,interactive:false}).addTo(focusLayer);
    if(state.anchorId==='user'&&state.userPosition)L.circle(state.center,{radius:Math.min(state.userPosition.accuracy,5000),color:'#537b9c',weight:0,fillOpacity:.08,interactive:false}).addTo(focusLayer);
  }
  for(const p of visible){
    const route=!!p.visits,purpose=purposeCategory(p),design=TripMap.categories[purpose],must=isMust(p);
    const icon=L.divIcon({className:'',html:`<span class="map-pin purpose-pin purpose-${purpose}${must?' priority-must':''}" style="--pin-color:${design.color}">${p.akibaOrder||design.icon}${must?'<small class="pin-priority">꼭</small>':''}${route&&state.showRoute&&p.kind!=='hotel'?`<small class="pin-order">${esc(p.routeOrder)}</small>`:''}</span>`,iconSize:[32,32],iconAnchor:[16,16]});
    const quick=p.kind==='food'?`<span class="popup-note">${esc(nearbyLabel(p))}<br>${esc(p.hotelFood?.menu||p.summary)}<br>${esc(p.diningResearch?p.diningResearch.hours:p.hotelFood?(state.day==='all'?hoursLabel(p)+' · 상세에서 확인':p.hotelFood.hours[state.day]):'영업 미확인 · 지도에서 재확인')}</span>${link(contextDirections(p),state.foodScope==='nearby'?'기준점에서 길찾기 ↗':'Google 길찾기 ↗','popup-link')}`:`${p.buildingName?arrivalHtml(p):`<span class="popup-note">${esc(p.exploreTip||p.summary)}</span>`}<button class="popup-link" data-nearby="${esc(p.id)}">이 장소 주변 맛집 →</button>`;
    const marker=L.marker(p.coords,{icon,title:p.name,keyboard:true,zIndexOffset:p.kind==='hotel'?500:route?300:0}).addTo(purpose==='food'?foodLayer:mapLayer).bindPopup(`<b>${p.akibaOrder?p.akibaOrder+'. ':''}${esc(p.name)}</b>${must?' · 꼭 가고 싶음':''}<br>${esc(design.label)} · ${esc(p.area)} · ${esc(p.status)}${p.akiba?`<span class="popup-note"><b>${esc(p.akiba.close)}</b> · ${esc(p.akiba.stay)}</span>${link(contextWalking(p),'Google 도보 길찾기 ↗','popup-link')}`:''}${quick}<button class="popup-link" data-place="${esc(p.id)}">${p.kind==='food'?'메뉴·시간·메모':p.buildingName?'상세·층수·메모':'상세·메모'} →</button> &nbsp;${interestButton(p)}`,p.buildingName?{minWidth:250,maxWidth:290,autoPanPaddingTopLeft:[12,52],autoPanPaddingBottomRight:[12,12]}:{});
    markers.set(p.id,marker);
    marker.on('click',()=>{if(state.mapFocusId!==p.id&&!(state.mapFocusId&&p.id===data.routePlan.hotelId))focusMapPlace(p.id,{scroll:false});});
  }
  const userCoords=TripMap.focusTargets(places,null,null,state.userPosition).userCoords;
  if(userCoords){
    const icon=L.divIcon({className:'',html:'<span class="map-user-position">◎</span>',iconSize:[30,30],iconAnchor:[15,15]});
    L.marker(userCoords,{icon,title:'확인한 내 위치',zIndexOffset:1000}).addTo(focusLayer).bindPopup(`<b>확인한 내 위치</b><br>오차 약 ${Math.round(state.userPosition.accuracy)||0}m<br>위치 갱신은 ‘내 위치’ 버튼을 눌러 주세요.`);
  }
  const hotelBars=state.foodScope==='hotel30'&&state.foodMeal==='afterDinner';
  $('#map-title').textContent=state.foodMeal==='afterDinner'?'술집 후보 · 호텔 주변부터 긴자까지':state.foodScope==='city'?'도쿄 전체 · '+(state.reviewFilter==='must'?'꼭 가고 싶은 맛집':state.reviewFilter==='regular'?'가고 싶은 맛집 · 일반 후보':state.reviewFilter==='가고 싶음'?'가고 싶은 맛집':'선택한 후보'):state.foodScope==='route'?'방문권역 주변에서 탐색':state.foodScope==='nearby'?state.centerLabel+' 주변':'후보를 넓게 비교하기';
  if(state.akibaRoute)$('#map-title').textContent='아키하바라 · 굿즈 탐색';
  else if(state.browseCollection!=='current')$('#map-title').textContent=state.browseCollection==='all'?'전체 장소 · 동선 밖 후보 포함':'★ 관심 저장한 장소';
  if(state.mapFocusId){
    $('#map-title').textContent='선택한 장소 · 숙소'+(userCoords?' · 내 위치':'');
    $('#food-map-count').textContent=`장소 ${visible.length}곳${userCoords?' + 내 위치':''} 표시 · 다른 후보는 목록에서 선택할 수 있습니다.`;
    $('#map-legend').innerHTML=[...new Set(visible.map(purposeCategory))].map(id=>{const c=TripMap.categories[id];return `<span><i class="purpose-legend" style="background:${c.color}">${c.icon}</i>${c.label}</span>`;}).join('')+(userCoords?'<span><i class="purpose-legend map-user-legend">◎</i>내 위치</span>':'');
    $('#map-scope-note').textContent='선택 해제로 기존 필터와 확대 상태로 돌아갑니다. 현재 위치는 마지막으로 확인한 좌표이며 자동 추적하지 않습니다.';
  }
  requestAnimationFrame(()=>{if(revision!==mapUpdateRevision)return;const container=map.getContainer();if(!container.clientWidth||!container.clientHeight)return;map.invalidateSize();const fitPlaces=state.mapFocusId?visible:state.akibaRoute?akibaStops():state.browseCollection!=='current'||state.foodQuery.trim()?visible:hotelBars?[places.get(data.routePlan.hotelId),...list.filter(p=>p.coords)]:state.showRoute?mappedRoutePlaces():visible;const points=fitPlaces.map(p=>p.coords);if(state.mapFocusId&&userCoords)points.push(userCoords);if(fit&&points.length)map.fitBounds(L.latLngBounds(points),{padding:[30,30],maxZoom:state.mapFocusId?16:state.akibaRoute?17:hotelBars?16:14,animate:false});afterUpdate?.();});
}
function focusMapPlace(id,{fit=true,scroll=true,popup=true}={}){
  const p=places.get(id);if(!p?.coords)return;
  if(!state.mapFocusId&&map){const c=map.getCenter();state.mapFocusViewport={center:[c.lat,c.lng],zoom:map.getZoom()};}
  state.mapFocusId=id;
  state.browseMode='map';syncPlaceBrowser();
  if(state.view!=='map'){state.view='map';render();}
  updateMap(fit,popup?()=>markers.get(id)?.openPopup():null);
  if(scroll)$('#map-pane').scrollIntoView({block:'start'});
}
function clearMapPlace(restore=true){
  const viewport=state.mapFocusViewport;
  state.mapFocusId=null;state.mapFocusViewport=null;
  if(!restore)return;
  updateMap(false);
  if(viewport&&map)map.setView(viewport.center,viewport.zoom,{animate:false});
}
function locatePlace(id){
  const p=places.get(id);if(!p?.coords)return;
  focusMapPlace(id);
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
  if(state.view==='map'&&p.coords&&state.mapFocusId!==id)focusMapPlace(id,{scroll:state.browseMode==='list',popup:false});
  dialogPlace=id;
  $('#dialog-content').innerHTML=`<span class="area-label">${esc(p.area)} / ${esc(kinds[p.kind])}</span><h2>${esc(p.name)}</h2>${badge(p.status,tone(p))}<p>${esc(p.summary)}</p><div class="detail-address">${esc(p.address||'주소 확인 필요')}</div><div class="detail-actions">${link(p.directionsUrl,'길안내 ↗','primary')}${link(p.mapUrl,'Google 지도 ↗')}${p.url?link(p.url,p.id==='food-G034'?'예약 페이지 ↗':'사이트 ↗'):''}${p.browse?link(p.browse,'상품 둘러보기 ↗'):''}${p.store?link(p.store,'매장 안내 ↗'):''}</div>${p.detail&&!p.hotelFood&&!p.diningResearch?`<p>${esc(p.detail)}</p>`:''}${p.hours&&!p.hotelFood&&!p.diningResearch?`<div class="detail-info">영상에 안내된 영업시간: ${esc(p.hours)}<br>방문일 영업시간은 다시 확인해 주세요.</div>`:''}${p.diningResearch?researchHtml(p,true):p.hotelFood?diningHtml(p,true):''}${p.exploreTip?`<div class="detail-info">${esc(p.exploreTip)}<br>${link(p.exploreTipUrl,'같은 층 공식 매장 안내 ↗')}</div>`:''}<div class="detail-info">${esc(p.coordinateNote)}</div>${p.kind==='food'?foodPreferences(p):''}${check(p)} ${interestButton(p)}${p.kind!=='food'?`<button class="button-link" data-nearby="${esc(p.id)}">이 장소 주변 맛집</button>`:''}<label class="note-label" for="place-note">나의 메모</label><textarea id="place-note" maxlength="4000" placeholder="사고 싶은 상품, 고를 메뉴, 현장에서 확인할 것…">${esc(records[id]?.note||'')}</textarea><div class="note-hint">자동 저장 · 현재 브라우저에만 보관</div>${p.videos?.length?`<details class="source-videos"><summary>관련 Shorts ${p.videos.length}개 · 원본 확인</summary>${p.videos.map(v=>link(v.url,v.id+' · '+v.title+(v.selection==='가고 싶음'?' ✓':''))).join('')}</details>`:''}`;
  if(p.buildingName)$('#dialog-content .detail-address').insertAdjacentHTML('afterend',arrivalHtml(p,true));
  if(p.indoorShops)$('#dialog-content .arrival-info').insertAdjacentHTML('afterend',indoorShopsHtml(p));
  if(p.kind==='food')$('#dialog-content').insertAdjacentHTML('beforeend',`${link(contextDirections(p),state.foodScope==='nearby'?'탐색 기준점에서 길찾기 ↗':'Google 길찾기 ↗','button-link')}<div class="food-distance">${distanceHtml(p)}${link(hotelDirections(p),'호텔에서 길찾기 ↗')}</div>${p.locationWarning?`<div class="detail-info">${esc(p.locationWarning)}${p.originalAddress?'<br>영상 속 주소: '+esc(p.originalAddress):''}${p.addressSource?'<br>'+link(p.addressSource,'현재 주소 출처 ↗'):''}</div>`:''}${p.coordinateSource?link(p.coordinateSource,'위치 검색 근거 ↗','small-link'):''}`);
  if(!$('#place-dialog').open)$('#place-dialog').showModal();
  if(syncHistory){
    const entry={...history.state,[DIALOG_HISTORY_KEY]:id};
    if(history.state?.[DIALOG_HISTORY_KEY])history.replaceState(entry,'');
    else history.pushState(entry,'');
  }
}
function loadPurchases(){
  try{const saved=localStorage.getItem(PURCHASE_KEY);purchaseLog=saved?TripPurchase.normalize(JSON.parse(saved)):TripPurchase.empty();}
  catch{purchaseLoadError=true;message('구매 기록을 읽지 못했습니다. 기존 저장 내용을 보호하기 위해 구매 기록 저장을 중지했습니다.');}
}
function persistPurchases(next){
  if(purchaseLoadError)throw new Error('기존 구매 기록을 읽지 못해 저장을 중지했습니다.');
  const clean=TripPurchase.normalize(next);
  try{localStorage.setItem(PURCHASE_KEY,JSON.stringify(clean));}catch{throw new Error('저장 공간에 기록하지 못했습니다. 입력 내용을 복사해 보관한 뒤 다시 시도해 주세요.');}
  purchaseLog=clean;
}
function newPurchaseDraft(){return {id:'',amount:'',store:'',memo:'',currency:'JPY',category:'general',purchasedAt:TripPurchase.localTime()};}
function purchaseMoney(sums){return [sums.JPY||!sums.USD?sums.JPY.toLocaleString('ko-KR')+'엔':'',sums.USD?'US$'+sums.USD.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}):''].filter(Boolean).join(' + ');}
function renderPurchases(){
  const draft=purchaseDraft||(purchaseDraft=newPurchaseDraft()),sums=TripPurchase.totals(purchaseLog);
  const rows=[...purchaseLog.entries].sort((a,b)=>b.purchasedAt.localeCompare(a.purchasedAt));
  $('#left-pane').innerHTML=`<section class="purchase-page"><div class="section-heading"><span class="eyebrow">SHOPPING LOG</span><h2>구매 기록</h2><p>영수증 한 장씩 금액과 구매처를 남기세요. 날짜·시간은 자동 입력되며 수정할 수 있습니다.</p></div>
    ${purchaseLoadError?'<p role="alert">기존 구매 기록을 읽지 못했습니다. 저장을 중지한 상태입니다.</p>':''}
    <div class="purchase-totals">${[['all','전체 지출'],['general','일반물품'],['alcohol','주류'],['other','기타 지출']].map(([key,label])=>`<article><span>${label}</span><strong>${purchaseMoney(sums[key])}</strong>${sums[key].usdReference!==null?`<small>달러 환산 약 US$${sums[key].usdReference.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})}</small>`:''}</article>`).join('')}</div>
    <form id="purchase-form" class="purchase-form"><h3>${draft.id?'구매 기록 수정':'구매 기록 추가'}</h3><div class="purchase-fields">
      <label>금액 <span>필수</span><input name="amount" type="text" inputmode="decimal" autocomplete="off" required maxlength="15" placeholder="예: 12,500" value="${esc(draft.amount)}"></label>
      <label>통화<select name="currency"><option value="JPY" ${draft.currency==='JPY'?'selected':''}>JPY · 엔</option><option value="USD" ${draft.currency==='USD'?'selected':''}>USD · 달러</option></select></label>
      <label class="purchase-wide">구매처 <span>필수</span><input name="store" required maxlength="120" placeholder="예: 포켓몬센터 메가도쿄" value="${esc(draft.store)}"></label>
      <label>날짜·시간 <small>일본 현지 시각</small><input name="purchasedAt" type="datetime-local" required min="2000-01-01T00:00" value="${esc(draft.purchasedAt)}"></label>
      <label>분류<select name="category">${Object.entries(TripPurchase.categories).map(([key,label])=>`<option value="${key}" ${draft.category===key?'selected':''}>${label}${key==='other'?' · 식사·교통 등':''}</option>`).join('')}</select></label>
      <label class="purchase-wide">구매 물품 메모 <span>선택</span><textarea name="memo" maxlength="500" rows="2" placeholder="예: 30주년 피카츄 인형 2개, 친구 선물">${esc(draft.memo)}</textarea></label>
    </div><p class="purchase-hint">일반물품과 주류가 섞인 영수증은 분류별로 나누어 입력해 주세요. 금액은 실제 결제한 금액으로 기록합니다.</p>
    <div class="purchase-actions"><button class="button-link primary" type="submit" ${purchaseLoadError?'disabled':''}>${draft.id?'수정 저장':'기록 추가'}</button>${draft.id?'<button class="button-link" type="button" data-purchase-action="cancel">수정 취소</button>':''}<span id="purchase-status" role="status" aria-live="polite"></span></div></form>
    <details class="purchase-rate"><summary>달러 환산 참고값 설정</summary><form id="purchase-rate-form"><label>1달러 = <input name="jpyPerUsd" type="number" inputmode="decimal" min="0.000001" max="1000000" step="any" placeholder="예: 150" value="${purchaseLog.jpyPerUsd??''}"> 엔</label><button type="submit" class="button-link">환율 저장</button></form><p>직접 입력한 환율로 단순 환산합니다. 비워서 저장하면 환산을 끕니다. 귀국일에 적용되는 관세 환율과 다를 수 있으며, 세금·면세 한도 판정은 계산하지 않습니다.</p></details>
    <div class="purchase-list-heading"><h3>저장한 기록 <span>${rows.length}건</span></h3><div><button class="button-link" data-action="export">기록 백업 ↗</button><button class="button-link" data-action="import">백업 가져오기</button></div></div>
    <p class="purchase-hint">현재 기기·브라우저에 저장됩니다. 백업 파일에는 기존 맛집 검토·메모와 구매 기록이 함께 들어갑니다. 다른 기기에서는 가져오기가 필요합니다.</p>
    ${purchaseUndo?'<p class="purchase-undo" role="status">기록을 삭제했습니다. <button class="small-link" data-purchase-action="undo">삭제 되돌리기</button></p>':''}
    <div class="purchase-list">${rows.length?rows.map(e=>`<article class="purchase-entry"><div><small><time>${esc(e.purchasedAt.replace('T',' '))}</time> · ${TripPurchase.categories[e.category]}</small><h3>${esc(e.store)}</h3><p>${esc(e.memo||'메모 없음')}</p></div><div class="purchase-entry-end"><strong>${e.currency==='JPY'?e.amount.toLocaleString('ko-KR')+'엔':'US$'+e.amount.toFixed(2)}</strong><div><button class="small-link" data-purchase-action="edit" data-purchase-id="${e.id}" aria-label="${esc(e.store)} 수정">수정</button><button class="small-link" data-purchase-action="delete" data-purchase-id="${e.id}" aria-label="${esc(e.store)} 삭제">삭제</button></div></div></article>`).join(''):'<p class="purchase-empty">아직 구매 기록이 없습니다. 위에서 첫 기록을 추가해 주세요.</p>'}</div></section>`;
}
document.addEventListener('input',e=>{
  if(e.target.form?.id==='purchase-form'){purchaseDraft[e.target.name]=e.target.value;if(e.target.name==='purchasedAt')purchaseDraft.timeEdited=true;}
});
document.addEventListener('change',e=>{
  if(e.target.form?.id==='purchase-form'){purchaseDraft[e.target.name]=e.target.value;if(e.target.name==='purchasedAt')purchaseDraft.timeEdited=true;}
});
document.addEventListener('submit',e=>{
  if(!['purchase-form','purchase-rate-form'].includes(e.target.id))return;
  e.preventDefault();
  try{
    if(e.target.id==='purchase-rate-form'){
      persistPurchases({...purchaseLog,jpyPerUsd:TripPurchase.rate(new FormData(e.target).get('jpyPerUsd'))});
      renderPurchases();$('#purchase-status').textContent='환율을 저장했습니다.';return;
    }
    const form=Object.fromEntries(new FormData(e.target)),id=purchaseDraft.id||crypto.randomUUID();
    const row=TripPurchase.entry({...form,id,purchasedAt:purchaseDraft.id||purchaseDraft.timeEdited?form.purchasedAt:TripPurchase.localTime()});
    const entries=purchaseLog.entries.filter(p=>p.id!==id);entries.push(row);
    persistPurchases({...purchaseLog,entries});purchaseDraft=null;purchaseUndo=null;
    renderPurchases();$('#purchase-status').textContent='구매 기록을 저장했습니다.';
  }catch(error){$('#purchase-status').textContent=error.message;}
});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-purchase-action]');if(!b)return;
  try{
    const row=purchaseLog.entries.find(p=>p.id===b.dataset.purchaseId);
    switch(b.dataset.purchaseAction){
      case 'edit':if(!row)return;purchaseDraft={...row};renderPurchases();$('#purchase-form').scrollIntoView({block:'start'});$('#purchase-form [name="amount"]').focus({preventScroll:true});return;
      case 'cancel':purchaseDraft=null;break;
      case 'delete':if(!row)return;persistPurchases({...purchaseLog,entries:purchaseLog.entries.filter(p=>p.id!==row.id)});purchaseUndo=row;if(purchaseDraft?.id===row.id)purchaseDraft=null;break;
      case 'undo':if(!purchaseUndo)return;persistPurchases(TripPurchase.merge(purchaseLog,{version:1,entries:[purchaseUndo],jpyPerUsd:null}));purchaseUndo=null;break;
    }
    renderPurchases();
  }catch(error){$('#purchase-status').textContent=error.message;}
});
function exportRecords(){
  if(purchaseLoadError){message('구매 기록을 읽지 못해 전체 백업을 중지했습니다. 기존 브라우저 데이터를 먼저 확인해 주세요.');return;}
  const reviewRows=(data.reviewVideos||[]).map(v=>({id:v.id,restaurant:v.restaurant,videoUrl:v.url,excelSelection:v.selection,selection:TripReview.selection(v,videoReviews),note:videoReviews[v.id]?.note||'',reviewedAt:videoReviews[v.id]?.reviewedAt||'',source:videoReviews[v.id]?'web':'excel'}));
  const groupedReviews=reviewGroups.map(g=>({placeId:g.placeId,videoIds:g.videoIds,restaurant:g.restaurant,selection:TripReview.groupSelection(g,videoReviews),note:TripReview.groupNote(g,videoReviews),priority:g.placeId&&isMust(places.get(g.placeId))?'must':'normal',mapCategory:g.placeId?purposeCategory(places.get(g.placeId)):null}));
  const content=JSON.stringify({format:'tokyo-trip-records',version:2,trip:'2026-10-30',exportedAt:new Date().toISOString(),records,videoReviews,reviewRows,groupedReviews,purchaseLog},null,2);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));a.download='tokyo-trip-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);message('검토 결과·방문 체크·관심·메모·구매 기록을 내보냈습니다. 다운로드한 파일을 보관해 주세요.');
}

document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.browserMode){setBrowseMode(b.dataset.browserMode);return;}
  if(b.dataset.view){const sameMap=state.view==='map'&&b.dataset.view==='map';state.view=b.dataset.view;if(state.view!=='map'){state.akibaRoute=null;clearMapPlace(false);}if(!sameMap){render();if(state.view==='map')updateMap(true);}if(sameMap)setBrowseMode('map');return;}
  if(b.dataset.day){clearMapPlace(false);state.akibaRoute=null;state.day=b.dataset.day;render();if(state.foodScope==='route')updateMap(true);return;}
  if(b.dataset.akibaPin){focusMapPlace(b.dataset.akibaPin);return;}
  if(b.dataset.listTab){state.listTab=b.dataset.listTab;renderMapList();return;}
  if(b.dataset.foodArea){clearMapPlace(false);state.browseMode='map';syncPlaceBrowser();updateMap(false);const points=browseCandidates().filter(p=>p.coords&&purposeCategory(p)==='food'&&TripMap.area(p)===b.dataset.foodArea);if(points.length){map.fitBounds(L.latLngBounds(points.map(p=>p.coords)),{padding:[35,35],maxZoom:15,animate:false});$('#map-pane').scrollIntoView({block:'start'});}return;}
  if(b.dataset.reviewPage!==undefined){state.reviewPage=Math.max(0,Number(b.dataset.reviewPage)||0);renderReviewResults();$('#review-results').scrollIntoView({block:'start'});return;}
  if(b.dataset.nearby){selectFocus(b.dataset.nearby);return;}
  if(b.dataset.interest){
    const id=b.dataset.interest;records[id]={...(records[id]||{}),interested:!records[id]?.interested};saveRecords();
    document.querySelectorAll('[data-interest]').forEach(button=>{if(button.dataset.interest===id){button.textContent=records[id].interested?'★ 관심 저장됨':'☆ 관심 저장';button.classList.toggle('saved',records[id].interested);button.setAttribute('aria-pressed',String(records[id].interested));button.setAttribute('aria-label',places.get(id).name+' 관심 '+(records[id].interested?'해제':'저장'));}});
    if(state.view==='map'&&state.browseCollection==='saved'){renderExplorerResults();updateMap(false);}return;
  }
  if(b.dataset.locate){locatePlace(b.dataset.locate);return;}
  if(b.dataset.kind){state.kind=b.dataset.kind;renderPlaces();return;}
  if(b.dataset.place){openPlace(b.dataset.place);return;}
  switch(b.dataset.action){
    case 'close-dialog':closePlace();break;
    case 'map-fit':updateMap(true);break;
    case 'clear-map-place':clearMapPlace();break;
    case 'browse-all-categories':state.mapCategories=Object.keys(TripMap.categories);state.showFood=true;refreshPlaceBrowser();break;
    case 'browse-reset-all':state.browseCollection='all';state.mapCategories=Object.keys(TripMap.categories);state.showFood=true;refreshPlaceBrowser();break;
    case 'route-overview':showRouteOverview();break;
    case 'akiba-route':case 'akiba-north':showAkibaRoute('north');break;
    case 'akiba-radio':showAkibaRoute('radio');break;
    case 'city-wanted':showCityWanted();break;
    case 'food-distribution':showCityWanted(true);break;
    case 'dining-guide':state.view='prepare';render();$('#dining-guide')?.scrollIntoView({block:'start'});break;
    case 'search-map-center':selectFocus('map');break;
    case 'my-location':getMyLocation();break;
    case 'list-jump':setBrowseMode('list');break;
    case 'hotel-food-fit':state.browseMode='map';state.browseCollection='current';state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;render();updateMap(true);break;
    case 'hotel-bars':state.browseMode='map';state.browseCollection='current';state.akibaRoute=null;state.mapCategories=['bar','hotel'];state.view='map';state.showFood=true;state.listTab='food';state.foodScope='city';state.anchorId='city';state.foodMeal='afterDinner';state.foodQuery='';state.reviewFilter='all';state.includeUnknownHours=false;state.categories=['picked','unreviewed','recommended'];render();updateMap(true);break;
    case 'review-unreviewed':state.reviewStatus='미검토';state.reviewPage=0;state.reviewQuery='';renderReview();break;
    case 'review-map-wanted':showCityWanted();break;
    case 'review-map-must':showCityWanted(false,'must');break;
    case 'city-must':showCityWanted(false,'must');break;
    case 'food-toggle':state.browseMode='map';state.browseCollection='current';state.akibaRoute=null;enableMapCategory('food');state.view='map';render();break;
    case 'export':exportRecords();break;
    case 'import':$('#import-file').click();break;
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='browse-collection'){state.browseCollection=e.target.value;refreshPlaceBrowser();return;}
  if(e.target.id==='show-review-menu'){
    try{localStorage.setItem(REVIEW_MENU_KEY,String(e.target.checked));}
    catch{e.target.checked=showReviewMenu;message('메뉴 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');return;}
    showReviewMenu=e.target.checked;document.body.dataset.reviewMenu=showReviewMenu?'shown':'hidden';return;
  }
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
  if(e.target.dataset.mapCategory){state.mapCategories=[...document.querySelectorAll('[data-map-category]:checked')].map(x=>x.dataset.mapCategory);state.showFood=state.mapCategories.includes('food');refreshPlaceBrowser();return;}
  if(e.target.id==='food-display'){state.foodDisplay=e.target.value;updateMap(false);return;}
  if(e.target.dataset.videoReview){setVideoReview(e.target.dataset.videoReview,{selection:e.target.value});renderReviewResults();return;}
  if(e.target.id==='review-status'){state.reviewStatus=e.target.value;state.reviewPage=0;renderReviewResults();return;}
  if(e.target.id==='food-review'){state.reviewFilter=e.target.value;refreshPlaceBrowser();return;}
  if(e.target.id==='map-style'){setMapStyle(e.target.value);return;}
  if(e.target.id==='explore-anchor'){selectFocus(e.target.value);return;}
  if(e.target.id==='explore-radius'){state.radiusKm=Number(e.target.value);renderExplorerResults();updateMap(false);if(state.foodScope==='nearby')fitFocus();return;}
  if(e.target.id==='show-food'){state.showFood=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-fabric'){state.showFabric=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-route'){state.akibaRoute=null;state.showRoute=e.target.checked;if(state.showRoute)enableRouteCategories();renderMapList();updateMap(false);return;}
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
  if(e.target.id==='food-search'){state.foodQuery=e.target.value;refreshPlaceBrowser();return;}
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
    const importedPurchases=parsed.purchaseLog===undefined?null:TripPurchase.merge(purchaseLog,parsed.purchaseLog);
    if(importedPurchases)persistPurchases(importedPurchases);
    for(const record of Object.values(imported))if(!record.preferenceUpdatedAt)record.preferenceUpdatedAt=parsed.exportedAt||new Date().toISOString();
    records={...records,...imported};
    if(parsed.version===2)videoReviews={...videoReviews,...TripReview.normalizeReviews(parsed.videoReviews,new Set(reviewVideoMap.keys()))};
    saveRecords();saveVideoReviews();applyReviewSelections();render();message('저장한 기록을 가져왔습니다. 같은 항목은 파일의 기록으로 갱신했습니다.');
  }catch{message('기록을 가져오지 못했습니다. 이 여행 노트에서 내보낸 JSON 파일인지 확인해 주세요.');}
  e.target.value='';
});
async function start(){
  try{showReviewMenu=localStorage.getItem(REVIEW_MENU_KEY)==='true';}catch{showReviewMenu=false;}
  const response=await fetch('./trip-data.json?v=20261028-kbooks-ikebukuro-1',{cache:'no-cache'});if(!response.ok)throw new Error('데이터 불러오기');
  data=await response.json();places=new Map(data.places.map(p=>[p.id,p]));
  reviewVideoMap=new Map((data.reviewVideos||[]).map(v=>[v.id,v]));
  reviewGroups=TripReview.groups(data.reviewVideos||[],data.places);
  state.center=places.get(data.routePlan.hotelId).coords;loadRecords();loadPurchases();records=TripExplore.mergePreferenceBaseline(data.reviewBaseline||{},records);records=TripExplore.mergePreferenceBaseline(data.manualPlacePreferences||{},records);loadVideoReviews();applyReviewSelections();initMap();render();renderProgress();updateMap(true);
  if(places.has(history.state?.[DIALOG_HISTORY_KEY]))openPlace(history.state[DIALOG_HISTORY_KEY],false);
}
start().catch(()=>message('여행 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
