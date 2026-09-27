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

## 当前进度

- 阶段 0：项目骨架（透明置顶空窗口）
- 阶段 1：桌宠本体（显示、待机动画、拖拽抛出、摸头摸尾巴、随机走动、全局快捷键、托盘菜单）

## 项目结构

```
whale-pet/
├─ assets/whale/         # 素材 submodule（含原始 LICENSE）
├─ src/
│  ├─ main/              # Electron 主进程：窗口、托盘、快捷键、IPC、本地配置
│  ├─ renderer/          # 桌宠渲染、动画状态机、点击穿透、拖拽物理
│  └─ shared/            # 主进程和渲染进程共用的类型定义
├─ scripts/              # 构建辅助脚本
├─ persona/              # 人设文件（阶段 2 起使用）
└─ SPEC.md               # 完整需求说明
```
