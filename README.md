# 鲸鱼娘桌宠（whale-pet）

运行在 Windows 10/11 上的 AI 桌面宠物，非官方同人项目，与 DeepSeek 官方无关，仅供个人使用。

详细需求见 [SPEC.md](SPEC.md)。

## 素材与授权

角色立绘素材来自 [Sutera-Diffusus/dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)（MIT License，版权方 Sutera-Diffusus），以 git submodule 形式引入到 `assets/whale/`，原始 `LICENSE` 文件随 submodule 一并保留。

本仓库自身的代码同样以引用该素材仓库的方式使用，不修改、不重新分发素材文件本身。

## 开发环境

- Node.js（LTS）、npm
- Windows 10/11（部分功能，如窗口标题读取、全局按键监听，依赖 Windows API）

## 首次拉取代码

```bash
git clone --recurse-submodules <this-repo-url>
# 如果 clone 时忘了 --recurse-submodules：
git submodule update --init --recursive
```

## 安装依赖 / 运行

```bash
npm install
npm start
```

`npm start` 会先用 `tsc` 编译 TypeScript、把渲染进程用到的静态文件复制到 `dist/`，再启动 Electron。

## 首次使用：填 API Key

阶段 2 起需要接 DeepSeek（或其他 OpenAI 兼容服务）才能聊天。托盘图标右键 → 设置，或者在桌宠身上右键 → 设置，填 API Key、Base URL（默认 `https://api.deepseek.com`）、模型名（默认 `deepseek-chat`）。Key 用 Electron `safeStorage` 加密存在本机，不会进代码库或日志。

人设文件在设置里点"打开人设文件"就能编辑，改完直接保存生效，不用重启、不用点"重新加载"。首次启动会自动把 `persona/default.md` 复制一份到用户数据目录，以后改的是那份复制出来的，不会因为代码更新被覆盖。

## 当前进度

- 阶段 0：项目骨架（透明置顶空窗口）
- 阶段 1：桌宠本体（显示、待机动画、拖拽抛出、摸头摸尾巴、随机走动、扒边缘探头、全局快捷键、托盘菜单、桌宠右键菜单）
- 阶段 2：聊天与人设（DeepSeek/OpenAI 兼容 provider、聊天面板、人设文件、设置界面）

## 项目结构

```
whale-pet/
├─ assets/whale/         # 素材 submodule（含原始 LICENSE）
├─ src/
│  ├─ main/              # Electron 主进程：窗口、托盘、快捷键、IPC、本地配置、
│  │                      #   聊天会话、人设、API Key 加密存储
│  ├─ renderer/           # 桌宠渲染、动画状态机、点击穿透、拖拽物理、
│  │                      #   右键菜单/聊天面板/设置界面/气泡的页面内容
│  ├─ core/providers/     # ChatProvider 接口 + OpenAI 兼容实现（预留 Anthropic）
│  └─ shared/             # 主进程和渲染进程共用的类型定义
├─ scripts/              # 构建辅助脚本
├─ persona/              # 默认人设文件（首次启动会复制到用户数据目录）
└─ SPEC.md               # 完整需求说明
```
