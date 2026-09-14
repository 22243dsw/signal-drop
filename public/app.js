const fileInput = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const filePreview = document.querySelector('#filePreview');
const uploadButton = document.querySelector('#uploadButton');
const clearFile = document.querySelector('#clearFile');
const toast = document.querySelector('#toast');
let selectedFile = null;
let uploadedCode = null;

function formatSize(bytes) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function notify(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); }
function chooseFile(file) {
  if (!file) return;
  selectedFile = file;
  document.querySelector('#fileName').textContent = file.name;
  document.querySelector('#fileSize').textContent = formatSize(file.size);
  document.querySelector('#dropTitle').textContent = '文件已就绪';
  document.querySelector('#dropHint').textContent = '点击此处更换文件';
  filePreview.classList.remove('hidden'); uploadButton.disabled = false;
}
fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach(event => dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(event => dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', e => chooseFile(e.dataTransfer.files[0]));
clearFile.addEventListener('click', () => { selectedFile = null; fileInput.value = ''; filePreview.classList.add('hidden'); uploadButton.disabled = true; document.querySelector('#dropTitle').textContent = '拖入文件，或点击选择'; document.querySelector('#dropHint').textContent = '支持任意格式 · 大文件友好'; });

uploadButton.addEventListener('click', () => {
  if (!selectedFile) return;
  const xhr = new XMLHttpRequest();
  uploadButton.disabled = true; document.body.classList.add('uploading'); document.querySelector('#uploadProgress').classList.remove('hidden');
  xhr.open('POST', '/api/upload'); xhr.setRequestHeader('X-File-Name', selectedFile.name);
  xhr.upload.onprogress = event => { if (!event.lengthComputable) return; const percent = Math.round(event.loaded / event.total * 100); document.querySelector('#progressBar').style.width = `${percent}%`; document.querySelector('#progressText').textContent = `${percent}%`; };
  xhr.onload = () => { document.body.classList.remove('uploading'); if (xhr.status === 201) { const data = JSON.parse(xhr.responseText); uploadedCode = data.code; document.querySelector('#codeInput').value = data.code; notify('暗号已生成，复制给接收者即可'); } else { uploadButton.disabled = false; notify('上传失败，请重试'); } };
  xhr.onerror = () => { document.body.classList.remove('uploading'); uploadButton.disabled = false; notify('网络中断，请重试'); };
  xhr.send(selectedFile);
});

document.querySelector('#downloadForm').addEventListener('submit', async e => {
  e.preventDefault(); const code = document.querySelector('#codeInput').value.replace(/\s/g, '').toUpperCase(); if (!code) return;
  try { const response = await fetch(`/api/file/${encodeURIComponent(code)}`, { method: 'HEAD' }); if (!response.ok) throw new Error(); document.querySelector('#resultName').textContent = response.headers.get('Content-Disposition')?.split("''")[1] ? decodeURIComponent(response.headers.get('Content-Disposition').split("''")[1]) : '文件'; document.querySelector('#result').classList.remove('hidden'); uploadedCode = code; } catch { notify('找不到这组暗号，或它已失效'); }
});
document.querySelector('#downloadButton').addEventListener('click', () => { if (uploadedCode) window.location.href = `/api/file/${encodeURIComponent(uploadedCode)}`; });