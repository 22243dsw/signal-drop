const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_DOWNLOADS = 5;

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function safeFilename(value) {
  const name = String(value || 'unnamed-file').replace(/[\\/\0]/g, '_').trim();
  return (name || 'unnamed-file').slice(0, 180);
}

function decodeFilename(value) {
  try {
    return safeFilename(decodeURIComponent(String(value || '')));
  } catch {
    return safeFilename(value);
  }
}

function makeCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function metadataPath(code) {
  return path.join(DATA_DIR, `${code}.json`);
}

async function readMetadata(code) {
  try {
    return JSON.parse(await fsp.readFile(await metadataPath(code), 'utf8'));
  } catch {
    return null;
  }
}

async function handleUploadInit(req, res) {
  const code = makeCode();
  const filename = decodeFilename(req.headers['x-file-name']);
  const size = Number(req.headers['x-file-size']);
  if (!Number.isSafeInteger(size) || size < 0) return json(res, 400, { error: '文件大小无效。' });
  const upload = { code, filename, size, received: 0, createdAt: Date.now() };
  await fsp.writeFile(path.join(DATA_DIR, `${code}.upload.json`), JSON.stringify(upload), { flag: 'wx' });
  if (size === 0) {
    await fsp.writeFile(path.join(DATA_DIR, `${code}.part`), Buffer.alloc(0), { flag: 'wx' });
    return finishUpload(upload, res);
  }
  json(res, 201, { code, size, received: 0 });
}

async function finishUpload(upload, res) {
  const tempPath = path.join(DATA_DIR, `${upload.code}.part`);
  const filePath = path.join(DATA_DIR, `${upload.code}.bin`);
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of fs.createReadStream(tempPath)) hash.update(chunk);
    await fsp.rename(tempPath, filePath);
    const metadata = { code: upload.code, filename: upload.filename, size: upload.size, sha256: hash.digest('hex'), createdAt: upload.createdAt, downloads: 0 };
    await fsp.rm(path.join(DATA_DIR, `${upload.code}.upload.json`), { force: true });
    await fsp.writeFile(await metadataPath(upload.code), JSON.stringify(metadata), { flag: 'wx' });
    return json(res, 201, metadata);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    await fsp.rm(path.join(DATA_DIR, `${upload.code}.upload.json`), { force: true });
    if (!res.headersSent) json(res, 500, { error: '文件整理失败，请重试。' });
    else res.destroy(error);
  }
}

async function handleUploadChunk(req, res, code) {
  const uploadPath = path.join(DATA_DIR, `${code.toUpperCase()}.upload.json`);
  let upload;
  try {
    upload = JSON.parse(await fsp.readFile(uploadPath, 'utf8'));
  } catch {
    return json(res, 404, { error: '上传任务不存在或已过期。' });
  }
  const offset = Number(req.headers['x-upload-offset']);
  const length = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(offset) || offset !== upload.received || !Number.isSafeInteger(length) || length < 0 || offset + length > upload.size) {
    return json(res, 409, { error: '上传分块位置不匹配。', received: upload.received });
  }
  const chunkPath = path.join(DATA_DIR, `${upload.code}.chunk`);
  const tempPath = path.join(DATA_DIR, `${code}.part`);
  try {
    await pipeline(req, fs.createWriteStream(chunkPath, { flags: 'wx' }));
    const chunkStat = await fsp.stat(chunkPath);
    if (chunkStat.size !== length) throw new Error('chunk length mismatch');
    await pipeline(fs.createReadStream(chunkPath), fs.createWriteStream(tempPath, { flags: 'a' }));
    await fsp.rm(chunkPath, { force: true });
    upload.received += length;
    await fsp.writeFile(uploadPath, JSON.stringify(upload));
    if (upload.received === upload.size) return finishUpload(upload, res);
    json(res, 200, { code: upload.code, size: upload.size, received: upload.received });
  } catch (error) {
    await fsp.rm(chunkPath, { force: true });
    if (!res.headersSent) json(res, 500, { error: '上传未完成，请重试。' });
    else res.destroy(error);
  }
}

async function handleDownload(req, res, code) {
  const metadata = await readMetadata(code.toUpperCase());
  if (!metadata || Date.now() - metadata.createdAt > MAX_AGE_MS || metadata.downloads >= MAX_DOWNLOADS) {
    return json(res, 404, { error: '暗号无效、已过期或已达到下载次数。' });
  }

  const filePath = path.join(DATA_DIR, `${metadata.code}.bin`);
  try {
    await fsp.access(filePath);
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': metadata.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.filename)}`,
      'X-File-SHA256': metadata.sha256,
      'Cache-Control': 'no-store'
    };
    if (req.method === 'HEAD') return res.writeHead(200, headers).end();
    metadata.downloads += 1;
    await fsp.writeFile(await metadataPath(metadata.code), JSON.stringify(metadata));
    res.writeHead(200, headers);
    await pipeline(fs.createReadStream(filePath), res);
    if (metadata.downloads >= MAX_DOWNLOADS) {
      await fsp.rm(filePath, { force: true });
      await fsp.rm(await metadataPath(metadata.code), { force: true });
    }
  } catch (error) {
    if (!res.headersSent) json(res, 404, { error: '文件不存在或已被清理。' });
    else res.destroy(error);
  }
}

async function cleanupExpired() {
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.endsWith('.upload.json')) {
      const code = entry.name.slice(0, -12);
      const upload = await readJsonFile(path.join(DATA_DIR, entry.name));
      if (!upload || Date.now() - upload.createdAt > MAX_AGE_MS) {
        await fsp.rm(path.join(DATA_DIR, entry.name), { force: true });
        await fsp.rm(path.join(DATA_DIR, `${code}.part`), { force: true });
        await fsp.rm(path.join(DATA_DIR, `${code}.chunk`), { force: true });
      }
      continue;
    }
    if (!entry.name.endsWith('.json')) continue;
    const code = entry.name.slice(0, -5);
    const metadata = await readMetadata(code);
    if (!metadata || Date.now() - metadata.createdAt > MAX_AGE_MS) {
      await fsp.rm(path.join(DATA_DIR, `${code}.json`), { force: true });
      await fsp.rm(path.join(DATA_DIR, `${code}.bin`), { force: true });
      await fsp.rm(path.join(DATA_DIR, `${code}.part`), { force: true });
    }
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: '禁止访问' });
  try {
    const content = await fsp.readFile(file);
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    json(res, 404, { error: '页面不存在' });
  }
}

async function start() {
  await ensureDataDir();
  await cleanupExpired();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'POST' && url.pathname === '/api/upload/init') return handleUploadInit(req, res);
      if (req.method === 'PATCH' && url.pathname.startsWith('/api/upload/')) return handleUploadChunk(req, res, url.pathname.split('/').pop());
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/api/file/')) return handleDownload(req, res, url.pathname.split('/').pop());
      if (req.method === 'GET') return serveStatic(req, res);
      json(res, 405, { error: '不支持的请求方式' });
    } catch {
      json(res, 500, { error: '服务器内部错误' });
    }
  });
  server.requestTimeout = 0;
  server.listen(PORT, () => console.log(`Signal Drop is running at http://localhost:${PORT}`));
}

start().catch((error) => { console.error(error); process.exit(1); });