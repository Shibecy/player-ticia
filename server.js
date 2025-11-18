import express from 'express';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';
import mime from 'mime';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const DEFAULT_STORE = process.env.STORE_ID || 'default';
const MUSIC_DIR = path.resolve('./music');
const DB_DIR = path.resolve('./data');
const DB_PATH = path.join(DB_DIR, 'mvp.db');

fs.mkdirSync(MUSIC_DIR, { recursive: true });
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/* ================== SCHEMA ================== */
db.exec(`
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  artist TEXT,
  title TEXT,
  store_id TEXT DEFAULT '${DEFAULT_STORE}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  is_like INTEGER NOT NULL,
  store_id TEXT NOT NULL DEFAULT '${DEFAULT_STORE}',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(track_id, client_id, store_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  track_id TEXT,
  position_sec REAL,
  store_id TEXT NOT NULL DEFAULT '${DEFAULT_STORE}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  store_id TEXT NOT NULL DEFAULT '${DEFAULT_STORE}'
);

CREATE TABLE IF NOT EXISTS heartbeats (
  store_id TEXT PRIMARY KEY,
  last_seen TEXT DEFAULT (datetime('now')),
  state TEXT,
  track_id TEXT
);

CREATE TABLE IF NOT EXISTS playtime_daily (
  store_id TEXT,
  day TEXT,
  seconds_played INTEGER DEFAULT 0,
  last_state TEXT,
  last_ts TEXT,
  PRIMARY KEY (store_id, day)
);
`);

try { db.exec(`ALTER TABLE tracks ADD COLUMN store_id TEXT DEFAULT '${DEFAULT_STORE}'`); } catch {}
try { db.exec(`ALTER TABLE events ADD COLUMN store_id TEXT DEFAULT '${DEFAULT_STORE}'`); } catch {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN store_id TEXT DEFAULT '${DEFAULT_STORE}'`); } catch {}

/* ================== PREPARED STATEMENTS ================== */
const stmtInsertTrack = db.prepare(`INSERT OR IGNORE INTO tracks (id, filename, artist, title, store_id) VALUES (@id, @filename, @artist, @title, @storeId)`);
const stmtFindTrack = db.prepare(`SELECT * FROM tracks WHERE id = ?`);
const stmtUpsertLike = db.prepare(`
  INSERT INTO likes (track_id, client_id, is_like, store_id) 
  VALUES (?, ?, ?, ?)
  ON CONFLICT(track_id, client_id, store_id) 
  DO UPDATE SET is_like = excluded.is_like, created_at = datetime('now')
`);
const stmtInsertEvent = db.prepare(`INSERT INTO events (client_id, event_type, track_id, position_sec, store_id) VALUES (?, ?, ?, ?, ?)`);
const stmtOpenSession = db.prepare(`INSERT INTO sessions (client_id, day, start_time, store_id) VALUES (?, ?, datetime('now'), ?)`);
const stmtCloseSession = db.prepare(`UPDATE sessions SET end_time = datetime('now') WHERE id = ?`);
const stmtGetOpenSess = db.prepare(`SELECT * FROM sessions WHERE client_id = ? AND day = ? AND store_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1`);

/* ================== MIDDLEWARES ================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

function adminAuth(req, res, next) {
  const u = process.env.ADMIN_USER || 'admin';
  const p = process.env.ADMIN_PASS || 'changeme';
  const h = req.headers['authorization'] || '';
  
  if (!h.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Auth required');
  }
  
  const [user, pass] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  if (user === u && pass === p) return next();
  
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Unauthorized');
}

const ADMIN_PATHS = ['/admin', '/api/admin', '/api/scan'];
app.use((req, res, next) => {
  if (ADMIN_PATHS.some(p => req.path === p || req.path.startsWith(p))) {
    return adminAuth(req, res, next);
  }
  next();
});

app.use('/public', express.static('public'));

/* ================== HELPERS ================== */
function stripExt(n) {
  return n.replace(/\.[^./\\]+$/, '');
}

function parseArtistTitleFromFilename(filename) {
  const base = stripExt(filename).trim();
  let artist = '', title = base;
  
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    artist = parts.shift().trim();
    title = parts.join(' - ').trim();
  } else {
    const i = base.indexOf('-');
    if (i > 0) {
      artist = base.slice(0, i).trim();
      title = base.slice(i + 1).trim();
    }
  }
  
  return { artist, title };
}

function sanitize(str) {
  return String(str || '').trim().replace(/[<>"']/g, '');
}

function getStoreId(req) {
  return sanitize(req.query.storeId || req.query.store || (req.body && req.body.storeId) || (req.body && req.body.store) || req.headers['x-store-id'] || DEFAULT_STORE);
}

function getClientId(req, res) {
  let clientId = req.cookies && req.cookies.clientId;
  if (!clientId) {
    clientId = nanoid(16);
    res.cookie('clientId', clientId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
  }
  return clientId;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================== SCAN SFTP ================== */
app.post('/api/admin/scan', (req, res) => {
  try {
    const files = fs.readdirSync(MUSIC_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext);
    });

    let added = 0, existing = 0;

    for (const filename of files) {
      const exists = db.prepare(`SELECT id FROM tracks WHERE filename = ?`).get(filename);
      
      if (!exists) {
        const id = nanoid(12);
        const meta = parseArtistTitleFromFilename(filename);
        
        stmtInsertTrack.run({
          id,
          filename,
          artist: sanitize(meta.artist) || 'Artista Desconhecido',
          title: sanitize(meta.title) || filename,
          storeId: DEFAULT_STORE
        });
        added++;
      } else {
        existing++;
      }
    }

    const allTracks = db.prepare(`SELECT id, filename FROM tracks`).all();
    let removed = 0;
    
    for (const track of allTracks) {
      const filePath = path.join(MUSIC_DIR, track.filename);
      if (!fs.existsSync(filePath)) {
        db.prepare(`DELETE FROM tracks WHERE id = ?`).run(track.id);
        db.prepare(`DELETE FROM likes WHERE track_id = ?`).run(track.id);
        db.prepare(`DELETE FROM events WHERE track_id = ?`).run(track.id);
        removed++;
      }
    }

    res.json({ 
      ok: true, 
      total: files.length,
      added, 
      existing, 
      removed,
      message: `✅ Scan completo: ${added} novas, ${existing} existentes, ${removed} removidas`
    });
  } catch (e) {
    console.error('Scan error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ================== ROTAS PÚBLICAS ================== */
app.get('/', (_, res) => res.sendFile(path.resolve('public/index.html')));

app.get('/api/tracks', (req, res) => {
  const shuffle = req.query.shuffle === 'true';
  
  let list = db.prepare(`SELECT id, filename, artist, title FROM tracks ORDER BY created_at DESC`).all().map(t => {
    let artist = t.artist, title = t.title;
    if (!artist || !title) {
      const d = parseArtistTitleFromFilename(t.filename);
      artist = artist || d.artist || 'Artista';
      title = title || d.title || t.filename;
    }
    return { id: t.id, artist, title, url: `/audio/${t.id}` };
  });
  
  if (shuffle) {
    list = shuffleArray(list);
  }
  
  res.json(list);
});

app.get('/audio/:trackId', (req, res) => {
  const t = stmtFindTrack.get(req.params.trackId);
  if (!t) return res.status(404).send('Track not found');
  
  const filePath = path.join(MUSIC_DIR, t.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
  
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const range = req.headers.range;
  const contentType = mime.getType(filePath) || 'audio/mpeg';
  
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : size - 1;
    
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start) + 1,
      'Content-Type': contentType
    });
    
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

app.get('/api/like/state', (req, res) => {
  const { trackId, clientId } = req.query || {};
  const storeId = getStoreId(req);
  
  if (!trackId || !clientId) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  
  const row = db.prepare(`
    SELECT is_like FROM likes 
    WHERE track_id = ? AND client_id = ? AND store_id = ?
  `).get(trackId, clientId, storeId);
  
  const state = row == null ? null : (row.is_like ? 'like' : 'dislike');
  res.json({ state });
});

app.post('/api/like', (req, res) => {
  const { trackId, clientId, like } = req.body || {};
  const storeId = getStoreId(req);
  
  if (!trackId || !clientId || typeof like !== 'boolean') {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  
  stmtUpsertLike.run(trackId, clientId, like ? 1 : 0, storeId);
  res.json({ ok: true, state: like ? 'like' : 'dislike' });
});

app.post('/api/events', (req, res) => {
  const { clientId, type, trackId, positionSec } = req.body || {};
  const storeId = getStoreId(req);
  
  if (!clientId || !type) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  
  const day = new Date().toISOString().slice(0, 10);
  
  if (type === 'play') {
    const count = db.prepare(`
      SELECT COUNT(*) c FROM events 
      WHERE client_id = ? AND store_id = ? 
      AND event_type IN ('play', 'resume') 
      AND DATE(created_at) = DATE('now')
    `).get(clientId, storeId).c;
    
    if (count === 0) {
      stmtInsertEvent.run(clientId, 'first_play_of_day', trackId || null, positionSec || 0, storeId);
    }
  }
  
  if (type === 'play' || type === 'resume') {
    const open = stmtGetOpenSess.get(clientId, day, storeId);
    if (!open) stmtOpenSession.run(clientId, day, storeId);
  }
  
  if (type === 'pause') {
    const open = stmtGetOpenSess.get(clientId, day, storeId);
    if (open) stmtCloseSession.run(open.id);
  }
  
  stmtInsertEvent.run(clientId, type, trackId || null, positionSec || 0, storeId);
  res.json({ ok: true });
});

app.post('/api/heartbeat', (req, res) => {
  try {
    const storeId = getStoreId(req);
    const state = sanitize(req.body.state || '');
    const trackId = sanitize(req.body.trackId || '');
    
    const nowLocal = db.prepare(`SELECT datetime('now', 'localtime') AS now`).get().now;
    const day = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    
    db.prepare(`
      INSERT INTO heartbeats (store_id, last_seen, state, track_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(store_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        state = excluded.state,
        track_id = excluded.track_id
    `).run(storeId, nowLocal, state, trackId);
    
    const row = db.prepare(`
      SELECT store_id, day, seconds_played, last_state, last_ts
      FROM playtime_daily 
      WHERE store_id = ? AND day = ?
    `).get(storeId, day);
    
    const calcSeconds = (from, to) => {
      const r = db.prepare(`SELECT (strftime('%s', ?) - strftime('%s', ?)) AS s`).get(to, from);
      return Math.max(0, Math.min(Number(r ? r.s : 0), 60));
    };
    
    if (!row) {
      db.prepare(`
        INSERT INTO playtime_daily (store_id, day, seconds_played, last_state, last_ts)
        VALUES (?, ?, 0, ?, ?)
      `).run(storeId, day, state, nowLocal);
    } else {
      let add = 0;
      if (row.last_ts && row.last_state === 'playing') {
        add = calcSeconds(row.last_ts, nowLocal);
      }
      
      db.prepare(`
        UPDATE playtime_daily
        SET seconds_played = seconds_played + ?,
            last_state = ?,
            last_ts = ?
        WHERE store_id = ? AND day = ?
      `).run(add, state, nowLocal, storeId, day);
    }
    
    res.json({ ok: true, storeId, state, trackId, now: nowLocal, day });
  } catch (e) {
    console.error('Heartbeat error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ================== PUBLIC APIS ================== */
app.get('/api/stores', (req, res) => {
  try {
    const stores = db.prepare(`SELECT DISTINCT store_id FROM heartbeats ORDER BY store_id`).all().map(r => r.store_id);
    res.json({ ok: true, stores });
  } catch (e) {
    console.error('stores error:', e);
    res.json({ ok: true, stores: ['itaipu', 'macae', 'rio'] });
  }
});

app.get('/api/now-playing', (req, res) => {
  try {
    const storeId = sanitize(req.query.storeId || 'default');
    const hb = db.prepare(`SELECT track_id FROM heartbeats WHERE store_id = ?`).get(storeId);
    if (!hb || !hb.track_id) {
      return res.json({ ok: true, nowPlaying: null });
    }
    const track = db.prepare(`SELECT id, artist, title FROM tracks WHERE id = ?`).get(hb.track_id);
    res.json({ ok: true, nowPlaying: track || null });
  } catch (e) {
    console.error('now-playing error:', e);
    res.json({ ok: true, nowPlaying: null });
  }
});

app.get('/api/report/daily', (req, res) => {
  try {
    const date = sanitize(req.query.date || '');
    const storeId = sanitize(req.query.storeId || 'default');
    const day = date || db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;

    const row = db.prepare(`SELECT seconds_played, last_ts FROM playtime_daily WHERE store_id = ? AND day = ?`).get(storeId, day);
    const totalSecondsPlayed = row ? row.seconds_played : 0;
    const dayStart = row && row.last_ts ? row.last_ts : null;

    res.json({ ok: true, totals: { totalSecondsPlayed, dayStart }, day, storeId });
  } catch (e) {
    console.error('report/daily error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/report/csv', (req, res) => {
  try {
    const date = sanitize(req.query.date || '');
    const storeId = sanitize(req.query.storeId || 'default');
    const day = date || db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;

    const events = db.prepare(`
      SELECT
        e.created_at,
        e.event_type,
        e.track_id,
        e.client_id,
        e.position_sec,
        t.artist,
        t.title
      FROM events e
      LEFT JOIN tracks t ON e.track_id = t.id
      WHERE e.store_id = ? AND date(e.created_at, 'localtime') = ?
      ORDER BY e.created_at
    `).all(storeId, day);

    let csv = 'timestamp,event,musica,artista,tempo_execucao_min,client\n';

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const musicName = e.title || 'Desconhecida';
      const artist = e.artist || '-';
      let executionTime = '';

      // Calcular tempo de execução: se for 'skip', 'pause' ou 'ended', pegar position_sec
      if ((e.event_type === 'skip' || e.event_type === 'pause' || e.event_type === 'ended') && e.position_sec) {
        const minutes = (e.position_sec / 60).toFixed(2);
        executionTime = minutes;
      }
      // Se for 'play' seguido de outro evento da mesma música, calcular diferença de tempo
      else if (e.event_type === 'play' && i + 1 < events.length) {
        const nextEvent = events[i + 1];
        if (nextEvent.track_id === e.track_id) {
          const timeDiff = db.prepare(`
            SELECT (strftime('%s', ?) - strftime('%s', ?)) AS diff
          `).get(nextEvent.created_at, e.created_at);
          if (timeDiff) {
            const minutes = (Math.max(0, timeDiff.diff) / 60).toFixed(2);
            executionTime = minutes;
          }
        }
      }

      csv += `${e.created_at},${e.event_type},"${artist} - ${musicName}","${artist}",${executionTime},${e.client_id}\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${storeId}-${day}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('report/csv error:', e);
    res.status(500).send('Error generating CSV');
  }
});

/* ================== ADMIN ================== */
app.get('/admin', (_, res) => res.sendFile(path.resolve('public/admin.html')));

app.get('/api/admin/tracks.json', (req, res) => {
  try {
    const q = sanitize(req.query.q || '');
    const store = sanitize(req.query.store || '');
    const onlyLikes = req.query.onlyLikes === '1';
    const onlyDislikes = req.query.onlyDislikes === '1';
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    
    let sql = `
      SELECT
        t.id, t.artist, t.title, t.store_id AS store, t.filename,
        (SELECT COUNT(*) FROM likes WHERE track_id = t.id AND is_like = 1 ${store ? 'AND store_id = ?' : ''}) AS likes,
        (SELECT COUNT(*) FROM likes WHERE track_id = t.id AND is_like = 0 ${store ? 'AND store_id = ?' : ''}) AS dislikes,
        (SELECT COUNT(*) FROM events WHERE track_id = t.id AND event_type = 'play' ${store ? 'AND store_id = ?' : ''}) AS plays
      FROM tracks t
      WHERE 1=1
    `;
    
    const params = [];
    if (store) params.push(store, store, store);
    
    if (q) {
      sql += ` AND (LOWER(t.artist) LIKE LOWER(?) OR LOWER(t.title) LIKE LOWER(?) OR LOWER(t.filename) LIKE LOWER(?))`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    
    if (store) {
      sql += ` AND t.store_id = ?`;
      params.push(store);
    }
    
    if (onlyLikes) {
      sql += ` AND EXISTS (SELECT 1 FROM likes WHERE track_id = t.id AND is_like = 1 ${store ? 'AND store_id = ?' : ''})`;
      if (store) params.push(store);
    }
    
    if (onlyDislikes) {
      sql += ` AND EXISTS (SELECT 1 FROM likes WHERE track_id = t.id AND is_like = 0 ${store ? 'AND store_id = ?' : ''})`;
      if (store) params.push(store);
    }
    
    sql += ` ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const items = db.prepare(sql).all(...params);
    
    const itemsWithStoreMetrics = items.map(item => {
      const storeMetrics = db.prepare(`
        SELECT 
          store_id,
          SUM(CASE WHEN is_like = 1 THEN 1 ELSE 0 END) as likes,
          SUM(CASE WHEN is_like = 0 THEN 1 ELSE 0 END) as dislikes
        FROM likes
        WHERE track_id = ?
        GROUP BY store_id
      `).all(item.id);
      
      return { ...item, storeMetrics };
    });
    
    const total = db.prepare(`SELECT COUNT(*) AS c FROM tracks`).get().c || 0;
    
    res.json({ ok: true, total, limit, offset, items: itemsWithStoreMetrics });
  } catch (e) {
    console.error('tracks.json error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/admin/track/delete', express.json(), express.urlencoded({ extended: true }), (req, res) => {
  try {
    const id = sanitize(req.body.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

    const row = db.prepare(`SELECT id, filename FROM tracks WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });

    db.prepare(`DELETE FROM likes WHERE track_id = ?`).run(id);
    db.prepare(`DELETE FROM events WHERE track_id = ?`).run(id);
    db.prepare(`DELETE FROM tracks WHERE id = ?`).run(id);

    try {
      const filePath = path.join(MUSIC_DIR, row.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('File unlink warning:', e);
    }

    res.json({ ok: true, id, message: '✅ Faixa deletada com sucesso' });
  } catch (e) {
    console.error('track.delete error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/admin/reset-likes', express.json(), (req, res) => {
  try {
    const result = db.prepare(`DELETE FROM likes`).run();
    res.json({
      ok: true,
      deleted: result.changes,
      message: `✅ ${result.changes} likes/dislikes removidos com sucesso`
    });
  } catch (e) {
    console.error('reset-likes error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/admin/tracks', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Player TI&CIA · Catálogo</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f7fa;padding:24px}.header{background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}h1{font-size:28px;font-weight:700;color:#1a202c;margin-bottom:20px}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}input,select,button{padding:10px 16px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-family:inherit}input[type="text"]{flex:1;min-width:280px}input[type="checkbox"]{width:auto;padding:0;margin-right:6px}button{background:#fff;cursor:pointer;transition:all 0.2s;font-weight:500}button:hover{background:#f7fafc}button:disabled{opacity:0.5;cursor:not-allowed}button.primary{background:#3182ce;color:#fff;border:none}button.success{background:#38a169;color:#fff;border:none}button.danger{background:#e53e3e;color:#fff;border:none}.table-wrap{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse}thead{background:#edf2f7}th{padding:14px;text-align:left;font-weight:600;font-size:13px;color:#4a5568;text-align:center}th:nth-child(1),th:nth-child(2),th:nth-child(3){text-align:left}td{padding:16px;border-bottom:1px solid #f7fafc;font-size:14px;text-align:center}td:nth-child(1),td:nth-child(2),td:nth-child(3){text-align:left}tr:hover{background:#f7fafc}tr.selected{background:#bee3f8}.badge{display:inline-block;background:#edf2f7;padding:4px 10px;border-radius:12px;font-size:12px}.muted{color:#a0aec0;font-size:13px}.pagination{display:flex;gap:16px;align-items:center;justify-content:center;padding:24px}.meta{text-align:center;color:#718096;padding:16px}.store-metric{font-size:16px}</style></head><body><div class="header"><h1>🎵 Catálogo de Músicas</h1><div class="controls"><select id="store"><option value="">Todas lojas</option><option value="itaipu">Itaipu</option><option value="macae">Macaé</option><option value="rio">Rio</option></select><input id="q" type="text" placeholder="Buscar por artista, música ou arquivo..."/><label><input type="checkbox" id="onlyLikes"/> Apenas Likes</label><label><input type="checkbox" id="onlyDislikes"/> Apenas Dislikes</label><button class="primary" id="apply">Filtrar</button><button class="success" id="scan">Scan /music</button><button class="danger" id="resetLikes">Zerar Likes/Dislikes</button></div></div><div class="meta" id="meta"></div><div class="table-wrap"><table><thead><tr><th style="width:50px"><input type="checkbox" id="selectAll"/></th><th>Artista</th><th>Música</th><th>Macaé</th><th>Itaipu</th><th>Rio</th><th>Plays</th><th style="width:80px">Ações</th></tr></thead><tbody id="tbody"></tbody></table></div><div class="pagination"><button id="prev">←</button><span id="pageInfo"></span><button id="next">→</button></div><script>let limit=50,offset=0,total=0,selectedIds=new Set();function buildQueryParams(){const p=new URLSearchParams();p.set('limit',limit);p.set('offset',offset);const store=document.getElementById('store').value;const q=document.getElementById('q').value;const onlyLikes=document.getElementById('onlyLikes').checked;const onlyDislikes=document.getElementById('onlyDislikes').checked;if(store)p.set('store',store);if(q)p.set('q',q);if(onlyLikes)p.set('onlyLikes','1');if(onlyDislikes)p.set('onlyDislikes','1');return p}function toggleSelection(id,checked){if(checked){selectedIds.add(id)}else{selectedIds.delete(id)}}function getStoreMetric(storeMetrics,storeId){const metric=storeMetrics.find(m=>m.store_id===storeId);if(!metric)return'—';if(metric.likes>0)return'<span class="store-metric">❤️</span>';if(metric.dislikes>0)return'<span class="store-metric">👎</span>';return'—'}async function load(){const p=buildQueryParams();const r=await fetch('/api/admin/tracks.json?'+p,{credentials:'include'});if(!r.ok){alert('Erro ao carregar: '+r.status);return}const js=await r.json();total=js.total||0;document.getElementById('meta').textContent='Total: '+total+' música(s)';document.getElementById('pageInfo').textContent='Página '+(Math.floor(offset/limit)+1)+' de '+(Math.ceil(total/limit)||1);const tb=document.getElementById('tbody');tb.innerHTML='';js.items.forEach(x=>{const tr=document.createElement('tr');const isSelected=selectedIds.has(x.id);if(isSelected)tr.classList.add('selected');const macae=getStoreMetric(x.storeMetrics||[],'macae');const itaipu=getStoreMetric(x.storeMetrics||[],'itaipu');const rio=getStoreMetric(x.storeMetrics||[],'rio');tr.innerHTML='<td><input type="checkbox" class="row-select" data-id="'+x.id+'"'+(isSelected?' checked':'')+'/></td>'+'<td>'+x.artist+'</td>'+'<td>'+x.title+'<div class="muted">'+x.filename+'</div></td>'+'<td>'+macae+'</td>'+'<td>'+itaipu+'</td>'+'<td>'+rio+'</td>'+'<td>'+x.plays+'</td>'+'<td><button class="danger btn-del" data-id="'+x.id+'">Del</button></td>';tb.appendChild(tr)});document.querySelectorAll('.row-select').forEach(cb=>{cb.onchange=()=>{toggleSelection(cb.dataset.id,cb.checked);cb.closest('tr').classList.toggle('selected',cb.checked)}});document.querySelectorAll('.btn-del').forEach(b=>{b.onclick=async()=>{if(!confirm('Deletar esta música permanentemente?'))return;const res=await fetch('/api/admin/track/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.id}),credentials:'include'});if(res.ok){alert('✅ Música deletada!');selectedIds.delete(b.dataset.id);load()}else{const err=await res.json();alert('❌ Erro ao deletar: '+(err.error||res.status))}}})}document.getElementById('selectAll').onchange=function(){const checked=this.checked;document.querySelectorAll('.row-select').forEach(cb=>{cb.checked=checked;toggleSelection(cb.dataset.id,checked);cb.closest('tr').classList.toggle('selected',checked)})};document.getElementById('apply').onclick=()=>{offset=0;selectedIds.clear();load()};document.getElementById('prev').onclick=()=>{offset=Math.max(0,offset-limit);load()};document.getElementById('next').onclick=()=>{if(offset+limit<total){offset+=limit;load()}};document.getElementById('scan').onclick=async()=>{const res=await fetch('/api/admin/scan',{method:'POST',credentials:'include'});if(res.ok){alert('✅ Scan concluído!');load()}else{alert('❌ Erro no scan')}};document.getElementById('resetLikes').onclick=async()=>{if(!confirm('⚠️ Isso irá DELETAR TODOS os likes e dislikes de TODAS as músicas de TODAS as lojas.\\n\\nTem certeza?'))return;const res=await fetch('/api/admin/reset-likes',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include'});if(res.ok){const data=await res.json();alert(data.message||'✅ Likes/dislikes resetados!');load()}else{const err=await res.json();alert('❌ Erro: '+(err.error||res.status))}};load()</script></body></html>`);
});

app.get('/admin/overview', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Overview</title><style>body{font-family:sans-serif;padding:24px}.cards{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}.status{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}.status.playing{background:#38a169}.status.paused{background:#ed8936}.status.offline{background:#e53e3e}</style></head><body><h1>📊 Overview</h1><div id="cards"></div><script>async function load(){const r=await fetch('/api/admin/overview_json?stores=itaipu,macae,rio',{credentials:'include'});const js=await r.json();const cards=document.getElementById('cards');cards.innerHTML='';js.items.forEach(x=>{const now=x.now_playing?(x.now_playing.artist+' - '+x.now_playing.title):'—';const st=x.status==='playing'?'playing':(x.status==='paused'?'paused':'offline');cards.innerHTML+='<div class="card"><h3>'+x.store+'</h3><div><span class="status '+st+'"></span>'+x.status+'</div><div>🎵 '+now+'</div><div>▶️ '+x.metrics_today.plays+' plays</div><div>❤️ '+x.metrics_today.likes+' likes</div></div>'})}setInterval(load,10000);load()</script></body></html>`);
});

app.get('/api/admin/overview_json', (req, res) => {
  try {
    const stores = (req.query.stores ? String(req.query.stores).split(',') : ['itaipu', 'macae', 'rio', 'default'])
      .map(s => s.trim()).filter(Boolean);
    
    const getOne = (sql, ...p) => {
      try { return db.prepare(sql).get(...p) || null; } catch { return null; }
    };
    
    const getVal = (sql, ...p) => {
      const r = getOne(sql, ...p);
      return r ? Object.values(r)[0] : null;
    };
    
    const today = getVal("SELECT date('now', 'localtime') AS d");
    
    const out = [];
    for (const store of stores) {
      const hb = getOne(`SELECT store_id, last_seen, state, track_id FROM heartbeats WHERE store_id = ?`, store);
      
      let status = 'offline';
      if (hb && hb.last_seen) {
        const last = getVal(`SELECT (strftime('%s', 'now', 'localtime') - strftime('%s', ?)) AS delta`, hb.last_seen);
        status = (last !== null && Number(last) <= 90) ? (hb.state || 'online') : 'offline';
      }
      
      let nowPlaying = null;
      if (hb && hb.track_id) {
        nowPlaying = getOne(`SELECT id, artist, title FROM tracks WHERE id = ?`, hb.track_id);
      }
      
      const firstPlay = getVal(`
        SELECT MIN(created_at) AS first FROM events
        WHERE store_id = ? AND event_type = 'play' AND date(created_at, 'localtime') = date('now', 'localtime')
      `, store);
      
      const playsToday = getVal(`
        SELECT COUNT(*) AS c FROM events
        WHERE store_id = ? AND event_type = 'play' AND date(created_at, 'localtime') = date('now', 'localtime')
      `, store) || 0;
      
      const likesToday = getVal(`
        SELECT COUNT(*) AS c FROM likes
        WHERE store_id = ? AND is_like = 1 AND date(created_at, 'localtime') = date('now', 'localtime')
      `, store) || 0;
      
      const dislikesToday = getVal(`
        SELECT COUNT(*) AS c FROM likes
        WHERE store_id = ? AND is_like = 0 AND date(created_at, 'localtime') = date('now', 'localtime')
      `, store) || 0;
      
      out.push({
        store,
        status,
        last_seen: hb ? hb.last_seen : null,
        now_playing: nowPlaying,
        first_play_today: firstPlay,
        metrics_today: {
          plays: Number(playsToday),
          likes: Number(likesToday),
          dislikes: Number(dislikesToday)
        }
      });
    }
    
    res.json({ ok: true, date: today, items: out });
  } catch (e) {
    console.error('overview_json error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ================== START SERVER ================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║  🎵 Player TI&CIA Server Running      ║
║  📡 Port: ${PORT}                        ║
║  📁 Music: ./music                     ║
║  🗄️  Database: ./data/mvp.db           ║
║                                        ║
║  🔐 Admin: /admin                      ║
║  📊 Overview: /admin/overview          ║
║  🎛️  Console: /admin/tracks            ║
║                                        ║
║  👤 User: ${process.env.ADMIN_USER || 'admin'}                   ║
║  🔑 Pass: ${process.env.ADMIN_PASS || 'changeme'}                ║
╚════════════════════════════════════════╝
  `);
});
