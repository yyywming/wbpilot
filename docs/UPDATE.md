# 自动更新

应用支持通过一份静态清单检查并安装新版本。默认不启用更新源，配置后才生效。

## 1. 更新清单格式

`latest.json`（UTF-8）：

```json
{
  "version": "1.0.1",
  "url": "https://your-host.example/wbpilot/WBPilot-Setup-1.0.1.exe",
  "sha256": "<安装包 SHA-256，64 位小写十六进制>",
  "notes": "本次更新说明（可选，最多 4000 字）"
}
```

约束：

- `url` 必须是 `https://`；本地调试允许 `http://127.0.0.1` / `http://localhost`
- `sha256` 必填，应用下载后校验，不匹配会删除安装包并报错
- `version` 必须是 `x.y.z` 形式，与当前版本做数值比较

## 2. 配置更新源

二选一：

- 环境变量 `WBPILOT_UPDATE_URL=https://your-host.example/wbpilot/latest.json`
- 数据目录下 `update.config.json`：

```json
{ "manifestUrl": "https://your-host.example/wbpilot/latest.json" }
```

数据目录：`%APPDATA%\..\.wbpilot-hub`（即 `C:\Users\<你>\.wbpilot-hub`）。
打包后的应用读取同一路径；便携版与安装版共用。

## 3. 发布流程

```bat
:: 1) 改 package.json version 为 1.0.1
:: 2) 构建（portable + setup，均自动签名）
pnpm run dist

:: 3) 生成清单（指向你的静态托管目录）
python scripts\make-update-manifest.py ^
  --version 1.0.1 ^
  --file release\WBPilot-Setup-1.0.1.exe ^
  --base-url https://your-host.example/wbpilot ^
  --notes "修复若干问题" ^
  --out release\latest.json

:: 4) 上传 WBPilot-Setup-1.0.1.exe 与 latest.json 到同一目录
```

客户端行为：

- 启动 4 秒后静默检查一次（未配置更新源时忽略）
- 顶栏「检查更新」按钮可手动检查；发现新版本会变成「更新 vX.Y.Z」
- 点击后确认 → 下载 → 校验 SHA-256 → 启动安装程序 → 应用自动退出，由安装程序完成升级

## 4. 注意

- 安装版升级会保留 `%APPDATA%\..\.wbpilot-hub` 里的账号数据与配置
- 便携版没有自动更新入口（`isPortable` 时后端仍可检查，但不会启动安装），请直接替换 exe
- 更新包必须是安装版（Setup.exe）；不要指向 portable.exe
