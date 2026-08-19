# Run OpenHub (PowerShell)

# 1. 安装依赖
pnpm install

# 2. 准备环境
cd packages\server
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "[!] Created packages\server\.env - please set OPENHUB_MASTER_KEY (>=16 chars)"
}

# 3. 初始化数据库
pnpm db:push

# 4. 启动后端（另一终端）
cd packages\server
pnpm dev
# 监听 http://localhost:3000

# 5. 启动前端（再另一终端）
cd F:\code\测试
pnpm web:dev
# 访问 http://localhost:5173

# 6. 验证（任一终端）
curl http://localhost:3000/health
# 预期：{"status":"ok"}
