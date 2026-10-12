# My TV

本机运行的影视点播网页。支持 TVBox 配置、跨源搜索、影片内换源、线路切换、选集和 HLS / MP4 播放。没有数据库、账号系统或观看记录。所有配置、搜索结果、短期缓存和播放凭证都在内存中，重启后清空。

## 启动

下载整个仓库并解压到可写目录，或使用 Git 克隆。支持 macOS（Apple Silicon / Intel）和 Windows 10/11（x64 / ARM64），请先自行安装 Node.js 22+（含 npm）和 Python 3.11–3.14；首次安装项目依赖需要联网。

- macOS：双击「启动 My TV.command」。如果下载 / 解压后丢失执行权限，可在项目目录运行 `chmod +x "启动 My TV.command"`，或直接执行 `/bin/zsh "启动 My TV.command"`。
- Windows：双击「启动 My TV.cmd」。请先完整解压 ZIP，再运行，不要在压缩包中直接启动。

启动器会按顺序：

1. 检查已有 Node.js 22+ / npm 和 Python 3.11–3.14（Mac 也识别常见 Homebrew / nvm 安装）。缺少运行时、版本不符合或工具不完整时，给出手动安装提示并退出；不会下载或安装 Node / Python。运行时检查在所有项目依赖安装之前完成。
2. 检查整个 `package-lock.json` 的依赖版本、模块是否能加载和播放器文件。依赖缺失、损坏或锁定版本发生变化时执行 `npm ci` 修复。
3. 使用已有 Python 创建项目 `.venv`，检查并补装 `requirements.lock.txt` 中的 Python 项目依赖。
4. 等待服务健康检查通过后打开浏览器。如果当前项目的 My TV 已在运行，则连接到该服务并保留控制窗口；该窗口也能停止服务。遇到其他程序或未接入停止控制的旧服务占用端口会给出提示。

无需管理员权限、Homebrew、Docker 或数据库。Python 虚拟环境和项目依赖放在项目目录，不修改系统 PATH，也不把依赖安装到系统 Python。依赖已齐全时检查后直接启动，不重复下载安装；这一步不需要联网。实际远程影片访问仍需要网络。

默认打开 http://127.0.0.1:3210。启动窗口会保持运行，可以按 Ctrl+C，或输入 `q` 后回车停止服务。重复启动时新窗口也具有停止控制；任何一个控制窗口停止服务后，其他窗口会检测到服务已结束并退出。

原窗口已经关闭、显示「进程已完成」，或需要单独停止后台服务时：

- macOS：双击「停止 My TV.command」。
- Windows：双击「停止 My TV.cmd」。
- 在项目目录执行：`npm stop`。

停止入口只需要现有 Node，不检查 Python、不安装任何项目依赖。它通过项目私有的服务凭证停止当前 My TV，等待端口释放，并关闭插件进程；不会按端口号盲目杀掉其他程序。自定义端口时，启动与停止使用相同的 PORT。

更换后端代码后需要关闭旧服务并重新启动，网页没有后台热更新。

Node / Python 运行时检查失败，或项目依赖安装失败时，启动器提示原因并退出。Windows 可以使用 HTTP / JS 片源；Python 片源尚缺 Windows 系统隔离支持，因此目前仍未启用。

已有 Node 的开发者也可执行：

    npm run launch

仅准备环境、不启动服务：`npm run setup`。仅检查环境：`npm run doctor`。直接启动、不检查环境：`npm start`。

高级选项（环境变量）：

- `MYTV_SKIP_PYTHON=1`：显式跳过 Python 检查，只准备 HTTP / JS 的项目依赖。默认仍检查两个运行时。
- `MYTV_SETUP_ONLY=1`：双击入口仅安装和检查环境，不启动服务。
- `MYTV_NO_BROWSER=1`：服务就绪后不自动打开浏览器。

## 操作

1. 在侧边下拉框选择 TVBox 配置，默认「电视」。内置链接来自 qist/tvbox README 的「TVBox各路大佬配置」，也可通过加号导入自定义配置。配置和分类下拉项使用浅色背景、深色文字。
2. 首页自动选择当前配置中能够响应的片库，提供电影、剧集、动漫和具体分类。「换一个片库」会尝试当前配置中的另一个源。
3. 搜索覆盖当前配置的可尝试观影片源，采用滚动并发队列：最多 8 个 HTTP 源、4 个脚本源同时查询。有结果立即展示，一个慢源不会阻挡同批其他源继续补位。搜索可暂停，取消会传递到在途请求和插件。
4. 「全部片源」展示各源的影片卡片，卡片标出来源，同名影片不跨源合并。也可按片源筛选；该源支持分页时，可点击「加载更多」。每页返回的匹配结果全部保留，同一片源同一影片 ID 去重；接口重复返回相同页面时会停止继续加载。
5. 点击首页或搜索中的影片后，固定使用该入口的片源，播放页只提供线路与选集。播放失败时可换线路，或返回搜索选择其他片源。不会后台搜索并自动切换到其他片源。
6. 换线路时按集数编号匹配，例如「第02集」与「第2集」视为同一集。默认优先选择该片源中有 4K 标识的线路。
7. 播放器支持左右键前后跳转 10 秒，空格 / K 播放暂停、M 静音、F 全屏。鼠标停在进度条上显示对应时间，可点击或拖动进度条；音量与倍速可调整。输入框、下拉框和弹窗中的键盘操作不会触发播放器快捷键。

返回发现时保留当前搜索结果及片源筛选。没有持久化观看进度；进度条和集数匹配只使用当前页面状态。

## 配置读取兼容

读取层支持 JSON / JSON5、XML 点播接口、带 `8 位字母数字 + **` 标记的 Base64、`2423` 开头的 AES-CBC 文本及 JSON 字符串包装。允许有限次静态 HTML 跳转和独立 JSON 数据块；按最终响应地址解析相对 API / ext / 解析器地址。网页脚本和验证码不会执行。

服务器返回 HTTP 401 / 403 / 404、登录验证页、域名停放广告或普通 HTML 网站时，会显示对应原因。地址没有返回配置数据时，编码兼容不能还原不存在的内容。

2026-10-12 检查：极狐 `okcaptain/kko/raw/main/ok.txt` 返回 HTTP 401，饭太硬 `.top/tv/` 曾返回域名停放 / 广告页面，另一些请求连接失败。保留原入口；读取饭太硬旧入口失败时，可以手动选择「饭太硬（qist）」备用配置，不会自动替换原地址。备用内容来自 qist，不能保证与原配置相同或所有站点可播放。

`changeable=0` 表示不参与换源，不再将它误判为禁止点播。仍排除直播、工具与索引源，并单独尊重 `searchable`；备用配置的儿童 JS 源会被列为可尝试点播源，但本次试运行报内部请求地址错误，尚未验证可播放。其余大量影视源仍依赖 Android JAR。

配置读取成功与片源可播放分别判断；全部影视源依赖未支持的 Android JAR 时，显示播放兼容限制，避免误报 JSON 格式错误。

## 清晰度

源与线路的 4K / UHD / 2160p 标签用于优先排序。HLS 播放默认选择媒体列表中最高分辨率档位；播放器底部显示实际解码尺寸。

4K 取决于源返回的媒体文件、浏览器和设备的解码支持。默认「电视」配置的许多 4K 源仍属于 Android JAR 插件，尚未接入桌面脚本环境，因此不会出现在可搜索的片源中。不同源也可能指向同一个媒体地址。

## 插件兼容

支持：

- 普通 type 1 JSON、type 0 XML 点播接口。
- type 3 的 QuickJS / DRPY 风格 JavaScript 模块：init、home、homeVod、category、detail、search、play、proxy；支持相对模块加载、同步与常见异步请求、HTML 选择器、内存存储等宿主能力。
- type 3 的常见 Python Spider：base.spider、requests、PyCryptodome、lxml、BeautifulSoup，以及分类、搜索、详情、播放和本地代理接口。
- 配置中的普通 JSON 解析接口，插件返回的必要播放请求头，以及标准 HLS 子资源代理。

运行方式：

- JS 在独立 Node 工作线程里的 QuickJS WebAssembly 环境执行，不开放 Node 原生模块。
- Python 在独立进程中执行，通过 macOS 系统隔离限制文件和网络访问；网络请求由本机服务统一转发。
- 最多保留 4 个脚本运行环境，空闲 2 分钟自动释放。导入配置不会立即启动所有插件。
- 限制脚本运行时间、JS CPU 与内存、网络响应大小；换配置和取消搜索会取消旧请求。

仍需单独适配的情况：

- Android JAR、JNI、依赖 Android Context / WebView 的宿主功能。
- 特殊运行时、运行时动态模块下载、额外 Python 依赖或外部服务。
- 网盘登录、交互验证、网页嗅探、DRM 和浏览器不支持的编码。

具备 Node / Python 运行环境不代表兼容所有插件。源的实际可用性还受接口、地区、账号和网络影响。直播没有接入。

## Python 环境

项目依赖安装在 .venv 中，不修改系统 Python：

    npm run setup:python

依赖版本保存在 requirements.lock.txt。可通过 MYTV_BOOTSTRAP_PYTHON 指定创建虚拟环境的 Python；MYTV_PYTHON 可指定运行插件的 Python 可执行文件。Windows 虚拟环境路径为 `.venv/Scripts/python.exe`，macOS 为 `.venv/bin/python`。

没有可用的 Python 时给出提示并退出。请自行安装 Python 3.11–3.14，随后重新启动；项目依赖会安装进 .venv。若 npm / PyPI 网络受限，可配置自己的代理 / 包源后重试；脚本不关闭证书校验。

## 网络

默认只监听 127.0.0.1。支持 HTTP_PROXY / HTTPS_PROXY / NO_PROXY（及小写）环境变量；不会修改系统代理。代理连接失败，或 GET 返回 403 / 404 时，会尝试本机直连，并短暂记录成功的路由。

远程源不能指向本机或局域网；程序内部生成的插件代理地址通过受控桥处理。此版本针对互联网点播配置，不用于 NAS 片库。

macOS / Linux 更换端口：

    PORT=3211 npm start

Windows PowerShell：

    $env:PORT = "3211"
    npm start

## 验证

    npm test
    npm run check

自动测试覆盖 HTTP / XML / JS / Python 接口、同步和异步 JS、Python 文件/网络隔离、跨配置范围、同片版本匹配、集数编号、取消搜索、GBK 解码、HLS 与插件代理、MP4 Range、流式取消和脚本 CPU 限制。

本机 45 项自动测试通过，包含搜索并发与慢源补位、取消全部在途任务、指定片源分页、进度跳转边界和悬停时间计算，以及环境检查和服务停止保护。macOS 的双击入口也已在真实终端实测 Ctrl+C 停止并释放 3210 端口。

已验证搜索「兰香如故」返回 11 个片源的 13 条独立结果、片源筛选、加载更多及茶杯狐实播。暂停视频后，左右键各跳转 10 秒；进度条鼠标位置显示时间，输入框中的方向键不会改变播放进度。Python 华数的分类、影片列表、详情、播放解析和 HLS 媒体请求已实测。没有逐个验证所有内置配置或全部脚本，Windows 下拉框的实际系统渲染仍需 Windows 电脑验证。

`.github/workflows/startup.yml` 由 CI 自行提供 Node / Python，随后测试 macOS / Windows 启动器的项目依赖准备与停止流程；上传 GitHub 后自动运行。本地是 Mac，Windows 实机结果应以该工作流首次运行或实际 Windows 电脑验证为准。

## 分享到 GitHub

上传源代码、启动入口、scripts、public、lib、测试及两个依赖锁文件即可。`.gitignore` 已排除 `.runtime`、`.venv`、node_modules、测试截图和日志；通过 Git 提交时不需要上传本机安装环境。接收者自行安装 Node / Python，启动脚本再按本机环境准备项目依赖，不能跨平台复制 node_modules / .venv 使用。

## 主要文件

- server.mjs：本机服务与请求生命周期。
- lib/configs.mjs：内置配置链接。
- lib/discovery.mjs、lib/matching.mjs：片库选择、跨源搜索和同片匹配。
- lib/providers.mjs：源适配与播放解析。
- lib/plugins/：JS / Python 运行环境与网络桥。
- lib/playback.mjs、lib/network.mjs：媒体转发、HLS 改写与远程请求。
- public/：原生 HTML / CSS / JavaScript 界面，无前端构建服务。
- scripts/bootstrap.mjs、environment.mjs、setup-python.mjs：环境检查、依赖修复和服务启动。
- scripts/bootstrap-macos.sh、bootstrap-windows.ps1：两平台的 Node 检查入口。
- scripts/control.mjs、lib/lifecycle.mjs：前台控制、独立停止入口与服务凭证。

配置参考：https://github.com/qist/tvbox#readme
