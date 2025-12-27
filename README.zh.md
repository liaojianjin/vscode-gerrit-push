# Gerrit Push Button

在 VS Code 源代码管理中添加一个按钮，一键将 `HEAD` 推送到 Gerrit 的 `refs/for/<branch>` 进行评审。

> English version: see `README.en.md`.

## 功能
- Source Control 标题栏按钮 + 命令面板命令：**Gerrit: Push HEAD to Gerrit**
- 执行 `git push <remote> HEAD:refs/for/<branch>`，提供分支选择器
- 默认使用当前分支，可通过 `gerritPush.defaultBranch` 覆盖
- 默认远端为 `origin`，可通过 `gerritPush.remote` 设定

![snipshot](images/snipshot.png)

## 安装/调试
1) 在该目录执行：
```bash
npm install
```
2) 用 VS Code 打开 `vscode-gerrit-push` 目录。
3) 打开左侧 “Run and Debug” 面板，选择 `Run Extension` 配置并点击 “Run”（或按 F5）。这会启动 Extension Development Host，自动编译并加载插件。

## 使用
1) 打开一个 Git 工作区。
2) 在 Source Control 视图标题栏点击图标按钮 **Push HEAD to Gerrit**，或在命令面板运行同名命令。
3) 选择目标分支（当前分支、配置默认分支或自定义输入）。
4) 确认弹窗 `git push <remote> HEAD:refs/for/<branch>`。
5) 插件通过 VS Code 的 Git SCM（失败时回退 `git rev-parse`）解析仓库根目录，避免多仓库场景下推错路径。

## 设置
- `gerritPush.defaultBranch`：推送到 `refs/for/<branch>` 的默认分支，留空则使用当前分支。
- `gerritPush.remote`：推送使用的 Git 远端名，默认 `origin`。

## 打包分发
1) 安装依赖（首次或更新时）：
```bash
npm install
```
2) 打包 VSIX：
```bash
npm run package
```
生成的 `.vsix` 可分发给其他用户，在 VS Code 扩展面板右上角菜单选择 “Install from VSIX...” 安装。

## 元信息
- 图标与图片由 Nano Banana Pro 生成（`images/icon.png`、`images/command-icon.png`）
- 仓库：<https://github.com/liaojianjin/vscode-gerrit-push>
- 许可证：MIT（见 `LICENSE`）
