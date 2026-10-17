# 安装与更新

普通用户始终从 [最新正式版本](https://github.com/AprilCaptain/mytv/releases/latest) 下载对应系统的 `My-TV-macOS.zip` 或 `My-TV-Windows.zip`。Release 中的 Source code 是源码归档，不含可执行启动器。首次使用需自行安装兼容 Node.js / Python，项目依赖会自动补齐。

## 保留观看历史更新

1. 退出旧启动器，等待服务停止、端口释放。其他设备也会暂时无法访问。
2. 下载完整新版 ZIP，解压到一个**新文件夹**，先不要启动新版。
3. 把旧项目里的整个 `data` 文件夹复制到新版项目根目录，保留旧目录作为备份。
4. 打开新版 `My TV.app` / `My TV.exe`。启动器重新检查环境、补齐依赖，读取原来的历史记录。确认可用后再自行整理旧目录。

不要在服务运行中复制数据库，也不要同时启动两份版本。若新版已生成自己的 `data`，先将该目录改名备份，再复制完整旧 `data`；不要混合数据库、WAL 和 SHM 文件。

只迁移 `data`，不要搬移 `.venv` 或 `node_modules`。Python 虚拟环境包含原目录的绝对路径，新版会在新目录重新准备项目依赖；不会自动安装 Node.js 或 Python。自定义修改过源码或配置文件的用户，另行备份自己的修改。

启动器的「检查更新」会显示当前版本、新版本及说明，并打开 GitHub 发布页。它不自动覆盖文件，也不会清空历史。检查功能使用系统自带 curl；若系统工具缺失、GitHub 网络受限或 API 限流，可直接访问发布页下载。

## 使用 Git 的开发者

停止服务后执行 `git pull --ff-only`，再用启动器启动。`data`、`.runtime`、`.venv` 和 `node_modules` 均不受 Git 更新覆盖；启动器会按锁文件检查依赖。若原生窗口源码有变化，在对应系统执行 `npm run build:launcher` 重建本机启动器，或使用 Release 中的成品。

## 维护者发布新版本

完成代码修改、测试并提交到 `main` 后，在干净的工作目录中执行：

```sh
npm version patch
# 例如从 0.4.0 升到 0.4.1；minor / major 可发布更大的功能版本。
git push origin main --follow-tags
```

`npm version` 会更新 `package.json` 与锁文件、生成版本提交和 `vX.Y.Z` 标签。可在发布前补充 `docs/releases/vX.Y.Z.md`，并随功能提交一起提交；没有该文件时使用通用说明。

GitHub Actions 在两个系统上准备依赖、运行测试、构建和自检启动器；只有两边都成功才创建 Release 草稿、上传两个完整 ZIP 包，并发布为最新版本。发布失败时保留草稿供排查，上传尚未完成的版本不会出现在更新检查中。已公开的版本不覆盖，请使用新版本号。

普通 `git push` 只更新源码与开发构建，不会发布正式版，也不会通知其他电脑更新。首次发布使用 `v0.4.0`。发布流程使用仓库内的 `GITHUB_TOKEN`，无需另存个人令牌。
