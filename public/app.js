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
  if (!id) { 
    id = Math.random().toString(36).slice(2); 
    localStorage.setItem(k, id); 
  }
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

// FUNÇÃO DE SHUFFLE
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setLikeUI(state) {
  likeState = state;
  btnLike.classList.toggle('active', state === 'like');
  btnDislike.classList.toggle('active', state === 'dislike');
}

async function fetchLikeState() {
  const t = tracks[idx];
  if (!t) return setLikeUI(null);
  
  const q = new URLSearchParams({ trackId: t.id, clientId, storeId });
  try {
    const r = await fetch(`/api/like/state?${q.toString()}`);
    if (!r.ok) return setLikeUI(null);
    const j = await r.json();
    setLikeUI(j.state || null);
  } catch (e) {
    console.error('Error fetching like state:', e);
    setLikeUI(null);
  }
}

async function loadTracks() {
  try {
    const res = await fetch('/api/tracks');
    tracks = await res.json();
    
    // SHUFFLE AUTOMÁTICO A CADA CARREGAMENTO
    tracks = shuffleArray(tracks);
    
    if (tracks.length) {
      selectTrack(0);
    }
  } catch (e) {
    console.error('Error loading tracks:', e);
  }
}

function selectTrack(i) {
  if (!tracks.length) return;
  
  idx = (i + tracks.length) % tracks.length;
  const t = tracks[idx];
  
  audio.src = t.url;
  elArtist.textContent = t.artist || 'Artista';
  elTitle.textContent = t.title;
  
  setLikeUI(null);
  fetchLikeState();
}

async function logEvent(type) {
  const trackId = tracks[idx]?.id || null;
  const positionSec = audio.currentTime || 0;
  
  try {
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, type, trackId, positionSec, storeId })
    });
  } catch (e) {
    console.error('Error logging event:', e);
  }
}

async function sendHeartbeat() {
  const trackId = tracks[idx]?.id || null;
  const state = audio.paused ? 'paused' : 'playing';
  
  try {
    await fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: storeId, state, trackId })
    });
  } catch (e) {
    console.error('Error sending heartbeat:', e);
  }
}

btnPlay.onclick = async () => {
  try {
    await audio.play();
    await logEvent('play');
  } catch (e) {
    console.error('Error playing:', e);
  }
};

btnPause.onclick = async () => {
  audio.pause();
  await logEvent('pause');
};

btnNext.onclick = () => {
  if (!tracks.length) return;
  selectTrack(idx + 1);
  audio.play();
  logEvent('skip');
};

async function rate(like) {
  const trackId = tracks[idx]?.id;
  if (!trackId) return;
  
  try {
    const r = await fetch('/api/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId, clientId, like, storeId })
    });
    
    const j = await r.json().catch(() => ({}));
    setLikeUI(j.state || (like ? 'like' : 'dislike'));
  } catch (e) {
    console.error('Error rating track:', e);
  }
}

btnLike.onclick = () => rate(true);
btnDislike.onclick = () => rate(false);

audio.addEventListener('ended', () => {
  btnNext.click();
});

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    elSeek.value = (audio.currentTime / audio.duration) * 100;
    elElapsed.textContent = fmt(audio.currentTime);
    elDuration.textContent = fmt(audio.duration);
  }
});

elSeek.addEventListener('input', () => {
  if (!audio.duration) return;
  const to = (elSeek.value / 100) * audio.duration;
  audio.currentTime = to;
});

window.addEventListener('focus', () => logEvent('resume'));
window.addEventListener('blur', () => logEvent('pause'));

// Heartbeat a cada 60 segundos
setInterval(sendHeartbeat, 60000);

// Carregar playlist ao iniciar
loadTracks();
