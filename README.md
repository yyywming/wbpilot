# WB Pilot — WorkBuddy 多账号任务助手

面向 **WorkBuddy（workbuddy.cn）** 的多账号任务中枢：账号导入、批量签到、成长任务、猫猫旅行、积分查询，另带一个本地 OpenAI / Anthropic 兼容网关。

> 账号来源说明：WorkBuddy 账号（`www.workbuddy.cn` 签发）可正常执行全部任务；CodeBuddy 账号（`www.codebuddy.cn` 签发）可以导入查看，但会被禁止切换到 WorkBuddy 客户端。

> 独立桌面程序，**不需要**安装或运行 WorkBuddy 客户端即可执行任务。

## 功能

- **多账号管理**：WorkBuddy / CodeBuddy 双扫码入口；支持多文件批量导入、一键导出全部账号（可回导）
- **导入格式**：单会话 `{account,auth}`、四段 auth 文件、数组、`{accounts:[...]}` 打包文件、扁平凭据
- **一键执行全部日常**：签到 → 成长任务 → 派猫 → 领奖，按账号汇总结果
- **自动执行**：签到按时间窗错峰、旅行每 30 分钟派发 / 每 15 分钟领取，后台常驻
- **积分查询**：逐账号查询官方余额、套餐用量、临期提醒（金额统一两位小数）
- **账号安全**：CodeBuddy 凭据会被识别并禁止切换进 WorkBuddy 客户端；删除二次确认；账号库损坏时拒绝覆盖
- **本地网关**：把账号积分暴露为 `http://127.0.0.1:3081/v1`（OpenAI /v1/chat/completions、Anthropic /v1/messages），支持局域网
- **自动更新**：静态清单检查 + SHA-256 校验后启动安装程序

## 下载

- GitHub Releases：<https://github.com/yyywming/wbpilot/releases>
- 蓝奏云：见发行说明

| 文件 | 说明 |
| --- | --- |
| `WBPilot-Setup-x.y.z.exe` | 安装版（每用户安装，桌面/开始菜单快捷方式，支持自动更新） |
| `WBPilot-portable.exe` | 便携版（双击即用，无需安装） |

## 快速开始

1. 运行程序，浏览器自动打开 `http://127.0.0.1:3081/`
2. 「扫码登录」添加账号，或「导入 JSON」导入已有凭据（需包含明文 `accessToken`）
3. 点「一键执行全部日常」，或在「每日签到 / 猫猫旅行」里开启自动执行
4. 需要 API 时，在「网关代理」页复制虚拟 Key，baseURL 填 `http://127.0.0.1:3081/v1`

数据目录：`%USERPROFILE%\.wbpilot-hub`（账号、配置、日志、更新缓存）。

## 从源码构建

```bat
pnpm install
pnpm test
pnpm run dist
```

产物在 `release/`：portable exe + NSIS 安装包。签名与自动更新见 [docs/SIGNING.md](docs/SIGNING.md)、[docs/UPDATE.md](docs/UPDATE.md)。

## 开源与免责声明

- 本项目基于 MIT 许可的开源项目 **wb-desktop**（<https://github.com/wbhubai/wb-desktop>）修改，原版权归其作者所有；修改内容与许可全文见 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。
- 与腾讯及 WorkBuddy / CodeBuddy 官方无任何隶属关系。
- 本工具通过非官方接口执行自动化操作，可能违反第三方服务条款并导致账号受限；请仅用于你本人拥有或已获授权的账号。
- 禁止用于批量注册、盗用账号、绕过风控或任何违法用途。
