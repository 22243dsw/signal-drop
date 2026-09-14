const fileInput = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const fileList = document.querySelector('#fileList');
const uploadButton = document.querySelector('#uploadButton');
const toast = document.querySelector('#toast');
let selectedFiles = [];
let uploadedCode = null;
const CHUNK_SIZE = 16 * 1024 * 1024;

function formatSize(bytes) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function notify(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function chooseFiles(files) {
  selectedFiles = [...files];
  if (!selectedFiles.length) return;
  fileList.innerHTML = selectedFiles.map(file => `<div class="file-row"><span class="file-badge">FILE</span><div><strong>${escapeHtml(file.name)}</strong><span>${formatSize(file.size)}</span></div></div>`).join('');
  document.querySelector('#dropTitle').textContent = `${selectedFiles.length} 个文件已就绪`;
  document.querySelector('#dropHint').textContent = '再次选择可替换文件列表';
  fileList.classList.remove('hidden');
  uploadButton.disabled = false;
}
fileInput.addEventListener('change', () => chooseFiles(fileInput.files));
['dragenter', 'dragover'].forEach(event => dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(event => dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', e => chooseFiles(e.dataTransfer.files));

function request(method, url, body, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    if (onProgress) xhr.upload.onprogress = onProgress;
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new Error('request failed'));
    xhr.onerror = () => reject(new Error('network failed'));
    xhr.send(body);
  });
}

async function uploadOne(file, completedBytes, totalBytes) {
  const init = await request('POST', '/api/upload/init', null, { 'X-File-Name': encodeURIComponent(file.name), 'X-File-Size': String(file.size) });
  let offset = 0;
  while (offset < file.size || (file.size === 0 && offset === 0)) {
    const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
    const start = offset;
    const result = await request('PATCH', `/api/upload/${init.code}`, chunk, { 'X-Upload-Offset': String(offset) }, event => {
      const current = completedBytes + start + event.loaded;
      const percent = totalBytes ? Math.round(current / totalBytes * 100) : 100;
      document.querySelector('#progressBar').style.width = `${percent}%`;
      document.querySelector('#progressText').textContent = `${percent}%`;
    });
    offset = result.received ?? file.size;
    if (file.size === 0) break;
  }
  return init.code;
}

function renderCodes(codes) {
  const results = document.querySelector('#uploadResults');
  results.innerHTML = `<div class="results-title">取件暗号（发送给接收者）</div>${codes.map(item => `<div class="code-result"><span>${escapeHtml(item.name)}</span><strong>${item.code}</strong><button type="button" data-code="${item.code}">复制</button></div>`).join('')}`;
  results.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => { await navigator.clipboard.writeText(button.dataset.code); notify('暗号已复制'); }));
  results.classList.remove('hidden');
}

uploadButton.addEventListener('click', async () => {
  if (!selectedFiles.length) return;
  const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  let completedBytes = 0;
  const codes = [];
  uploadButton.disabled = true;
  document.body.classList.add('uploading');
  document.querySelector('#uploadProgress').classList.remove('hidden');
  document.querySelector('#uploadResults').classList.add('hidden');
  try {
    for (const file of selectedFiles) {
      const code = await uploadOne(file, completedBytes, totalBytes);
      codes.push({ name: file.name, code });
      completedBytes += file.size;
    }
    renderCodes(codes);
    notify('全部文件上传完成');
  } catch {
    notify('上传中断，请重新选择并上传');
  } finally {
    document.body.classList.remove('uploading');
    uploadButton.disabled = false;
  }
});

document.querySelector('#downloadForm').addEventListener('submit', async e => {
  e.preventDefault();
  const code = document.querySelector('#codeInput').value.replace(/\s/g, '').toUpperCase();
  if (!code) return;
  try {
    const response = await fetch(`/api/file/${encodeURIComponent(code)}`, { method: 'HEAD' });
    if (!response.ok) throw new Error();
    const encodedName = response.headers.get('Content-Disposition')?.split("''")[1];
    document.querySelector('#resultName').textContent = encodedName ? decodeURIComponent(encodedName) : '文件';
    document.querySelector('#result').classList.remove('hidden');
    uploadedCode = code;
  } catch { notify('找不到这组暗号，或它已失效'); }
});
document.querySelector('#downloadButton').addEventListener('click', () => { if (uploadedCode) window.location.href = `/api/file/${encodeURIComponent(uploadedCode)}`; });