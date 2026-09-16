
# Signal Drop
已部署到网站：https://signal-drop.onrender.com/
一个通过取件暗号传输文件的小型本地服务。支持一次选择多个文件，并使用 16 MB 分块、偏移校验和流式磁盘写入，适合大型文件，不会把整个文件一次性读进内存。

文件按原始二进制传输，不会把内容当作 UTF-8 字符串处理，因此代码、TXT、HTML、WebM、ZIP 等文件下载后字节保持不变。每个文件会生成独立取件暗号。

## 启动

```bash
npm start
```

打开 <http://localhost:3000>。上传文件后，把页面生成的 10 位暗号发给接收者；接收者输入暗号即可下载。文件默认保存 24 小时，单个暗号最多下载 5 次，之后自动清理。

## 配置

默认监听 `3000` 端口，可通过环境变量修改：

```bash
PORT=8080 npm start
```

### Render + Cloudflare R2

在 Render 的 Environment Variables 中添加以下变量，服务会自动切换到 R2 对象存储。不要把密钥提交到 GitHub：

```text
STORAGE_MODE=s3
S3_ENDPOINT=https://<你的 Cloudflare Account ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<你的 R2 Bucket 名称>
S3_ACCESS_KEY_ID=<R2 Access Key ID>
S3_SECRET_ACCESS_KEY=<R2 Secret Access Key>
```

R2 的 Access Key 需要对目标 Bucket 拥有读写权限。配置完成后重新部署，文件、分块上传状态和暗号元数据都会存放在 R2，不依赖 Render 本地磁盘。没有这些变量时，程序自动使用本地 `data/` 目录，方便开发测试。

服务适合在可信网络或反向代理后使用；若部署到公网，建议再加 TLS、访问频率限制和身份认证。
