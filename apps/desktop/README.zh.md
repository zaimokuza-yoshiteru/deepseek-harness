# DSH Desktop

[English](README.md) | 中文

本 fork 分发 Electron 应用，内置 DSH `0.1.5-rc.2`、`@zaimokuza/dsh-acp-adapter` `0.1.5-rc.2.1`、原版 Node.js `24.17.0`、pnpm `11.23.0` 和离线安装 seed。使用者无需单独安装 DSH、Node.js、npm 或 pnpm。ACP agent 可执行程序需要另外配置，不包含在应用中。

## 下载与打开

从 fork 的 GitHub Release 附件下载应用 ZIP。GitHub 自动生成的源码压缩包包含源码，不是应用。完整解压 ZIP 后，在 macOS Apple Silicon 上打开 `DSH Desktop.app`，或在 Windows x64 上打开 `DSH Desktop.exe`。Windows 可执行文件必须和附带文件保留在一起。不分发 Intel Mac 版本。

Mac 应用采用 ad-hoc 签名，未经 Apple 公证；Windows 应用未签名。首次打开可能需要操作系统或公司应用策略批准，这些包不保证免提示启动。

两个应用都采用仓库 Web favicon 中的 DeepSeek 鲸鱼，显示为白色圆角底上的蓝色图案。[桌面 SVG](assets/icon.svg) 用于生成已提交的 [macOS ICNS](assets/icon.icns) 和 [Windows ICO](assets/icon.ico)，转换工具为已修复的 `icons@1.2.3`。打包直接使用这些文件；Finder 小尺寸图标采用 ARGB 编码。Windows 写入图标与版本信息，同时保持代码签名关闭。[图标完整性记录](assets/icon-integrity.json) 固定源码、生成文件和工具压缩包；修改 SVG 时需要重新生成两种原生文件并更新记录。

首次启动会将内置 seed 离线安装到独立的可写 profile，并验证后端可以启动。尚无桌面 store 时直接采用已解压的 store；升级时合并到已有 store，保留下载过的插件。模型请求和所配置的 ACP agent 仍可能需要网络。桌面端不运行自动更新；更新时关闭应用，再用新版本 ZIP 替换应用。

## 数据与插件

Agent Teams 默认启用，使用官方[后端层](../../packages/experimental/agent-team-profile/README.zh.md)和[Web 界面层](../../packages/experimental/agent-team-web-profile/README.zh.md)。macOS 按 `Cmd+,`、Windows 按 `Ctrl+,` 打开**桌面插件**，然后通过**内置功能 → Agent Teams** 同时切换两层。切换会重启后端并刷新主窗口；请先等待正在运行的任务和请求结束。设置在应用重启和升级后保留。依赖始终保留，因此重新开启无需联网。会话与 Teams 数据不会删除。ACP adapter 和用户安装的插件仍显示在已安装列表中。没有保存过选择的 profile 默认启用。Teams 仍属实验性功能；上游 Web 层说明了与 preset 内旧子代理控制项并存的限制。

应用升级时，内置插件采用新 seed 携带的版本，旧 ACP adapter 不会覆盖新内置版本。其他已安装插件保留精确版本并继续启用。暂存后端必须通过启动检查，替换才会生效。

原生**编辑**菜单为当前窗口提供标准编辑快捷键，适用于聊天输入区和插件管理器输入框。macOS 使用 `Cmd+A/C/V/X` 全选、复制、粘贴或剪切，使用 `Cmd+Z` 撤销、`Cmd+Shift+Z` 重做。

macOS 的默认数据根目录为 `~/.dsh-desktop`，Windows 为 `%USERPROFILE%\.dsh-desktop`。该目录下的 `profiles/desktop` 存放桌面 profile，`desktop/pnpm` 存放包管理状态，`electron-user-data` 存放 Electron 状态。显式设置 `DSH_HOME` 可以覆盖根目录。应用不导入已有 Web profile。遥测默认设置为 `DSH_TELEMETRY_MODE=DISABLED`，显式启动配置可以覆盖。

从应用菜单打开插件管理器，或按 `Cmd+,` / `Ctrl+,`，可以按 npm 包名安装插件、更新到指定版本或卸载。它是已安装插件管理器，不提供市场搜索。适配器预装并显示在列表中。第三方插件必须兼容桌面 host。

后端运行在内置的原版 Node.js 进程中。`dsh-app://` 与带帧字节管道承载前端资源、Fetch 请求及流式响应，桌面端不监听 Web 端口。包变更通过暂存 profile、后端健康检查、激活日志与回滚完成。即使 DSH 依赖版本不变，桌面构建序号变化也会重新应用内置后端。

### 在桌面窗口安装插件

1. 打开打包后的应用，等待主窗口出现。源码开发启动方式会禁用包变更。
2. macOS 按 `Cmd+,`，Windows 按 `Ctrl+,`，打开独立的**桌面插件**窗口。它与主窗口设置中的插件配置页不同。
3. 在 **npm 包**输入框填写完整的 npm 包名和版本。验证主题库时，准确输入：

```text
@zaimokuza/dsh-theme-library@0.2.1
```

4. 点击**安装**，等待操作完成。桌面端使用内置 pnpm、读取你的 npm 配置、检查暂存后端，激活成功后重新加载主窗口。输入框中不要填写 GitHub Release 链接、`npm install` 或其他命令。
5. 确认**已安装**列表出现对应包名和版本。点击**更新**可填写目标版本，点击**移除**可卸载该插件。安装错误会显示在窗口中，事务失败会保留原有的活动 profile。

在桌面 `0.1.5-alpha.2` 基线上的主题库 `0.2.1` 实测确认了 registry 安装、后端重启、已安装包清单，以及**设置 → 通用设置**中的主题选择器。它的动态背景尚不兼容此桌面 host：插件通过 `webServer` 提供图片，但桌面组合禁用了该服务。图片请求收到的是前端 HTML 回退页面，而不是图片字节。因此安装成功不代表该版本的视觉效果可用。主题插件仅作为手动验证示例，不包含在分发 seed 中。

升级时若保留了用户额外安装的插件，会优先使用本地缓存，缺少依赖元数据时可能访问已配置的 registry。仅使用内置组件的安装仍可离线完成。

## npm registry 与 TLS 配置

桌面端把用户配置文件交给内置 pnpm。默认读取 `~/.npmrc`，Windows 为 `%USERPROFILE%\.npmrc`；`NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` 可以指定其他文件。npm 配置环境变量覆盖文件值，同时存在大小写形式时小写优先。整个过程不调用系统 npm。配置文件只读取，不修改，也不打包到应用中。

用户 `.npmrc` 示例：

```ini
registry=https://nexus.example/repository/npm-group/
strict-ssl=false
@company:registry=https://nexus.example/repository/npm-private/
```

`strict-ssl=false` 仅关闭包管理请求的证书校验。有公司 CA 时优先使用 `cafile=/absolute/path/company-ca.pem` 并保持校验开启。认证与 scoped registry 使用 pnpm 的 npmrc 处理逻辑，凭据保存在使用者本地配置。Finder 双击启动建议使用文件配置，因为应用不一定继承终端 export 的变量。

桌面端仍独立管理 store、项目布局与安装事务。不会导入用户代码工作区里的项目 `.npmrc`，因为插件操作在桌面 profile 中执行。未覆盖 registry 时使用 pnpm 的公网默认值。模型 API、ACP 子进程及桌面 Web 请求不继承 npm 的 `strict-ssl`。构建时准备 seed 也读取相同的 npm 配置，但 Electron 和 Node.js 二进制下载使用各自的下载机制。

## 构建与发布

在对应平台的原生系统中，从 `desktop` 分支构建，构建机需要安装仓库要求的 Node 与 pnpm：

```sh
pnpm install --frozen-lockfile
# macOS Apple Silicon
pnpm --dir apps/desktop run package:portable:mac:arm64
# Windows x64
pnpm --dir apps/desktop run package:portable:win:x64
```

输出 ZIP 位于 `apps/desktop/.desktop-build/targets/<mac-arm64|win-x64>/artifacts`。本地构建默认桌面版本为 `0.1.5-rc.2.2`，设置 `DSH_DESKTOP_DISTRIBUTION_VERSION` 可以选择其他正整数构建序号。DSH 与适配器依赖始终保留精确基线版本。seed 准备阶段校验适配器 npm 包的完整性。seed 包含依赖字节、锁文件、本地核心包、许可证和完整性清单；打包前会验证离线安装。

先推送分支，再对已检查的提交打 tag：

```sh
git switch desktop
git push -u origin desktop
git tag 0.1.5-rc.2.2
git push origin 0.1.5-rc.2.2
```

`Desktop portable` 工作流验证 tag 提交属于 `origin/desktop`，分别构建 macOS arm64 与 Windows x64，运行打包后端的离线冒烟检查，并把两个 ZIP 和 `SHA256SUMS.txt` 附到 GitHub prerelease。后续桌面修订依次使用 `.2`、`.3`。该工作流不发布 npm 包。分支推送和手动触发工作流仅上传 Actions artifacts。工作流成功完成前，tag 本身不包含应用二进制。

portable 命令不使用 Developer ID、Apple 公证、Windows EV Token 或上游 COS 更新服务。原有签名打包命令仍供另行配置的部署使用，要求见[上游打包决策](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)。

## 验证

定向测试覆盖真实 npmrc registry/TLS 请求、环境变量优先级、独立数据目录、构建序号、插件事务和目标选择。`pnpm exec tsx apps/desktop/scripts/smoke-portable.ts mac-arm64`（或 `win-x64`）使用全新的临时数据目录与不可达 registry 启动打包后端，检查前端资源并验证已安装适配器的精确版本。它不测试真实模型或 ACP agent。[fork 分发决策](../../.agents/notes/implemented/architecture/2026-09-10-desktop-portable-distribution.zh.md)记录了取舍。

诊断时可以在该冒烟命令后追加应用 ZIP 路径，或在 Actions 中运行 **Desktop portable smoke replay**，填写原构建的 run ID 与平台。ZIP 会解压到临时目录。失败构建会保留已完成的 ZIP 用于诊断，分发前仍须确认完整构建与冒烟检查通过。重跑使用所选源码版本的测试驱动和下载应用中的资源，因此产品改动仍需重新完整构建后才能交付。
