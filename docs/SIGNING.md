# Windows 代码签名

构建产物（portable / setup / 卸载器）会在 electron-builder 打包阶段用 `signtool.exe` 自动签名。

## 当前配置

- 证书：`certs/wbpilot-signing.pfx`（自签名，CN=WB Pilot，有效期 3 年）
- 密码：构建配置 `package.json` → `build.win.signtoolOptions.certificatePassword`
- 时间戳：`http://timestamp.digicert.com`（RFC 3161）
- 哈希：SHA-256

签名验证（本机）：

```bat
"%LOCALAPPDATA%\electron-builder\Cache\winCodeSign-2.6.0\winCodeSign-2.6.0-5puky\windows-10\ia32\signtool.exe" ^
  verify /pa /v release\WBPilot-Setup-1.0.0.exe
```

输出应包含 `Issued to: WB Pilot` 与 DigiCert 时间戳链。

## 重要：自签名不等于 SmartScreen 放行

自签名证书只能证明"文件未被篡改"，Windows 仍会提示未知发布者，SmartScreen 信誉也不会累积。要消除警告，需要购买受信任的代码签名证书：

- OV 证书：签名后仍需累积信誉，初期仍可能提示
- EV 证书：通常立即获得 SmartScreen 信任
- 或使用 Microsoft Azure Trusted Signing（按签名次数计费）

拿到证书后替换构建配置即可：

```json
"signtoolOptions": {
  "certificateFile": "certs/your-cert.pfx",
  "certificatePassword": "<密码>",
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://timestamp.digicert.com"
}
```

`certs/` 与 PFX 不应提交到公开仓库；泄露等同于他人可以用你的名义签名。
