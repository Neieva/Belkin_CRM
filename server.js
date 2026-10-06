// Belkin CRM — сервер без внешних зависимостей. Данные хранятся в data/db.json,
// загруженные файлы — в data/files.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC = path.join(ROOT, 'public');
const MAX_UPLOAD = 25 * 1024 * 1024;

fs.mkdirSync(FILES_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

function readDb() {
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  if (fs.existsSync(DB_FILE)) {
    // одна резервная копия в день
    const day = new Date().toISOString().slice(0, 10);
    const bak = path.join(DATA_DIR, `db.backup-${day}.json`);
    if (!fs.existsSync(bak)) fs.copyFileSync(DB_FILE, bak);
  }
  fs.renameSync(tmp, DB_FILE);
}

function body(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, data, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

function serveFile(res, base, rel, extra = {}) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, { error: 'not found' });
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', extra);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/db' && req.method === 'GET') return send(res, 200, readDb() || { empty: true });

    if (p === '/api/db' && req.method === 'PUT') {
      const db = JSON.parse((await body(req, 20 * 1024 * 1024)).toString('utf8'));
      if (!db || !Array.isArray(db.projects)) return send(res, 400, { error: 'bad db' });
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const name = path.basename(url.searchParams.get('name') || 'file').replace(/[^\p{L}\p{N}._ -]/gu, '_');
      const id = crypto.randomBytes(6).toString('hex');
      const stored = `${id}-${name}`;
      fs.writeFileSync(path.join(FILES_DIR, stored), await body(req, MAX_UPLOAD));
      return send(res, 200, { url: `/files/${encodeURIComponent(stored)}`, name });
    }

    if (p.startsWith('/files/')) {
      // файлы отдаём как вложения, чтобы загруженный HTML не исполнялся на нашем origin
      return serveFile(res, FILES_DIR, p.slice(7), { 'Content-Disposition': 'attachment' });
    }

    return serveFile(res, PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Belkin CRM: http://localhost:${PORT}`));
