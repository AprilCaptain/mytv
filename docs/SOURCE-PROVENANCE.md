# 影源来源与维护手册

整理日期：**2026-10-18**。本文件记录「从哪里发现、谁在发布、去哪里找更新」，不把本次网页或配置读取成功当作新一轮播放验证。内置 HTTP / 网站来源的上一轮播放抽样为 **2026-10-16**，详见 [当时的测试数据](source-checks-2026-10-16.json)。

- [来源清单 JSON](source-origins.json)：6 个配置入口、21 个 HTTP 来源、4 个网站来源、维护链接、引用仓库和已发现的域名变化，适合后续维护任务读取。
- [外部配置引用快照](source-origin-snapshot-2026-10-18.json)：当天「电视」151 条、橘子柚 93 条声明的原始 key、托管位置和插件类别；包含工具、直播及未兼容条目，**不代表这些条目均可搜索或播放**。快照去掉查询参数、请求头、凭证和内联参数，不能直接导入播放。
- 本次没有替换播放地址、增删片源，也没有创建定时任务。未来自定义导入的配置不在这份静态台账中。

## 先分清几层来源

```text
配置收集者（qist、橘子柚） → 接口 / 插件规则 → 发布站或影视网站 → 媒体 CDN
公开接口清单（MoonTV）    → My TV 本地 HTTP 合集 → 接口发布站 → 媒体 CDN
网站页面 / 采集研究参考   → My TV 自有网站适配器 → 网站 → 上游线路 / 媒体 CDN
```

配置收集者、规则作者、网站运营者、媒体提供者可能是不同的人。收集仓库中有某条规则，不等于仓库作者写了它，也不等于拥有影片。本文的“发布站”只表示站点自称和其公开链接关系，未验证真实运营者或内容权利；代码仓库的许可证也不能代替外部内容授权。

## 当前配置从哪里来

| 菜单入口 | 实际来源 | 更新位置与方式 |
| --- | --- | --- |
| 全部（默认） | My TV 动态聚合内置与当前导入配置；不是新增的一套资源 | `lib/aggregate.mjs`、`lib/providers.mjs`；跟随各子配置读取，按完整来源参数去重 |
| 电视 | [qist/tvbox 的 jsm.json](https://github.com/qist/tvbox/blob/master/jsm.json) | [仓库 README](https://github.com/qist/tvbox#readme)、[文件提交记录](https://github.com/qist/tvbox/commits/master/jsm.json)。远程配置由上游维护 |
| 综合片库 | 本项目 `configs/library.json`，合并以下两个本地快照 | 同步修改两个子配置及综合片库；测试会检查一致性，不从 GitHub 自动覆盖本地文件 |
| 精选点播 | 本项目 `configs/selected.json`；21 个接口最初从 [MoonTV 公开列表](https://github.com/666zmy/moontv-v0/blob/main/config.json) 发现，再逐项抽样 | 原清单提供候选；接口迁移优先看下文发布站公告 / 帮助页，验证后手动更新 |
| 网页精选 | 本项目 `configs/websites.json`，4 个自有网站适配器 | 网站地址变化修改配置；页面 / 接口结构变化修改 `lib/websites/` 对应文件 |
| 橘子柚 | 原地址 `hackyjso/box/main/jzy.txt`；仓库现为 [hackyjso/TVbox](https://github.com/hackyjso/TVbox) | [当前文件](https://github.com/hackyjso/TVbox/blob/main/jzy.txt)、[提交记录](https://github.com/hackyjso/TVbox/commits/main/jzy.txt)。本次原地址和新地址均能由项目读取，暂保留原运行地址以兼容历史绑定 |

所有菜单地址定义在 `lib/configs.mjs`。本地合集包含同一批来源的不同视图，21 + 4 = 25 个，不应把「综合片库」与两个子合集重复计数。外部配置中出现相同品牌，也不能仅按名称认定接口、参数或线路相同。

### 能追到的仓库链路

| 引用 | 已确认的关系 | 本次定位的版本 |
| --- | --- | --- |
| qist/tvbox | README 明示 `jsm.json` 由 `js.json` 与 `0826.json` 组合；其中提及道长 drpy、Panda Groove、饭太硬。属于维护者的来源说明，未逐条证实规则原作者 | `b89d4dd2047d38b9ca0adddb26a2c07d3b103e6a`，2026-10-17；本次 HEAD 与 jsm 文件最后修改一致 |
| hackyjso/TVbox | `hackyjso/box` 重命名后的仓库；jzy 有 Base64 包装，项目已有解码支持；其 spider 指向 Gitee 上同一账号 TVbox 仓库 | jzy 文件最后修改 `e685ef1731c0dfc40195db2345d2a12dfe0f0628`，2024-06-06；不是整个仓库最后活跃时间 |
| 666zmy/moontv-v0 | GitHub 显示 fork 自 [marshu9999/moontv](https://github.com/marshu9999/moontv)；不能据此断言全部接口最早都来自父仓库 | config 文件最后修改 `91dde906835413606916d0f3409292b2ef11684a`，2025-08-13 |
| Silent1566/OmniBox-Spider | 网站能力研究参考；确认存在 HDmoli、金牌、乌云影视的采集文件，未找到同名 A123TV 文件 | HEAD `05098f037ce1babfb998057b9d04f30ee376c724`，2026-09-23 |
| [hjdhnx/dr_py](https://github.com/hjdhnx/dr_py) | 道长 drpy 的历史框架入口，当前已归档；可辅助理解规则体系，不代表当前每个 minified 文件或规则都能确切归属 | 本次只核对仓库归档及许可元数据，没有把它作为 My TV 新依赖 |
| [Hululu007/drpy-node](https://github.com/Hululu007/drpy-node) / [LibreTV 格式说明](https://github.com/LibreSpark/LibreTV/wiki/Data-Sources) | 分别为生态和通用 HTTP 配置格式参考；不能当作所有来源的原作者 | 未在运行时引入它们的框架 |

公开仓库页面未检测到许可的标为 `not_detected`，不代表获得任意复制许可；已识别许可证和引用角色见 JSON。My TV 的网站适配器在本仓库内实现，运行不依赖 OmniBox 仓库。

本项目接入记录可通过 `git show <commit>` 回溯：`12f889c` 首批 HTTP，`acc93f1` 三个网站，`f47c121` 扩充 HTTP 与综合片库，`1e9db7f` 乌云影视，`ce33fda` 默认「全部」。原始规则没有可靠署名的，在台账中保留 `originalAuthor: null`，不把托管账号填成原作者。

## 21 个 HTTP 来源的维护入口

下表为公开发布页或接口主机直接提供的维护线索。**1080 与虎牙尚未找到可独立确认的发布者 / 公告**；其它站点的自称也不代表已核实公司或个人身份。当前精确 API、备选地址及本次连接观测均在 JSON 中，域名变化只作为候选，不自动替换。

| key / 名称 | 当前接口 | 优先复查入口 | 注意事项 |
| --- | --- | --- | --- |
| `ikun` / ikun资源 | [API](https://ikunzyapi.com/api.php/provide/vod) | [入口1](https://ikunzyapi.com/) · [入口2](https://www.ikunzy.com/ikun/gonggao.html) | API 首页直接链接域名公告。 |
| `guangsu` / 光速资源 | [API](https://api.guangsuapi.com/api.php/provide/vod) | [入口1](https://www.guangsuzy.com/help/) | 接口帮助页公布当前配置中的 API；本次 API 根路径超时不能推断点播失效。 |
| `baofeng` / 暴风资源 | [API](https://bfzyapi.com/api.php/provide/vod) | [入口1](https://bfzy.tv/helps/) | 帮助页可访问；API 根路径本次 HTTP 500，须另外抽查实际 API。 |
| `modu` / 魔都资源 | [API](https://caiji.moduapi.cc/api.php/provide/vod) | [入口1](https://caiji.moduapi.cc/) · [入口2](https://caiji.moduapi.cc/caiji/) · [入口3](https://caiji.moduapi.cc/gonggao/) | API 首页另列 mdzyapi.com 接口；尚未作为域名更新采用。 |
| `1080` / 1080资源 | [API](https://api.1080zyku.com/inc/api_mac10.php) | [入口1](https://api.1080zyku.com/) | 只确认接口及公开列表引用，未找到可独立确认的原发布者或公告入口。 |
| `360` / 360资源 | [API](https://360zy.com/api.php/provide/vod) | [入口1](https://360zy.com/) · [入口2](https://360zy.com/360zy/gonggao.html) · [入口3](https://360zy.com/360zy/help.html) | 首页另列 360zyzz.com 接口；公告仍有原接口，替代地址尚未验证媒体播放。 |
| `uku` / U酷资源 | [API](https://api.ukuapi.com/api.php/provide/vod) | [入口1](https://www.ukuzy.com/) · [入口2](https://www.ukuzy.com/help/) | 原 API 根路径重定向至 api.ukuapi88.com；当前帮助页公布新域名。旧公告 /thff.txt 返回 404，先复查帮助页。 |
| `wujin` / 无尽资源 | [API](https://api.wujinapi.com/api.php/provide/vod) | [入口1](https://www.wujinzy.com/) · [入口2](http://help.wujinapi.me) | API 根路径 HTTP 403，发布站可访问；公告涉及媒体与封面域名变更。帮助站链接为发布站提供，未完整验证。 |
| `xinlang` / 新浪资源 | [API](https://api.xinlangapi.com/xinlangapi.php/provide/vod) | [入口1](https://www.xinlangzy.com/index.php/help/index.html) | 发布站帮助页列出当前 API。品牌名称不代表与新浪公司有已验证关联。 |
| `ruyi` / 如意资源 | [API](https://cj.rycjapi.com/api.php/provide/vod) | [入口1](https://www.ryzyw.com/help/) | 帮助页经网页工具可读取并列出当前 API；本机公网地址校验阻止了请求，不能据此判定站点失效。 |
| `zuida` / 最大资源 | [API](https://api.zuidapi.com/api.php/provide/vod) | [入口1](https://api.zuidapi.com/) · [入口2](https://zuidafile.com/help) | API 首页可访问并链接 zuidafile.com/help，但该帮助页本次连接失败；另一帮助链接不能证明与无尽属于同一维护者。 |
| `dytt` / 电影天堂 | [API](https://caiji.dyttzyapi.com/api.php/provide/vod) | [入口1](https://dyttzyw.tv/) | 发布站公告记录封面和媒体 CDN 迁移；应重新读取详情而非批量替换临时播放 URL。 |
| `baidu` / 百度云资源 | [API](https://api.apibdzy.com/api.php/provide/vod) | [入口1](https://api.apibdzy.com/) · [入口2](https://bdzy.tv/) | 发布站列出当前 API，并提醒封面链接可能变化；未验证与百度公司的关系。 |
| `hongniu` / 红牛资源 | [API](https://www.hongniuzy2.com/api.php/provide/vod) | [入口1](https://www.hongniuzy2.com/help/) · [入口2](https://www.hongniuzy.com/thff.html) | API 首页链接帮助及域名公告；公告为 GBK 页面，需正确解码。 |
| `huya` / 虎牙资源 | [API](https://www.huyaapi.com/api.php/provide/vod) | [入口1](https://www.huyaapi.com/) | API 根路径本次 HTTP 403；尚未确认独立的发布站、帮助页或原作者。品牌名称不代表虎牙公司。 |
| `haohua` / 豪华资源 | [API](https://hhzyapi.com/api.php/provide/vod) | [入口1](https://haohuazy.com/index.php/help/index.html) | 发布站帮助页列出 hhzyapi.com。 |
| `subo` / 速博资源 | [API](https://subocaiji.com/api.php/provide/vod) | [入口1](https://www.subozy.com/) | 发布站自称“速播”，当前 My TV 名称为“速博”；保留现有 key 和名称，不按同音推断其它镜像关系。 |
| `liangzi` / 量子资源 | [API](https://cj.lziapi.com/api.php/provide/vod) | [入口1](https://lzizy.net/help/) | 帮助页本机读取成功；另一网页工具曾返回 520，体现不同网络结果差异。 |
| `jinying` / 金鹰资源 | [API](https://jinyingzy.com/api.php/provide/vod) | [入口1](https://jinyingzy.com/index.php/help) · [入口2](https://jinyingzy.com/thff) | 发布站提供接口帮助与域名历史页。 |
| `feifan` / 非凡资源 | [API](https://cj.ffzyapi.com/api.php/provide/vod) | [入口1](https://cj.ffzyapi.com/help/) | API 主机提供独立帮助页。 |
| `jisu` / 极速资源 | [API](https://jszyapi.com/api.php/provide/vod) | [入口1](https://jisuzy.com/index.php/help/index.html) | 发布站帮助页列出 jszyapi.com；API 根路径本次超时不能推断实际播放失效。 |

需要优先复查的变化：

- **U酷**：本机配置仍为 `api.ukuapi.com`，其根页面重定向到 `api.ukuapi88.com`，当前[帮助页](https://www.ukuzy.com/help/)也公布后者。应验证新域名的分类、搜索、详情、媒体请求后再决定切换；不能仅凭根页重定向就认定全部旧 API 已失效。
- **360、魔都、如意**：发布页列出其它 API 域名，已记入 `alternativeEndpoints`。尚未作为已验证替代接入；也不要为了数量把镜像全部加成“独立来源”。
- **电影天堂、百度、无尽**：公告涉及封面或媒体域名变化。先重新读取 API 与影片详情，确认返回的地址是否仍旧；不要对历史记录批量替换 CDN，也不要保存短期播放凭证作为长期入口。

## 4 个网站来源

| key / 网站 | 当前入口 | 项目实现 | 研究参考与维护方式 |
| --- | --- | --- | --- |
| `hdmoli_web` / HDmoli | [hdmoli.me](https://www.hdmoli.me/) | `lib/websites/hdmoli.mjs` | OmniBox 的 HDmoli.js 是入口 / 能力研究参考；复查网站分类、搜索、详情与播放页。本次首页请求超时，未据此移除来源 |
| `a123tv_web` / A123TV | [a123tv.com](https://a123tv.com/) | `lib/websites/a123tv.mjs` | 根据网站公开页面适配；未找到可靠的第三方原作者引用。画质标注需结合实际视频尺寸判断 |
| `jinpai_web` / 金牌影视 | [m.jiabaide.cn](https://m.jiabaide.cn/) | `lib/websites/jinpai.mjs` | 本次重定向至 [www.jiabaide.cn](https://www.jiabaide.cn/)。OmniBox 金牌.js 为研究参考；只接公开访客线路，不以付费高清作为可用依据 |
| `wooyun_web` / 乌云影视 | [wooyun.tv](https://wooyun.tv/) | `lib/websites/wooyun.mjs` | OmniBox 乌云影视.js 为研究参考；复查网站入口、匿名接口、线路和同集对应关系 |

[OmniBox 参考目录](https://github.com/Silent1566/OmniBox-Spider/tree/05098f037ce1babfb998057b9d04f30ee376c724/影视/采集)固定了本次研究版本。网站无可靠代码仓库或域名公告时，只能标记“网站自身”为维护入口；第三方采集仓库提供线索，不能替代发布站声明或播放验证。

## 后续怎么更新

### 先定位故障层，避免误删

1. **配置读取失败**：看 HTTP 状态、最终地址、内容类型，确认是 JSON / 包装配置还是登录页、停放页；对照配置仓库提交、重命名与公告。
2. **配置可读，片源不可用**：确认类型和操作系统能力。Android JAR 不是改域名就能兼容；Windows 的 Python 限制也不是上游失效。插件规则、drpy 运行库、ext 引用分别检查，不能只看配置文件。
3. **接口有数据但搜索无结果**：换两个已知影片和类别，区分搜索关闭、关键词不匹配、分页、限流与协议变化。
4. **没有封面**：单独检查封面 URL、域名迁移、Referer、重定向和媒体类型；不能以封面失败判定影片不可播。
5. **有选集但不能播放**：检查详情返回的播放入口、解析、HLS 主 / 子清单、分片、必要请求头和实际解码；重新解析短期地址。网站包装线路不等于可直接播放的媒体。
6. **网络异常**：分别记录本机网络、已配置代理与其它工具的观测。根目录 403 / 500 / 超时不等于实际 API 请求失败；公网地址校验拒绝也可能与本地 DNS / 代理有关，不应为通过检查关闭安全限制。

### 建议检查频率

- **每周轻量复查（建议，未创建任务）**：读台账和上次报告；看两个配置仓库的文件提交、发布站公告与已知域名迁移。需要时小范围请求 API 分类 / 搜索，不执行新规则、不自动修改配置。
- **每月或出现故障后播放抽样**：运行下列现有工具，选电影、剧集、动漫样本，验证同集线路、封面和少量媒体；有条件在浏览器确认解码、画质和续播。
- 单次超时先重试并换时间 / 网络复核。持续失败、原地址内容改变或发布者明确公告迁移后，再准备具体变更；不要把一次探测失败自动当成永久下线。

```sh
# 离线检查台账是否覆盖全部本地片源、菜单入口；不访问远程站点
node --test test/source-origins.test.mjs

# 在线：内置 HTTP 来源，分类、搜索、详情、HLS 清单及少量分片
npm run probe:sources -- 流浪地球2 庆余年第二季 仙逆

# 在线：4 个网站适配器；可以用 --source=A123TV 限定单站
npm run probe:websites

# 在线：先把公告中的新接口写入独立候选文件，验证后再考虑接入
npm run probe:candidates -- candidates.json test-results/candidates.json 流浪地球2 仙逆
```

在线工具不在启动或 CI 中自动执行。它们的结果是样本观测，不是每部影片和整站清晰度保证；指定关键词未找到也可能被报告失败。`probe:sources`、`probe:websites` 输出到终端，可由维护任务保存到忽略的 `test-results/`；`probe:candidates` 写指定结果文件。请勿把临时媒体地址、Cookie、Token 或真实历史数据库提交到仓库。

### 确认更新时的提交清单

- 保留稳定的源 key；同步 `configs/selected.json` / `configs/websites.json` 与 `configs/library.json`，以及本台账。改 key 或原配置 URL 会影响历史入口匹配，应单独评估迁移。
- 网站结构变化修改对应适配器，补充针对真实变化的回归样本。更新插件前先核对来源和代码差异，不把陌生规则直接在宿主 Node / Python 中运行。
- 域名迁移先用候选探测，再确认播放、海报、历史续播和同源 / 公网校验。保留现有 TLS、请求大小、超时与脚本隔离限制。
- 播放抽样通过后才更新配置里的 `checkedAt`。只改文档 / 元数据不能冒充重新实播通过。
- 更新本台账的审阅日期和引用版本；新建带日期的外部配置快照，保留旧证据。检查测试通过后人工审阅差异，不自动批量覆盖运行配置。

### 可供以后定时任务使用的说明

下面只是任务模板，当前没有启用：

> 在 My TV 项目中读取 docs/SOURCE-PROVENANCE.md 和 docs/source-origins.json，并对照上次维护报告。检查配置仓库文件变动、发布站公告、域名变化及已报告失败的来源。只做有超时和大小限制的只读请求，不下载完整影片，不执行新下载的插件，不修改运行配置、安全限制或观看历史。将结论与证据保存在 test-results/ 带日期的报告中，区分配置、接口、封面、媒体和本地网络问题，标明未验证事项。发现变化或持续故障时才通知，提供可人工复查的具体替代方案；无变化保持安静。需要修改时提交独立建议，等待明确的变更指令。

完整台账能帮助找到更新，但不能保证外部站点长期存在。对于追不到原作者、已无公告或无人维护的条目，保留不确定性比猜测归属更有用。
