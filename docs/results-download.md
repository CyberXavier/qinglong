# 定时拉取脚本结果

在青龙「系统设置 → 应用设置」创建专用应用，仅授予「脚本结果（只读）」权限，保存其 Client ID 和 Client Secret。由接收服务器配置定时任务，建议在结果脚本完成后执行。

## 获取 Token

以下为 Bash 示例，接收服务器需要 `curl`、`jq` 和 `unzip`。`QL_URL` 填面板地址，不带末尾 `/`；如果面板使用路径前缀，应包含前缀。

```bash
set -euo pipefail
QL_URL='https://qinglong.example.com'
CLIENT_ID='替换为应用 Client ID'
CLIENT_SECRET='替换为应用 Client Secret'

AUTH=$(curl --fail --silent --show-error --get \
  --connect-timeout 15 --max-time 60 \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  "$QL_URL/open/auth/token")
TOKEN=$(printf '%s' "$AUTH" | jq -er 'select(.code == 200) | .data.token | select(type == "string" and length > 0)')
EXPIRATION=$(printf '%s' "$AUTH" | jq -er '.data.expiration')
```

实际定时程序应缓存 `TOKEN` 和 `EXPIRATION`，后者为 Unix 秒级时间戳；到期重新获取。下载收到 HTTP 401 时可重新获取 Token 并重试一次，仍失败则保留上一份结果并等待下次任务。不要每下载一个文件就申请 Token。

## 下载文件夹 ZIP

唯一开放的结果接口为 `POST /open/results/download`，携带 `Authorization: Bearer <token>`。请求为 JSON：

```json
{"path":"","filename":"任务A"}
```

这会下载项目 `data/res/任务A`，ZIP 内包含 `任务A/` 及其全部子文件夹、文件和空目录，支持中文名称。下载 `data/res/分类/任务A` 时，使用 `{"path":"分类","filename":"任务A"}`。也可指定普通文件，此时返回原文件而非 ZIP。

下面紧接获取 Token 的示例执行。先写临时文件，确认请求成功且 ZIP 完整后再替换本地归档；任一步失败均不会覆盖上一份。

```bash
PART=$(mktemp './任务A.zip.part.XXXXXX')
trap 'rm -f -- "$PART"' EXIT

curl --fail --silent --show-error \
  --connect-timeout 15 --max-time 0 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"path":"","filename":"任务A"}' \
  --output "$PART" \
  "$QL_URL/open/results/download"

unzip -tqq "$PART"
mv -f -- "$PART" './任务A.zip'
```

`curl --fail` 拒绝 HTTP 错误响应；`unzip -tqq` 拒绝非 ZIP 或不完整的压缩包。普通文件下载时应使用对应文件的校验方式。ZIP 请求不设总超时，部署时也应根据目录大小调整反向代理的超时。

## 权限和边界

- 此权限可以下载 `data/res` 下所有合法子路径，不限制到某一个文件夹；固定下载目录配置在调用方。
- 不开放结果列表、预览、删除或其他结果接口；面板内原有功能不受影响。
- 不允许下载 `res` 根目录或目录外路径；打包跳过符号链接和非普通文件。
- 每次全量打包，不记录同步进度、不自动删除源文件。接收方保存 ZIP 后自行决定如何解压或更新。
- 打包不锁定脚本写入，也不提供目录快照；文件仍在写入时可能读到变化中的内容，应在脚本完成后拉取。
