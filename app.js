'use strict';
const KEY = 'tokyo-trip-20261030-records-v1';
const kinds = {pokemon:'포켓몬',card:'카드숍',shoe:'신발',fabric:'원단',whisky:'위스키',food:'맛집',hotel:'숙소',shopping:'쇼핑',sight:'관광'};
const kindIcons = {pokemon:'P',card:'C',shoe:'S',fabric:'F',whisky:'W',food:'食',hotel:'H',shopping:'S',sight:'T'};
const dayColors = {fri:'#b94936',sat:'#3c6256',sun:'#476a94'};
const state = {view:'map',day:'all',showFood:true,showFabric:false,foodScope:'route',foodMeal:'all',foodQuery:'',mapStyle:'simple',kind:'all',query:'',includeUnreviewed:false,listTab:'food',radiusKm:1,center:null,anchorId:'route',centerLabel:'전체 방문권역',includeUnknownHours:false,categories:['picked','unreviewed','recommended'],showRecommendations:true,showRoute:true,userPosition:null};
let data, places, records={}, map, mapLayer, foodLayer, baseLayer, dialogPlace, focusLayer;
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
  return {scope:state.foodScope,anchors:mappedRoutePlaces(),center:state.center,radiusKm:state.radiusKm,day:state.day,meal:state.foodMeal,query:state.foodQuery,categories:state.categories,includeUnknown:state.includeUnknownHours,records};
}
function foodCandidates(){return TripExplore.candidates(data.places,explorationContext());}
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
  if(!state.showRecommendations)return [];
  const context=explorationContext();
  return recommendationPlaces().filter(p=>state.foodScope==='hotel30'?distanceKm(p.coords,places.get(data.routePlan.hotelId).coords)<=state.radiusKm:!['route','nearby'].includes(state.foodScope)||TripExplore.referenceDistance(p,context)<=state.radiusKm);
}
function syncExploreControls(){
  const id=state.foodScope==='route'?'route':state.anchorId;
  $('#explore-anchor').innerHTML='<option value="route">전체 방문권역 · 참고 동선</option>'+`<option value="map">지도에서 선택한 지역</option>${state.userPosition?'<option value="user">내 위치</option>':''}`+
    '<optgroup label="방문할 장소">'+[...new Map(data.days.flatMap(d=>d.steps.filter(s=>s.place).map(s=>[s.place,places.get(s.place)]))).values()].map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup><optgroup label="동선을 넓힐 후보">'+recommendationPlaces().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup>';
  $('#explore-anchor').value=id;
  $('#explore-radius').value=String(state.radiusKm);
  $('#include-unknown-hours').checked=state.includeUnknownHours;
  $('#show-recommendations').checked=state.showRecommendations;$('#show-route').checked=state.showRoute;
  document.querySelectorAll('[data-food-category]').forEach(el=>el.checked=state.categories.includes(el.dataset.foodCategory));
  $('#explore-center-label').textContent=state.foodScope==='route'?`선택 날짜의 각 방문 장소에서 직선 ${state.radiusKm}km 주변 · 순서는 자유롭게 변경`:
    state.foodScope==='nearby'?`${state.centerLabel} · 직선 반경 ${state.radiusKm}km${state.anchorId==='user'?' · 위치는 저장하지 않습니다':''}`:
    state.foodScope==='hotel30'?`호텔 출발 약 30분권 · 이동·영업 안내가 있는 ${data.places.filter(p=>p.hotelFood?.travel?.within30).length}곳`:'넓게 비교하는 보기 · 장소를 선택하면 그 주변으로 좁힐 수 있습니다';
}
function selectFocus(id){
  let coords,label;
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
  else renderPrepare();
  updateMap(false);
}
function renderStop(s){
  if(!s.place)return `<article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card ${s.type==='meal'?'meal':'transport'}"><h3>${esc(s.title)}</h3><p>${esc(s.note)}</p></div></article>`;
  const p=places.get(s.place);
  return `<article class="stop"><div class="stop-time">${esc(s.time)}</div><div class="stop-card ${isDone(p.id)?'completed':''}"><div class="stop-meta"><span class="area-label">${esc(p.area)} · ${esc(kinds[p.kind])}</span>${badge(p.status,tone(p))}</div><h3><button data-place="${esc(p.id)}" style="text-align:left;padding:0;font-weight:700">${esc(p.name)}</button></h3><p>${esc(s.note)}</p><div class="stop-actions">${check(p)}<div><button class="small-link" data-place="${esc(p.id)}">상세</button><span aria-hidden="true"> · </span>${link(p.directionsUrl,'길안내 ↗','small-link')}</div></div></div></article>`;
}
function daySection(d){return `<section class="day-section"><div class="day-summary"><div class="route-heading"><div class="date-square"><small>${esc(d.weekday[0])}</small>${esc(d.date.split('.')[1])}</div><div><span class="eyebrow">${d.id==='fri'?'DAY 01':d.id==='sat'?'DAY 02':'DAY 03'} / ${esc(d.date)}</span><h2>${esc(d.title)}</h2></div></div><p>${esc(d.subtitle)}</p><div class="day-note">${esc(d.note)}</div></div><div class="timeline">${d.steps.map(renderStop).join('')}</div></section>`;}
function renderToday(){
  $('#left-pane').innerHTML=(state.day==='all'?'<div class="overview-note"><h3>전체 흐름부터 살펴보세요.</h3><p>금요일은 하라주쿠·시부야, 토요일은 숙소 주변·아키하바라·도쿄역 쇼핑 뒤 이케부쿠로 저녁 방문 가안, 일요일은 귀국 이동입니다. 식사는 후보 상태로 두었습니다.</p></div>':'')+selectedDays().map(daySection).join('<hr class="section-divider">')+
    `<div class="overview-note"><h3>APA 우에노 히로코지 숙박 확정</h3><p>예약한 숙소를 기준으로 한 쇼핑 동선입니다. 음식점은 후보 단계이고, 원단은 현재 동선에서 제외했습니다. Break Beats 예약 결과와 PRAS 지점 재고에 따라 조정합니다.</p><button class="small-link" data-view="prepare">예약과 준비 확인하기 →</button></div>`;
}
function placeCard(p){return `<article class="place-card ${isDone(p.id)?'done':''}"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(kinds[p.kind])}</span>${badge(p.status,tone(p))}</div><h3><button data-place="${esc(p.id)}" style="font-weight:700;text-align:left;padding:0">${esc(p.name)}</button></h3><p>${esc(p.summary)}</p><div class="place-card-bottom"><span class="card-count">${p.kind==='food'?esc(p.videoIds?.join(' · ')||''):p.day?'동선에 포함':'비교·선택 후보'}</span><button class="small-link" data-place="${esc(p.id)}">자세히 보기 ↗</button></div></article>`;}

function hoursLabel(p){return p.hotelFood?(p.hotelFood.hoursEvidence==='공식 안내'?'공식 영업 안내 있음':'영업 정보·주의사항 있음'):'영업 미확인 · 영상 정보는 참고용';}
function foodCard(p){
  const cat=TripExplore.category(p),label=p.hotelFood?.group==='hotel-bars'?'호텔 근처의 술집':{picked:'내 선택·모음 영상',unreviewed:'엑셀 미검토',recommended:'추가 추천'}[cat];
  return `<article class="place-card food-map-card" data-food-card="${esc(p.id)}"><div class="place-card-top"><span class="area-label">${esc(p.area)} · ${esc(p.videoIds.join(' · ')||'추천·보완')}</span>${badge(label,cat==='unreviewed'?'soft':'')}</div><h3><button data-place="${esc(p.id)}">${esc(p.name)}</button></h3><div class="explore-distance">${state.foodScope==='hotel30'?hotelTravelHtml(p):esc(nearbyLabel(p))}</div><p>${esc(p.hotelFood?.menu||p.summary)}</p><div class="quick-hours">${p.hotelFood?esc(state.day==='all'?hoursLabel(p)+' · 상세에서 요일별 확인':p.hotelFood.hours[state.day]):'영업 미확인 · 영상 메뉴·가격은 참고용'}</div>${p.hotelFood?.caution?`<p class="dining-caution">${esc(p.hotelFood.caution)}</p>`:''}<div class="food-card-actions">${interestButton(p)}<button data-locate="${esc(p.id)}" class="small-link">핀 보기</button><button data-place="${esc(p.id)}" class="small-link">${p.videoIds.length?'메뉴·시간·Shorts':'메뉴·시간'} →</button></div></article>`;
}
function renderFoodResults(){
  const list=foodCandidates(),mapped=list.filter(p=>p.coords),missing=list.filter(p=>!p.coords);
  const counts={picked:0,unreviewed:0,recommended:0};list.forEach(p=>counts[TripExplore.category(p)]++);
  const unresolved=data.places.filter(p=>p.kind==='food'&&!p.duplicateOf&&!p.coords);
  $('#food-results').innerHTML=`<div class="result-count" role="status">${mapped.length}곳 표시 · 내 선택 ${counts.picked} / 미검토 ${counts.unreviewed} / 추가 추천 ${counts.recommended}<br>가까운 순 · 직선거리이며 도보시간은 길찾기에서 확인 · 영상 메뉴·가격은 참고용${state.foodMeal!=='all'&&state.includeUnknownHours?'<br>식사 목적 미확인 후보도 포함합니다. ‘영업 미확인’ 표기를 확인하세요.':''}</div><div class="places-grid">${mapped.map(foodCard).join('')||'<div class="empty-state">주변 후보가 없습니다. 반경을 넓히거나 후보·식사 필터를 조정해 주세요.</div>'}</div>${missing.length?`<details class="unmapped-food"><summary>위치 미확인 ${missing.length}곳</summary>${missing.map(foodCard).join('')}</details>`:''}${unresolved.length&&!missing.length?`<details class="unmapped-food"><summary>위치 미확인 ${unresolved.length}곳 · 주변 판정 보류</summary><p class="section-intro">주소가 없거나 가게명과 주소가 맞지 않아 핀을 보류했습니다.</p>${unresolved.map(foodCard).join('')}</details>`:''}`;
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
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">EXPLORE AS YOU GO</span><h2>주변에서 다음 장소 고르기</h2></div></div><p class="section-intro">쇼핑 동선은 참고선입니다. 방문 장소를 고르거나 지도를 움직인 뒤 ‘이 주변에서 찾기’를 누르세요. 식당은 미리 시간표에 넣지 않아도 됩니다.</p><div class="explore-tabs" role="group" aria-label="주변 후보 목록"><button data-list-tab="food" aria-pressed="${state.listTab==='food'}">맛집</button><button data-list-tab="recommendations" aria-pressed="${state.listTab==='recommendations'}">추천 장소</button><button data-list-tab="route" aria-pressed="${state.listTab==='route'}">방문 장소</button><button data-list-tab="saved" aria-pressed="${state.listTab==='saved'}">★ 관심</button></div>${state.listTab==='food'?`<label class="search-box"><span aria-hidden="true">⌕</span><input id="food-search" type="search" aria-label="지도 맛집 검색" placeholder="메뉴·가게·엑셀 번호 검색" value="${esc(state.foodQuery)}"></label>`:''}<div id="food-results"></div>`;
  renderExplorerResults();
}

function filteredPlaces(){
  const q=state.query.trim().toLocaleLowerCase();
  return data.places.filter(p=>!p.duplicateOf&&(state.includeUnreviewed||defaultVisible(p))&&(state.kind==='all'||p.kind===state.kind)&&(!q||[p.name,p.area,p.summary,p.address,...(p.videoIds||[])].join(' ').toLocaleLowerCase().includes(q)));
}
function compilationHtml(){
  const selected=data.compilations.filter(v=>data.selectedVideoIds.includes(v.id));
  return selected.map(v=>`<details class="prepare-card"><summary>${esc(v.id)} · 선택한 모음 영상의 가게들</summary><p>모음 영상 선택을 모든 가게의 필수 방문으로 처리하지 않았습니다.</p>${link(v.video_url,v.title)}<ul>${v.restaurant_names.map((name,i)=>`<li>${v.source_map_urls?.[i]?link(v.source_map_urls[i],name):esc(name)}</li>`).join('')}</ul></details>`).join('');
}
function renderPlaceResults(){
  const list=filteredPlaces();
  $('#place-results').innerHTML=`<div class="result-count">${list.length}곳 · 음식점은 같은 가게의 영상을 묶어서 표시</div><div class="places-grid">${list.map(placeCard).join('')||'<div class="empty-state">검색 결과가 없습니다. 다른 이름이나 지역으로 찾아보세요.</div>'}</div>`;
}
function renderPlaces(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">YOUR COLLECTION</span><h2>장소 보관함</h2></div>${badge('선택 영상 '+data.selectedVideoIds.length+'개')}</div><p class="section-intro">방문 장소와 엑셀에서 고른 맛집을 모았습니다. 음식점의 식사 시간은 아직 미확정입니다.</p><label class="search-box"><span aria-hidden="true">⌕</span><input id="place-search" type="search" placeholder="가게 이름, 지역, 엑셀 번호로 검색" aria-label="장소 검색" value="${esc(state.query)}"></label><div class="chip-row" role="group" aria-label="장소 종류"><button data-kind="all" class="${state.kind==='all'?'active':''}">전체</button>${Object.entries(kinds).map(([k,v])=>`<button data-kind="${k}" class="${state.kind===k?'active':''}">${v}</button>`).join('')}</div><label class="check-control" style="margin-bottom:16px"><input type="checkbox" id="unreviewed-toggle" ${state.includeUnreviewed?'checked':''}>미검토 맛집도 포함하기</label><div id="place-results"></div><div style="margin-top:20px">${compilationHtml()}</div><p class="data-note">원본 ${data.videoCount}개 도쿄 후보 영상에서 가게별로 묶었습니다. 모음 영상은 별도로 보관합니다. 엑셀 상태는 사이트를 생성한 시점의 사본입니다.</p>`;
  renderPlaceResults();
}
function renderPrepare(){
  $('#left-pane').innerHTML=`<div class="section-heading"><div><span class="eyebrow">BEFORE YOU GO</span><h2>예약과 준비</h2></div></div>
    <article class="prepare-card featured">${badge('미예약 · 공개 시각 재확인','red')}<h3>Ramen Break Beats</h3><p>10.31 토요일 · 성인 1명 · 이른 점심 도전</p><div class="reserve-date">10.24 SAT / 21:00 <small>KST · JST</small></div><p>현재 공지에 따른 예약 공개 예상 시각입니다. 실제 영업·시간대는 예약 화면에서 확인합니다. 예약 결과가 토요일 동선을 결정합니다.</p>${link('https://www.tablecheck.com/ja/shops/ramenbreakbeats/reserve','TableCheck 예약 페이지 ↗','button-link')}<ul><li>예약 15분 전 도착 안내</li><li>수수료 500엔 · 전날부터 취소료 2,000엔 안내</li><li>실패 시 스즈하루 등 후보로 전환</li></ul><p>조건은 예약 시 표시되는 최신 안내를 우선합니다.</p></article>
    <article class="prepare-card">${badge('숙소 예약 완료')}<h3>APA 우에노 히로코지 기준 동선</h3><p>10.30 체크인 → 11.01 체크아웃 · 성인 1명 / 1실 / 2박. 사용자가 APA 우에노 히로코지 예약 완료를 확인했습니다. 결제 금액과 취소 조건은 예약 확인서 기준입니다.</p><div class="hotel-links">${link('https://www.apahotel.com/hotel/syutoken/tokyo/ueno-hirokoji/','APA 호텔 우에노 히로코지 ↗')}${link('https://www.booking.com/hotel/jp/apa-hotel-ueno-hirokoji.ko.html?checkin=2026-10-30&checkout=2026-11-01&group_adults=1&no_rooms=1&group_children=0&selected_currency=KRW','예약 사이트 ↗')}</div></article>
    <article class="prepare-card">${badge('약 $100 · 약간 초과 가능')}<h3>달콤한 한 병, 혹은 스모키한 한 병</h3><p>리커즈 하세가와에서 비교할 후보입니다. 아래는 10.20 웹 표시 가격(세금 포함, 700ml)이며 방문일 재고·가격은 별도입니다.</p>${data.whisky.candidates.map(w=>`<div class="whisky-row"><div><b>${link(w.url,w.name+' ↗')}</b><small>${esc(w.style)}</small></div><span>¥${w.price.toLocaleString('ja-JP')}</span></div>`).join('')}<p>두 스타일을 함께 고르면 글렌알라키 12년 + 탈리스커 10년 = 14,880엔도 비교 후보입니다. 최종 구매는 현장에서 결정합니다.</p></article>
    <article class="prepare-card"><h3>쇼핑에서 남은 확인</h3><ul><li>PRAS: 하라주쿠 지점에서 피팅할 상품이 있는지 확인</li><li>포켓몬: 30주년·그 밖의 한정 굿즈 우선, 재고는 미확인</li><li>음식점은 후순위, 원단 매장은 현재 동선에서 제외. 기존 후보는 장소 보관함에 유지</li><li>항공편: 예상 시간 기준이며 발권 완료 여부 미확인</li></ul></article>
    <article class="prepare-card"><h3>내 기록 보관하기</h3><p>방문 체크·관심·메모는 이 브라우저에 저장됩니다. 다른 기기로 옮기거나 보관하려면 내보내기 파일을 사용하세요. 가져오기는 파일에 있는 같은 장소의 기록을 덮어씁니다.</p><button class="button-link" data-action="export">체크·메모 내보내기</button> <button class="button-link" data-action="import">가져오기</button></article>`;
}

function mapPlaces(){
  const candidates=[...mappedRoutePlaces(),...(state.showFood?foodCandidates().filter(p=>p.coords):[]),...nearbyRecommendations(),...(state.showFabric?data.places.filter(p=>p.kind==='fabric'&&p.coords):[])];
  return [...new Map(candidates.map(p=>[p.id,p])).values()];
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
  foodLayer=(L.markerClusterGroup?L.markerClusterGroup({maxClusterRadius:30,showCoverageOnHover:false,spiderfyOnMaxZoom:true,animate:false,iconCreateFunction:cluster=>L.divIcon({className:'food-cluster',html:`<span>食 ${cluster.getChildCount()}</span>`,iconSize:[44,34]})}):L.layerGroup()).addTo(map);
  map.on('moveend',()=>{const center=map.getCenter();const moved=distanceKm([center.lat,center.lng],state.center)>.05;const b=$('[data-action="search-map-center"]');b.classList.toggle('pending',moved);b.textContent=moved?'⌖ 이 지역에서 다시 찾기':'⌖ 이 주변에서 찾기';});
}
function updateMap(fit=true){
  if(!map)return;
  mapLayer.clearLayers();foodLayer.clearLayers();focusLayer.clearLayers();markers.clear();syncExploreControls();
  $('#show-food').checked=state.showFood;$('#show-fabric').checked=state.showFabric;
  $('#food-scope').value=state.foodScope;$('#food-meal').value=state.foodMeal;
  const visible=mapPlaces(),list=foodCandidates();
  $('#map-legend').innerHTML='<span>H 호텔 · 숫자 방문 희망</span><span><i class="legend-food picked">食</i>내 선택</span><span><i class="legend-food unreviewed">食</i>미검토</span><span><i class="legend-food recommended">食</i>추가 추천</span><span>☆ 선택 방문</span>';
  $('#map-scope-note').textContent='食 뒤 숫자는 묶인 후보 수 · 날짜는 참고 동선·확인한 영업시간에 적용';
  $('#food-map-count').textContent=`맛집 ${state.showFood?list.filter(p=>p.coords).length:0}곳 · 추천 장소 ${nearbyRecommendations().length}곳`;
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
    const route=!!p.visits,cat=p.kind==='food'?TripExplore.category(p):null;
    const cls=p.kind==='hotel'?'hotel':route?p.routeDay:p.kind==='food'?'food '+cat:p.kind==='fabric'?'fabric':'optional';
    const label=route?p.routeOrder:p.kind==='food'?'食':p.exploreRecommended?'☆':kindIcons[p.kind];
    const icon=L.divIcon({className:'',html:`<span class="map-pin ${esc(cls)}">${esc(label)}</span>`,iconSize:[29,29],iconAnchor:[14,14]});
    const quick=p.kind==='food'?`<span class="popup-note">${esc(nearbyLabel(p))}<br>${esc(p.hotelFood?.menu||p.summary)}<br>${esc(p.hotelFood?(state.day==='all'?hoursLabel(p)+' · 상세에서 확인':p.hotelFood.hours[state.day]):'영업 미확인 · 지도에서 재확인')}</span>${link(contextDirections(p),state.foodScope==='nearby'?'기준점에서 길찾기 ↗':'Google 길찾기 ↗','popup-link')}`:`${p.buildingName?arrivalHtml(p):`<span class="popup-note">${esc(p.exploreTip||p.summary)}</span>`}<button class="popup-link" data-nearby="${esc(p.id)}">이 장소 주변 맛집 →</button>`;
    const marker=L.marker(p.coords,{icon,title:p.name,keyboard:true,zIndexOffset:p.kind==='hotel'?500:route?300:0}).addTo(p.kind==='food'?foodLayer:mapLayer).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.area)} · ${esc(p.status)}${quick}<button class="popup-link" data-place="${esc(p.id)}">${p.kind==='food'?'메뉴·시간·메모':p.buildingName?'상세·층수·메모':'상세·메모'} →</button> &nbsp;${interestButton(p)}`,p.buildingName?{minWidth:250,maxWidth:290,autoPanPaddingTopLeft:[12,52],autoPanPaddingBottomRight:[12,12]}:{});
    markers.set(p.id,marker);
  }
  const hotelBars=state.foodScope==='hotel30'&&state.foodMeal==='afterDinner';
  $('#map-title').textContent=hotelBars?'호텔 근처의 술집':state.foodScope==='route'?'방문권역 주변에서 탐색':state.foodScope==='nearby'?state.centerLabel+' 주변':'후보를 넓게 비교하기';
  requestAnimationFrame(()=>{map.invalidateSize();const fitPlaces=hotelBars?[places.get(data.routePlan.hotelId),...list.filter(p=>p.coords)]:visible;if(fit&&fitPlaces.length)map.fitBounds(L.latLngBounds(fitPlaces.map(p=>p.coords)),{padding:[30,30],maxZoom:hotelBars?16:14,animate:false});});
}
function locatePlace(id){
  const p=places.get(id);if(!p?.coords)return;
  if(p.kind!=='food'){selectFocus(id);return;}
  if(!foodCandidates().some(x=>x.id===id)){
    state.foodScope='nearby';state.center=p.coords;state.centerLabel=p.name;state.anchorId='map';state.foodMeal='all';state.foodQuery='';state.categories=['picked','unreviewed','recommended'];
  }
  state.view='map';state.showFood=true;render();
  $('#map-pane').scrollIntoView({behavior:'smooth',block:'start'});
  const marker=markers.get(id);if(!marker)return;
  map.setView(p.coords,16,{animate:false});
  if(foodLayer.zoomToShowLayer)foodLayer.zoomToShowLayer(marker,()=>marker.openPopup());else marker.openPopup();
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
  $('#dialog-content').innerHTML=`<span class="area-label">${esc(p.area)} / ${esc(kinds[p.kind])}</span><h2>${esc(p.name)}</h2>${badge(p.status,tone(p))}<p>${esc(p.summary)}</p><div class="detail-address">${esc(p.address||'주소 확인 필요')}</div><div class="detail-actions">${link(p.directionsUrl,'길안내 ↗','primary')}${link(p.mapUrl,'Google 지도 ↗')}${p.url?link(p.url,p.id==='food-G034'?'예약 페이지 ↗':'사이트 ↗'):''}${p.browse?link(p.browse,'상품 둘러보기 ↗'):''}${p.store?link(p.store,'매장 안내 ↗'):''}</div>${p.detail&&!p.hotelFood?`<p>${esc(p.detail)}</p>`:''}${p.hours&&!p.hotelFood?`<div class="detail-info">영상에 안내된 영업시간: ${esc(p.hours)}<br>방문일 영업시간은 다시 확인해 주세요.</div>`:''}${p.hotelFood?diningHtml(p,true):''}${p.exploreTip?`<div class="detail-info">${esc(p.exploreTip)}<br>${link(p.exploreTipUrl,'같은 층 공식 매장 안내 ↗')}</div>`:''}<div class="detail-info">${esc(p.coordinateNote)}</div>${check(p)} ${interestButton(p)}${p.kind!=='food'?`<button class="button-link" data-nearby="${esc(p.id)}">이 장소 주변 맛집</button>`:''}<label class="note-label" for="place-note">나의 메모</label><textarea id="place-note" maxlength="4000" placeholder="사고 싶은 상품, 고를 메뉴, 현장에서 확인할 것…">${esc(records[id]?.note||'')}</textarea><div class="note-hint">자동 저장 · 현재 브라우저에만 보관</div>${p.videos?.length?`<details class="source-videos"><summary>관련 Shorts ${p.videos.length}개 · 원본 확인</summary>${p.videos.map(v=>link(v.url,v.id+' · '+v.title+(v.selection==='가고 싶음'?' ✓':''))).join('')}</details>`:''}`;
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
  const content=JSON.stringify({format:'tokyo-trip-records',version:1,trip:'2026-10-30',exportedAt:new Date().toISOString(),records},null,2);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));a.download='tokyo-trip-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);message('방문 체크·관심·메모를 내보냈습니다. 다운로드한 파일을 보관해 주세요.');
}

document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.view){const sameMap=state.view==='map'&&b.dataset.view==='map';state.view=b.dataset.view;if(!sameMap)render();if(sameMap)$('#map-pane').scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(b.dataset.day){state.day=b.dataset.day;render();if(state.foodScope==='route')updateMap(true);return;}
  if(b.dataset.listTab){state.listTab=b.dataset.listTab;renderMapList();return;}
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
    case 'search-map-center':selectFocus('map');break;
    case 'my-location':getMyLocation();break;
    case 'list-jump':$('#left-pane').scrollIntoView({behavior:'smooth',block:'start'});break;
    case 'hotel-food-fit':state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;render();updateMap(true);break;
    case 'hotel-bars':state.view='map';state.showFood=true;state.listTab='food';state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;state.foodMeal='afterDinner';state.foodQuery='';state.includeUnknownHours=false;state.categories=['picked','unreviewed','recommended'];render();updateMap(true);break;
    case 'food-toggle':state.view='map';state.showFood=true;render();break;
    case 'export':exportRecords();break;
    case 'import':$('#import-file').click();break;
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='map-style'){setMapStyle(e.target.value);return;}
  if(e.target.id==='explore-anchor'){selectFocus(e.target.value);return;}
  if(e.target.id==='explore-radius'){state.radiusKm=Number(e.target.value);renderExplorerResults();updateMap(false);if(state.foodScope==='nearby')fitFocus();return;}
  if(e.target.id==='show-food'){state.showFood=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-fabric'){state.showFabric=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-route'){state.showRoute=e.target.checked;updateMap(false);return;}
  if(e.target.id==='show-recommendations'){state.showRecommendations=e.target.checked;renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='include-unknown-hours'){state.includeUnknownHours=e.target.checked;renderExplorerResults();updateMap(false);return;}
  if(e.target.dataset.foodCategory){state.categories=[...document.querySelectorAll('[data-food-category]:checked')].map(x=>x.dataset.foodCategory);renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='food-meal'){state.foodMeal=e.target.value;if(state.foodMeal==='afterDinner'){state.foodScope='hotel30';state.anchorId=data.routePlan.hotelId;state.includeUnknownHours=false;syncExploreControls();$('#food-scope').value=state.foodScope;}if(state.view==='map')renderExplorerResults();updateMap(false);return;}
  if(e.target.id==='food-scope'){state.foodScope=e.target.value;if(state.view==='map')renderMapList();updateMap(!['nearby'].includes(state.foodScope));if(state.foodScope==='nearby')fitFocus();return;}
  if(e.target.dataset.check){const id=e.target.dataset.check;records[id]={...(records[id]||{}),done:e.target.checked};saveRecords();render();}
  if(e.target.id==='unreviewed-toggle'){state.includeUnreviewed=e.target.checked;renderPlaceResults();}
});
document.addEventListener('input',e=>{
  if(e.target.id==='food-search'){state.foodQuery=e.target.value;renderFoodResults();updateMap(false);return;}
  if(e.target.id==='place-search'){state.query=e.target.value;renderPlaceResults();}
  if(e.target.id==='place-note'&&dialogPlace){records[dialogPlace]={...(records[dialogPlace]||{}),note:e.target.value};saveRecords();}
});
$('#import-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>1024*1024)throw new Error('ファイル');
    const parsed=JSON.parse(await file.text());
    if(parsed.format!=='tokyo-trip-records'||parsed.version!==1||parsed.trip!=='2026-10-30')throw new Error('형식');
    records={...records,...validateRecords(parsed.records)};saveRecords();render();message('저장한 체크와 메모를 가져왔습니다.');
  }catch{message('기록을 가져오지 못했습니다. 이 여행 노트에서 내보낸 JSON 파일인지 확인해 주세요.');}
  e.target.value='';
});
async function start(){
  const response=await fetch('./trip-data.json?v=20261025-explore',{cache:'no-cache'});if(!response.ok)throw new Error('데이터 불러오기');
  data=await response.json();places=new Map(data.places.map(p=>[p.id,p]));
  state.center=places.get(data.routePlan.hotelId).coords;loadRecords();initMap();render();renderProgress();updateMap(true);
  if(places.has(history.state?.[DIALOG_HISTORY_KEY]))openPlace(history.state[DIALOG_HISTORY_KEY],false);
}
start().catch(()=>message('여행 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
