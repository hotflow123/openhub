#!/usr/bin/env bash
# OpenHub 端到端验证脚本（Windows / Git Bash / WSL 通用）
# 覆盖 Phase 1 (chat/embedding/image/audio) + Phase 3 (video async + param mapping)
#
# 前置条件：
#   1. 后端 dev server 在 3000 端口运行（pnpm dev），admin 账号 admin/admin123
#   2. mock-echo.cjs 在 9999 端口运行（node F:\code\测试\mock-echo.cjs 9999）
#   3. 已有 hub key 写到 HUB_KEY 环境变量
#
# 用法：
#   HUB_KEY=sk-openhub-xxx ./scripts/e2e.sh

set -e

BASE="${BASE:-http://localhost:3000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
HUB_KEY="${HUB_KEY:?请设置 HUB_KEY}"

bold() { printf "\n\033[1m== %s ==\033[0m\n" "$1"; }
fail() { printf "\033[31mFAIL: %s\033[0m\n" "$1"; exit 1; }
pass() { printf "\033[32mPASS: %s\033[0m\n" "$1"; }

bold "1. /v1/models 列出对外变体"
MODELS=$(curl -s "$BASE/v1/models")
echo "$MODELS" | grep -q "mock-gpt4o-mini" || fail "缺少 mock-gpt4o-mini"
echo "$MODELS" | grep -q "mock-sora" || fail "缺少 mock-sora"
pass "v1/models 包含所有验证需要的 variant"

bold "2. chat 路由返回 mock reply"
CHAT=$(curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"mock-gpt4o-mini","messages":[{"role":"user","content":"e2e ping"}]}')
echo "$CHAT" | grep -q "mock-reply" || fail "chat 未返回 mock reply: $CHAT"
pass "chat 200 + mock-reply"

bold "3. image / audio / embedding 三路"
IMG=$(curl -s -X POST "$BASE/v1/images/generations" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"mock-dalle","prompt":"cat","n":1,"size":"256x256"}')
echo "$IMG" | grep -q "example.com/mock-" || fail "image 失败: $IMG"
pass "image 200"

AUD=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/audio/speech" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"mock-tts","input":"hi","voice":"alloy"}')
[ "$AUD" = "200" ] || fail "audio 失败: $AUD"
pass "audio 200"

EMB=$(curl -s -X POST "$BASE/v1/embeddings" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"mock-embed","input":"hi"}')
echo "$EMB" | grep -q '"embedding"' || fail "embedding 失败: $EMB"
pass "embedding 200"

bold "4. 视频异步提交 + 轮询"
SUB=$(curl -s -X POST "$BASE/v1/video/generations" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"mock-sora","prompt":"test","duration":5,"aspect_ratio":"16:9"}')
TASK_ID=$(echo "$SUB" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$TASK_ID" ] || fail "提交失败: $SUB"
echo "task id: $TASK_ID"

# 最多等 20s
for i in $(seq 1 20); do
  POLL=$(curl -s "$BASE/v1/video/tasks/$TASK_ID" -H "Authorization: Bearer $HUB_KEY")
  STATUS=$(echo "$POLL" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "  [$i] status=$STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "timeout" ]; then
    break
  fi
  sleep 1
done

[ "$STATUS" = "completed" ] || fail "任务未完成: $POLL"
echo "$POLL" | grep -q "video_url" || fail "completed 任务无 video_url"
pass "video 任务 completed（含 video_url）"

bold "5. 参数映射（temperature 覆盖 + top_p 阻止）"
PARAM=$(curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"mock-param-mapped","messages":[{"role":"user","content":"map"}],"temperature":0.9,"top_p":0.9}')
echo "$PARAM" | grep -q "mock-reply(gpt-4o-mini):map" || fail "param-mapped chat 失败: $PARAM"
pass "param-mapped chat 200"

bold "6. 重复 variant name 返回 409"
CONFLICT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/admin/variants" \
  -u "$ADMIN_USER:$ADMIN_PASS" -H "Content-Type: application/json" \
  -d '{"name":"mock-gpt4o-mini","modelId":"syxSkBojD6lKPitGN9WVY__gpt-4o-mini"}')
[ "$CONFLICT" = "409" ] || fail "期望 409，得到 $CONFLICT"
pass "重复 variant name → 409"

bold "7. catalog sync 失败但返回 200 + status=failed"
SYNC=$(curl -s -X POST "$BASE/admin/catalog/sync" \
  -u "$ADMIN_USER:$ADMIN_PASS" -H "Content-Type: application/json" -d '{}')
echo "$SYNC" | grep -q '"status":"failed"' || fail "sync 状态非 failed: $SYNC"
pass "catalog sync 友好失败"

printf "\n\033[1;32m所有验证通过！\033[0m\n"
