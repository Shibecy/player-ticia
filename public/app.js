// ========================================
// PLAYER TI&CIA - app.js
// Versão limpa com shuffle automática
// ========================================

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

// Client ID único por navegador
const clientId = (() => {
  const key = 'player_client_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'client_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
})();

// Store ID da URL ou localStorage
const storeId = (() => {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('store');
  const key = 'player_store_id';
  
  if (fromUrl) {
    localStorage.setItem(key, fromUrl);
    return fromUrl;
  }
  
  return localStorage.getItem(key) || 'default';
})();

let tracks = [];
let currentIndex = 0;
let likeState = null;

// ========================================
// SHUFFLE - Embaralhar array
// ========================================
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ========================================
// FORMATAÇÃO DE TEMPO
// ========================================
function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ========================================
// UI DE LIKE/DISLIKE
// ========================================
function updateLikeUI(state) {
  likeState = state;
  btnLike.classList.toggle('active', state === 'like');
  btnDislike.classList.toggle('active', state === 'dislike');
}

// ========================================
// BUSCAR ESTADO DE LIKE/DISLIKE
// ========================================
async function fetchLikeState() {
  const track = tracks[currentIndex];
  if (!track) {
    updateLikeUI(null);
    return;
  }
  
  try {
    const params = new URLSearchParams({
      trackId: track.id,
      clientId: clientId,
      storeId: storeId
    });
    
    const response = await fetch(`/api/like/state?${params}`);
    if (!response.ok) {
      updateLikeUI(null);
      return;
    }
    
    const data = await response.json();
    updateLikeUI(data.state || null);
  } catch (error) {
    console.error('Erro ao buscar estado de like:', error);
    updateLikeUI(null);
  }
}

// ========================================
// CARREGAR PLAYLIST (COM SHUFFLE)
// ========================================
async function loadPlaylist() {
  try {
    const response = await fetch('/api/tracks');
    if (!response.ok) {
      throw new Error('Erro ao carregar músicas');
    }
    
    const data = await response.json();
    
    // 🎲 SHUFFLE AUTOMÁTICO
    tracks = shuffleArray(data);
    
    console.log(`✅ ${tracks.length} músicas carregadas e embaralhadas`);
    
    if (tracks.length > 0) {
      selectTrack(0);
    } else {
      elArtist.textContent = 'Nenhuma música';
      elTitle.textContent = 'Adicione músicas via SFTP';
    }
  } catch (error) {
    console.error('Erro ao carregar playlist:', error);
    elArtist.textContent = 'Erro';
    elTitle.textContent = 'Não foi possível carregar as músicas';
  }
}

// ========================================
// SELECIONAR FAIXA
// ========================================
function selectTrack(index) {
  if (!tracks.length) return;
  
  // Garantir índice válido (circular)
  currentIndex = ((index % tracks.length) + tracks.length) % tracks.length;
  
  const track = tracks[currentIndex];
  
  audio.src = track.url;
  elArtist.textContent = track.artist || 'Artista Desconhecido';
  elTitle.textContent = track.title || 'Sem Título';
  
  updateLikeUI(null);
  fetchLikeState();
  
  console.log(`🎵 Tocando: ${track.artist} - ${track.title}`);
}

// ========================================
// LOG DE EVENTOS
// ========================================
async function logEvent(eventType) {
  const track = tracks[currentIndex];
  const trackId = track ? track.id : null;
  const positionSec = audio.currentTime || 0;
  
  try {
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientId,
        type: eventType,
        trackId: trackId,
        positionSec: positionSec,
        storeId: storeId
      })
    });
  } catch (error) {
    console.error('Erro ao registrar evento:', error);
  }
}

// ========================================
// HEARTBEAT (60 segundos)
// ========================================
async function sendHeartbeat() {
  const track = tracks[currentIndex];
  const state = audio.paused ? 'paused' : 'playing';
  
  try {
    await fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: storeId,
        state: state,
        trackId: track ? track.id : null
      })
    });
  } catch (error) {
    console.error('Erro ao enviar heartbeat:', error);
  }
}

// ========================================
// CONTROLES - PLAY
// ========================================
btnPlay.onclick = async () => {
  try {
    await audio.play();
    await logEvent('play');
  } catch (error) {
    console.error('Erro ao tocar:', error);
  }
};

// ========================================
// CONTROLES - PAUSE
// ========================================
btnPause.onclick = async () => {
  audio.pause();
  await logEvent('pause');
};

// ========================================
// CONTROLES - PRÓXIMA
// ========================================
btnNext.onclick = async () => {
  if (!tracks.length) return;
  
  selectTrack(currentIndex + 1);
  
  try {
    await audio.play();
    await logEvent('skip');
  } catch (error) {
    console.error('Erro ao pular música:', error);
  }
};

// ========================================
// FEEDBACK - LIKE/DISLIKE
// ========================================
async function sendFeedback(isLike) {
  const track = tracks[currentIndex];
  if (!track) return;
  
  try {
    const response = await fetch('/api/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: track.id,
        clientId: clientId,
        like: isLike,
        storeId: storeId
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      updateLikeUI(data.state || (isLike ? 'like' : 'dislike'));
    }
  } catch (error) {
    console.error('Erro ao enviar feedback:', error);
  }
}

btnLike.onclick = () => sendFeedback(true);
btnDislike.onclick = () => sendFeedback(false);

// ========================================
// EVENTOS DE ÁUDIO
// ========================================

// Música terminou - tocar próxima
audio.addEventListener('ended', () => {
  btnNext.click();
});

// Atualizar progresso
audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    const percent = (audio.currentTime / audio.duration) * 100;
    elSeek.value = percent;
    elElapsed.textContent = formatTime(audio.currentTime);
    elDuration.textContent = formatTime(audio.duration);
  }
});

// Seek bar
elSeek.addEventListener('input', () => {
  if (!audio.duration) return;
  const newTime = (elSeek.value / 100) * audio.duration;
  audio.currentTime = newTime;
});

// ========================================
// EVENTOS DE JANELA
// ========================================
window.addEventListener('focus', () => logEvent('resume'));
window.addEventListener('blur', () => logEvent('pause'));

// ========================================
// INICIALIZAÇÃO
// ========================================

// Heartbeat a cada 60 segundos
setInterval(sendHeartbeat, 60000);

// Enviar heartbeat inicial após 5 segundos
setTimeout(sendHeartbeat, 5000);

// Carregar playlist ao iniciar
loadPlaylist();

// Log de inicialização
console.log('🎵 Player TI&CIA inicializado');
console.log('📍 Loja:', storeId);
console.log('👤 Client ID:', clientId);
