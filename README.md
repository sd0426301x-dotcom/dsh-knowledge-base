# DSH 工作区知识库

把本地工作区里的项目、文档、插件和素材整理成一个可搜索、可编辑的知识库，挂在 DSH 的侧边栏里。

- **本地优先**：数据只写在工作区的 `.knowledge-base/entries.json`，不上传。
- **自动归类**：新建条目默认自动分类；路径指向新文件夹时用文件夹名建分类，没有匹配时按标题关键词或短标题建分类。
- **插件自动收录**：`工作区/插件/<名字>` 或 `工作区/plugins/<名字>` 下的插件会自动变成卡片，归到「插件与开发」。
- **可修改**：条目、分类、笔记都能在面板里新建/编辑/重命名/删除。
- **打开即扫描**：每次打开知识库都会重新扫描工作区，新项目/新插件会出现。

## 隐私

- 不联网、不上传、没有遥测，也不需要任何 API Key。
- 只读取你选择的工作区；数据留在本机。
- 详见 [PRIVACY.md](PRIVACY.md)。

## 环境

- Windows 10/11
- DSH Desktop（开发和验证版本：0.2.1-rc.2 系列）
- Node.js（只有安装脚本需要；DSH 自带运行时通常可用）

## 安装

1. 把仓库克隆到本机任意目录，例如：

   ```powershell
   git clone https://github.com/sd0426301x-dotcom/dsh-knowledge-base.git D:\tools\dsh-knowledge-base
   ```

   也可以从仓库页面 **Code → Download ZIP**，或从 [Releases](https://github.com/sd0426301x-dotcom/dsh-knowledge-base/releases) 下载 ZIP 解压。

2. 在解压/克隆目录运行安装脚本：

   ```powershell
   node tools/install.mjs
   ```

   脚本会：
   - 在 DSH profile 的 `node_modules` 里建立指向本仓库的链接；
   - 如果 profile 还没有把这个包列为 bundle，就往 `cordis.patch.yml` 追加一行加载配置。

3. **完全退出 DSH Desktop 再打开**（不是 Ctrl+R）。Host 半边在进程启动时加载，重启后侧边栏才会出现「知识库」。

> **不要运行 `dsh plugin add dsh-knowledge-base`。** npm 上的 `dsh-knowledge-base` 是另一个“文档知识库”插件，会出现在对话页签里；本项目的包名是 `dsh-workspace-kb`，只按上面的方式从本仓库安装。

4. 打开后，左侧栏「插件」下面会有一行书本图标 +「知识库」。如果侧边栏收起，左侧中间会有一个书签小标签，展开侧边栏即可看到正常行。

### 安装脚本找不到 profile

默认读取：

- `%DSH_HOME%\profiles\desktop`，或
- 环境变量 `DSH_PROFILE_DIR` 指定的 profile 目录。

如果 DSH 装在别的 profile，先在 PowerShell 里设置：

```powershell
$env:DSH_PROFILE_DIR = "C:\Users\<你>\.dsh\profiles\desktop"
node tools/install.mjs
```

### 检查安装状态

```powershell
node tools/install.mjs --status
```

### 卸载

```powershell
node tools/install.mjs --uninstall
```

如果这个包是通过 DSH 插件管理器以 bundle 方式启用的，卸载后还要在插件管理器里停用它，或从 profile 的 `dsh.profile.bundles` 里移除。

## 用起来

- **新建**：右上角「＋ 新建」，只填标题也能保存；分类默认自动。
- **自动分类**：
  - 路径填 `工作区/新项目`：用「新项目」自动建分类；
  - 没有路径：按标题/说明关键词归类；
  - 还没有匹配：按短标题建分类（例如「量子计算」）。
- **分类管理**：左侧分类栏底部「＋ 新建分类」；选中分类后顶部有「重命名分类」；自建分类可删除（分类里还有条目时不能删）。
- **打开文件**：核心文件里的 Markdown/源码/JSON 可直接预览，图片可直接看。
- **刷新**：每次打开知识库会自动重扫；也可以点右上角刷新。

## 工作区根目录

默认使用当前 DSH 工作区（`workingDirectory.defaultDirectory`）。如果取不到，或你想固定一个目录：

```powershell
$env:DSH_KB_ROOT = "D:\your-workspace"
```

或在插件行配置：

```yaml
- id: knowledge-base
  config:
    root: 'D:\your-workspace'
```

然后重启 DSH。

## 数据在哪

- 索引、分类、笔记：`<工作区>\.knowledge-base\entries.json`
- 原项目/文档/图片：留在原处，不会被移动或改写。
- 想备份知识库数据：单独备份 `.knowledge-base/entries.json`；它默认被 `.gitignore` 忽略。

## 插件自动收录

把插件源码放在：

```
<工作区>\插件\<插件名>\
<工作区>\plugins\<插件名>\
```

打开知识库时会自动生成一张卡，标题/说明优先读 `README`，其次读 `package.json`。只有源码在工作区里的插件会被收录；只装进 DSH profile 的插件不会自动出现。

## 已知限制

- 侧边栏入口是通过页面脚本注入 + 复用 DSH 侧栏的 DOM 行实现的，**绑定当前 DSH Desktop 的侧栏结构**；其他 DSH 版本可能需要适配。
- 目前只验证了 Windows + DSH Desktop；Linux/macOS 未验证。
- Host 代码改动后需要重启 DSH；只有 UI 改动时刷新页面即可。
- 不是云同步工具，也不是完整的笔记软件；它更像“工作区知识索引 + 轻量笔记”。
- 当前没有后台文件监听；打开或点刷新时才重新扫描。

## License

MIT，见 [LICENSE](LICENSE)。
