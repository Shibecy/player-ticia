	import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'mvp.db');
if (!fs.existsSync(DB_PATH)) {
  console.error('Banco não encontrado em', DB_PATH);
  process.exit(1);
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const rows = db.prepare('SELECT id, filename, artist, title FROM tracks').all();

function sanitize(s) {
  if (!s) return s;
  let out = s;

  // Remove domínios/assinaturas comuns (com ou sem www, com [] ou ())
  const patterns = [
    /\[(?:https?:\/\/)?(?:www\.)?slider\.kz\]/gi,
    /\((?:https?:\/\/)?(?:www\.)?slider\.kz\)/gi,
    /(?:https?:\/\/)?(?:www\.)?slider\.kz/gi,

    /\[(?:https?:\/\/)?(?:www\.)?my[- ]?free[- ]?mp3s\.com\]/gi,
    /\((?:https?:\/\/)?(?:www\.)?my[- ]?free[- ]?mp3s\.com\)/gi,
    /(?:https?:\/\/)?(?:www\.)?my[- ]?free[- ]?mp3s\.com/gi,

    // Qualquer URL residual
    /https?:\/\/\S+/gi
  ];
  for (const re of patterns) out = out.replace(re, ' ');

  // Tira colchetes/pernas vazios
  out = out.replace(/\[\s*]/g, ' ').replace(/\(\s*\)/g, ' ');

  // Remove sobras padrões tipo " -  - " e underscores
  out = out.replace(/[_]+/g, ' ');
  out = out.replace(/\s*-\s*-\s*/g, ' - ');

  // Espaços múltiplos
  out = out.replace(/\s{2,}/g, ' ');

  // Tira traços/pontos/underscores no começo/fim
  out = out.replace(/^[\s\-_.]+/, '').replace(/[\s\-_.]+$/, '');

  return out.trim();
}

function deriveFromFilename(filename) {
  const base = filename.replace(/^[A-Za-z0-9_-]{8,}-/, ''); // remove prefixo id- se existir
  const noExt = base.replace(/\.[^./\\]+$/, '');
  let artist = '', title = noExt;
  const parts = noExt.split(' - ');
  if (parts.length >= 2) {
    artist = parts.shift().trim();
    title  = parts.join(' - ').trim();
  } else {
    const i = noExt.indexOf('-');
    if (i > 0) { artist = noExt.slice(0, i).trim(); title = noExt.slice(i + 1).trim(); }
  }
  return { artist: sanitize(artist), title: sanitize(title) };
}

const dry = process.argv.includes('--dry') || process.argv.includes('--preview');
let changed = 0;

for (const r of rows) {
  const derived = deriveFromFilename(r.filename);
  const newArtist = sanitize(r.artist || derived.artist);
  const newTitle  = sanitize(r.title  || derived.title);

  const aChanged = (r.artist || '') !== (newArtist || '');
  const tChanged = (r.title  || '') !== (newTitle  || '');

  if (aChanged || tChanged) {
    changed++;
    if (dry) {
      console.log(`[PREVIEW] ${r.id} :: "${r.artist || ''}" - "${r.title || ''}"  ==>  "${newArtist || ''}" - "${newTitle || ''}"`);
    } else {
      db.prepare('UPDATE tracks SET artist = ?, title = ? WHERE id = ?').run(newArtist || null, newTitle || null, r.id);
      console.log(`[UPDATE]  ${r.id} :: "${r.artist || ''}" - "${r.title || ''}"  ==>  "${newArtist || ''}" - "${newTitle || ''}"`);
    }
  }
}

console.log(dry ? `\nPreview: ${changed} registro(s) mudariam.` : `\nAplicado: ${changed} registro(s) atualizados.`);

