# NOTICE — WB Pilot

本产品（WB Pilot）是开源项目 **wb-desktop**（https://github.com/wbhubai/wb-desktop）的修改版，
按 **MIT License** 分发。原项目版权归其作者（wb-hub）所有，许可证全文见 `LICENSE`。

## 本修改版做了什么

- 产品名称、界面标题、图标与数据目录（`~/.wbpilot-hub`）改为 WB Pilot；
- 新增账号 JSON 文件导入（`POST /api/accounts/import-json`，支持单会话根 / 四段 auth 文件 / 数组 / 扁平凭据）；
- 修复导入时数字型 `expiresAt` 被丢弃的问题；
- 替换使用声明文案，加入 MIT 归属说明。

功能逻辑（签到、成长任务、猫猫旅行、积分与网关）来自上游 wb-desktop。

## 第三方声明

- 本产品与腾讯及 WorkBuddy / CodeBuddy 官方无任何隶属关系。
- 自动化调用可能违反第三方服务条款，请仅用于你本人拥有或已获授权的账号。
- 不得用于批量注册、盗用账号或绕过风控等违法用途。
