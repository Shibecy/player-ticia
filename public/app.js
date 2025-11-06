const audio = document.getElementById('audio');
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next');
const btnLike = document.getElementById('btn-like');
const btnDislike = document.getElementById('btn-dislike');
const elArtist = document.getElementById('artist');
const elTitle = document.getElementById('title');
const elSeek = document.getElementById('seek');
const elElapsed = document.getElementById('elapsed');
const elDuration = document.getElementById('duration');

const clientId = (() => {
  const k = 'player_client_id';
  let id = localStorage.getItem(k);
  if (!id) { id = Math.random().toString(36).slice(2); localStorage.setItem(k, id); }
  return id;
})();

const storeId = (() => {
  const p = new URLSearchParams(location.search);
  const fromUrl = p.get('store');
  const key = 'player_store_id';
  if (fromUrl) localStorage.setItem(key, fromUrl);
  return localStorage.getItem(key) || 'default';
})();

let tracks = [];
let idx = 0;
let likeState = null;

function fmt(sec){
  sec = Math.max(0, Math.floor(sec||0));
  const m = Math.floor(sec/60); const s = sec%60; return `${m}:${s.toString().padStart(2,'0')}`;
}

function setLikeUI(state){
  likeState = state;
  btnLike.classList.toggle('active', state === 'like');
  btnDislike.classList.toggle('active', state === 'dislike');
}

async function fetchLikeState(){
  const t = tracks[idx]; if (!t) return setLikeUI(null);
  const q = new URLSearchParams({ trackId: t.id, clientId, storeId });
  const r = await fetch(`/api/like/state?${q.toString()}`);
  if (!r.ok) return setLikeUI(null);
  const j = await r.json();
  setLikeUI(j.state || null);
}

function pickRandomIndex(excludeIndex = -1){
  if (!tracks.length) return 0;
  if (tracks.length === 1) return 0;
  let next = Math.floor(Math.random() * tracks.length);
  if (next === excludeIndex) {
    next = (next + 1) % tracks.length;
  }
  return next;
}

async function loadTracks(){
  try {
    const res = await fetch('/api/tracks?shuffle=true');
    const data = await res.json();
    tracks = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Erro ao carregar faixas', err);
    tracks = [];
  }
  if (tracks.length) {
    selectTrack(pickRandomIndex());
  }
}

function selectTrack(i){
  if (!tracks.length) return;
  idx = (i + tracks.length) % tracks.length;
  const t = tracks[idx];
  audio.src = t.url;
  elArtist.textContent = t.artist || 'Artista';
  elTitle.textContent = t.title;
  setLikeUI(null);
  fetchLikeState();
}

async function logEvent(type){
  const trackId = tracks[idx]?.id || null;
  const positionSec = audio.currentTime || 0;
  try {
    await fetch('/api/events',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ clientId, type, trackId, positionSec, storeId })
    });
  } catch (err) {
    console.error('Erro ao enviar evento', err);
  }
}

async function startPlayback(eventType='play'){
  if (!tracks.length) return;
  try {
    await audio.play();
  } catch (err) {
    console.error('Erro ao iniciar reprodução', err);
    return;
  }
  await logEvent(eventType);
}

async function playNextRandom(){
  if (!tracks.length) return;
  const nextIndex = pickRandomIndex(idx);
  selectTrack(nextIndex);
  await startPlayback('play');
}

function safePlayNextRandom(){
  playNextRandom().catch(err => console.error('Erro ao avançar faixa', err));
}

btnPlay.onclick = ()=>{ startPlayback('play'); };
btnPause.onclick = async ()=>{ audio.pause(); await logEvent('pause'); };
btnNext.onclick = ()=>{ safePlayNextRandom(); };

async function rate(like){
  const trackId = tracks[idx]?.id; if(!trackId) return;
  const r = await fetch('/api/like',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ trackId, clientId, like, storeId }) });
  const j = await r.json().catch(()=>({}));
  setLikeUI(j.state || (like ? 'like' : 'dislike'));
}
btnLike.onclick = ()=> rate(true);
btnDislike.onclick = ()=> rate(false);

audio.addEventListener('ended', ()=>{ safePlayNextRandom(); });
audio.addEventListener('timeupdate', ()=>{
  elSeek.value = (audio.currentTime / (audio.duration||1)) * 100;
  elElapsed.textContent = fmt(audio.currentTime);
  elDuration.textContent = fmt(audio.duration||0);
});
elSeek.addEventListener('input', ()=>{
  if (!audio.duration) return;
  const to = (elSeek.value/100) * audio.duration;
  audio.currentTime = to;
});

window.addEventListener('focus', ()=> logEvent('resume'));
window.addEventListener('blur', ()=> logEvent('pause'));

loadTracks();
