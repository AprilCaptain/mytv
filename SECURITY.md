# My TV 安全边界与检查

2026-10-15 完成一次针对外部配置、片源、JS / Python 插件、媒体代理、海报与历史存储的代码审查和加固。这是针对当前实现的检查，不是第三方渗透测试或安全认证。

## 使用建议

- 默认使用本机模式。局域网模式没有账号或权限区分，同网段能够访问该服务的人可以操作共同的观看历史；只在可信局域网开启，不做公网端口映射。
- 配置中的 JSON / XML 是数据；JS / Python 片源会执行第三方代码。仅使用信任的维护者和地址，优先 HTTPS；不需要脚本时可以关闭它们。
- 保持 Node、Python、浏览器和操作系统的安全更新。Node ≥22.18 是功能要求，不代表所有满足该版本条件的旧补丁版本都安全。
- 不要把账号口令、私人令牌放进陌生配置或插件。插件被允许通过受控桥访问公网，远程服务仍能知道请求的影片名称、网络出口和主动提供的凭证。源维护者也可能在日后更改代码；目前没有提供插件签名验证或人工批准代码更新的机制。

关闭 JS / Python 片源，仅保留 HTTP JSON / XML 片源：

macOS / zsh：

```sh
MYTV_DISABLE_PLUGINS=1 npm run launch
```

Windows PowerShell：

```powershell
$env:MYTV_DISABLE_PLUGINS='1'
npm run launch
```

该选项不改变现有 Node / Python 环境检查策略。只想准备 HTTP / JS 所需启动依赖时，可以另按 README 的 `MYTV_SKIP_PYTHON` 选项操作。

## 本次发现与加固

| 路径 | 审查发现 | 当前策略 |
| --- | --- | --- |
| 服务端公网请求（SSRF） | 直连已固定 DNS 校验结果；原系统代理路径会让代理重新解析域名，NO_PROXY 也可能重新解析 | 直连、NO_PROXY 使用校验 IP；代理 CONNECT 使用 IP 字面量，保留原请求 Host 和 HTTPS 证书 / SNI 校验；每次重定向重新检查。代理本身属于用户信任的网络基础设施 |
| 特殊地址 | IPv4 的部分保留网段、IPv6 6to4 / Teredo 等过渡地址不能按普通公网地址处理 | 拒绝本机接口、回环、私网、链路本地、映射回环及相关保留 / 过渡地址 |
| 海报 | 浏览器原先直接请求外部海报，绕开服务端地址检查 | 同源海报代理，统一检查网络目标；按实际文件头允许 JPEG / PNG / GIF / WebP / AVIF，限制 5 MiB 与 12 秒。SVG 等格式显示默认封面；CSP 不允许直接加载外站图片 |
| 媒体与插件代理 | 原始插件代理可能返回任意 MIME 和头，媒体代理对非 HTML 的主动内容限制不足 | 原始插件代理只供服务端内部使用；媒体拒绝 JS / SVG / XML 等主动内容 MIME；误标为 PNG / JPEG 等栅格图片的分片改为不可执行的 application/octet-stream，设置 nosniff 及禁止脚本的内容策略，不传播 Set-Cookie 等任意上游头 |
| 跨域播放子资源 | HLS 子列表 / 密钥 / 分片原先沿用全部播放头，可能把凭证带到其他站点 | 跨域重定向及 HLS 子资源只保留播放所需的普通头，不自动转发 Cookie、Authorization、自定义密钥头；同域仍可带必要凭证 |
| Python 沙箱 | 允许读取整个 Homebrew、/private/var/db、/dev 等范围过宽；原资源软限制可被插件重新调高 | 只读必要运行库、解释器与特定设备；父目录仅保留遍历所需访问；限制执行目标，禁用派生进程、core dump，固定 CPU 硬上限，尝试固定内存硬上限。网络仍必须走请求桥。不同 macOS 版本对内存限制的执行能力有差异 |
| 插件通信 / 资源消耗 | 畸形 Python JSON 帧可能造成主服务未处理异常；无换行输出和异步网络洪泛缺乏专门限制 | 非法帧关闭插件，Python 每帧最多 16 MiB；JS 发回结果前限制大小；每次调用最多 64 个桥接请求、最多 4 个并发请求；结束后取消未完成网络操作；现有 CPU / 内存 / 超时限制继续保留 |
| 文本清洗 | 原正则在大量未闭合尖括号下可能反复回溯，拖慢主服务 | 避免跨尖括号回溯，并增加 20 万字符的畸形输入测试 |
| HTTP 请求目标 | 单独校验 Host 还不足以防止绝对 URI 或反斜线改变解析后的 origin | 同时限制请求目标格式与最终 origin，保留 Host、同源与停止凭证检查 |

## 已存在并保留的保护

- 前端用 `textContent` 等文本 API 展示名称、简介、错误和线路；不把片源内容插入 `innerHTML`，不执行配置网页中的脚本。
- JSON / JSON5 按数据解析；XML 拒绝 DTD / ENTITY；配置、接口与播放列表有大小限制。
- JS 在 QuickJS / WebAssembly 中运行，没有直接暴露 Node 的 process、require 或文件接口；Worker 提供额外资源与超时隔离。Worker 本身不是沙箱，QuickJS 的隔离也不能被视为绝对保证。上游说明该项目尚未经过安全审计：[QuickJS security](https://github.com/justjake/quickjs-emscripten#security)。
- Python 仅在具备 macOS 系统隔离时启用。Windows 继续不启用 Python 插件，不退化为裸进程执行。
- 历史库使用参数化 SQL，搜索词不会拼成 SQL；物理删除与旧会话失效规则保持不变。
- 媒体 URL 使用随机会话及 HMAC 签名，浏览器不能任意篡改代理目标。内部代理令牌不存入观看历史。

## 可重复检查

```sh
npm run check
npm test
npm run security:check
```

`security:check` 执行安全回归测试、npm 生产依赖公告检查，以及 Python 锁定依赖的 OSV 公告查询。只向 npm 注册表 / OSV 发送包名、版本等依赖信息，不发送历史数据库、影视配置或本机文件；需要联网，查询失败时以“未完成”退出，不显示通过。不会安装运行时或修改依赖。

本次 npm audit 未发现锁定依赖的已知漏洞；10 项 Python 锁定依赖的 OSV 查询也未命中已知公告。这仅是查询时的结果，不能覆盖未知漏洞、被篡改的包、运行时或系统自身漏洞。

回归测试使用恶意 MIME、私网及编码地址、伪装图片、跨域凭证、JS 越权请求、网络洪泛、Python 畸形消息与文件 / 命令隔离用例；同时运行正常搜索、HLS、Range、Python 请求桥与历史功能测试。

防护设计参考 [OWASP SSRF 防护建议](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)，依赖查询使用 [OSV 批量查询 API](https://google.github.io/osv.dev/post-v1-querybatch/)。没有用户体系、TLS 终止、全局流量配额或针对浏览器解码器漏洞的额外隔离；服务仍定位为个人 / 可信局域网观影工具。

网站适配器的请求、播放地址解码和线路恢复也纳入 `test/websites.test.mjs`。它们使用项目内置代码，不把网站脚本作为 Node 程序执行；额外播放服务不转发来源凭证。金牌影视仅采用明确可供访客播放的档位，排除需要登录的地址。媒体分片仅在识别到连续 TS 同步包后去掉 PNG / JPEG 包装，不把图片当作页面执行。见 [网页片源说明](docs/WEB-SOURCES.md)。
