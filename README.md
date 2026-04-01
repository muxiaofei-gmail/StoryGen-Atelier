# StoryGen-Atelier

AI 驱动的儿童科普视频自动生成工具。输入一个选题，自动生成分镜脚本、配图、配音，最终合成完整视频。

## 功能特性

- **智能脚本生成**：基于通义千问 API，自动生成适合 6-10 岁儿童的科普分镜脚本
- **AI 图片生成**：使用 SiliconFlow API 生成 2D 卡通风格的分镜图片
- **视频片段生成**：使用 SiliconFlow Wan2.2 模型将图片转换为动态视频
- **自动配音**：使用 Edge TTS（免费）为每个场景生成配音
- **音频居中填充**：自动为音频添加前后静音，使配音居中播放
- **进度跟踪**：实时显示视频生成进度，支持失败场景重试
- **项目恢复**：页面刷新后可恢复未完成的项目
- **分镜数量选择**：支持手动指定或 AI 自动判断分镜数量

## 技术栈

- **前端**：React + Vite + Mantine UI
- **后端**：Node.js + Express + SQLite (better-sqlite3)
- **AI 服务**：
  - 通义千问（脚本生成）
  - SiliconFlow Qwen-Image（图片生成）
  - SiliconFlow Wan2.2-I2V（视频生成）
- **配音**：Edge TTS（免费，无需 API Key）
- **视频处理**：FFmpeg

## 目录结构

```
StoryGen-Atelier/
├── backend/                # Node.js 后端服务
│   ├── src/
│   │   ├── controllers/    # 控制器
│   │   ├── routes/         # 路由
│   │   ├── services/       # 服务层
│   │   └── utils/          # 工具函数
│   ├── data/               # 数据存储（自动创建）
│   │   ├── audio/          # 生成的音频
│   │   ├── images/         # 生成的图片
│   │   └── videos/         # 生成的视频
│   └── .env                # 环境变量配置
├── frontend/               # React 前端
│   └── src/
│       ├── App.jsx         # 主应用组件
│       └── api.js          # API 调用
└── README.md
```

## 环境要求

- Node.js 18+
- npm 或 yarn
- FFmpeg（视频处理）

## 安装与配置

### 1. 克隆仓库

```bash
git clone https://github.com/muxiaofei-gmail/StoryGen-Atelier.git
cd StoryGen-Atelier
```

### 2. 安装依赖

```bash
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

### 3. 配置环境变量

在 `backend/` 目录下创建 `.env` 文件：

```env
# 服务端口
PORT=3005

# 通义千问 API（脚本生成）
TONGYI_API_KEY=your_tongyi_api_key
TONGYI_MODEL=qwen-plus

# SiliconFlow API（图片/视频生成）
SILICONFLOW_API_KEY=your_siliconflow_api_key
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_IMAGE_MODEL=Qwen/Qwen-Image
SILICONFLOW_VIDEO_MODEL=Wan-AI/Wan2.2-I2V-A14B
```

### 4. 启动服务

```bash
# 启动后端服务（在 backend 目录）
cd backend
npm run dev
# 或
node src/app.js

# 启动前端服务（在 frontend 目录，新终端）
cd frontend
npm run dev
```

- 后端地址：http://localhost:3005
- 前端地址：http://localhost:5180

## 使用指南

1. **输入选题**：在首页输入一个科普选题，如"为什么天空是蓝色的？"
2. **生成脚本**：点击"生成脚本"，AI 会自动生成分镜脚本
3. **生成分镜**：确认脚本后，点击"生成分镜"生成配图
4. **生成视频**：点击"开始生成视频"，系统会自动：
   - 为每个场景生成配音
   - 将图片转换为视频片段
   - 合成最终视频
5. **下载视频**：生成完成后可下载或预览视频

## 主要功能说明

### 进度跟踪

视频生成过程中，前端会实时显示：
- 当前正在生成的场景
- 成功/失败的场景数量
- 整体进度百分比

### 失败重试

如果部分场景生成失败：
- 会显示失败场景列表
- 可单独重试失败的场景
- 重试成功后可重新合成视频

### 项目恢复

如果页面刷新或意外关闭：
- 重新打开页面会检测未完成的项目
- 点击"恢复项目"可继续之前的进度

### 音频居中填充

当音频时长短于视频时长时：
- 自动在音频前后添加静音
- 使配音在视频中间播放
- 示例：视频 5 秒，音频 3 秒 → 前 1 秒静音 + 3 秒音频 + 1 秒静音

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/storyboard/generate` | POST | 生成分镜脚本和图片 |
| `/api/video/start` | POST | 开始生成视频 |
| `/api/video/status/:taskId` | GET | 获取视频生成进度 |
| `/api/video/retry` | POST | 重试失败的场景 |
| `/api/video/recompose` | POST | 重新合成视频 |
| `/api/project/active` | GET | 获取当前活跃项目 |

## 常见问题

### Q: 视频生成失败怎么办？
A: 检查 API Key 是否正确，查看后端日志 `backend.log` 获取详细错误信息。

### Q: 图片风格不一致怎么办？
A: 当前版本通过 prompt 约束风格，但由于 AI 生成的随机性，无法 100% 保证一致性。后续版本会考虑支持风格参考功能。

### Q: 支持哪些配音语言？
A: 当前支持中文配音，使用 Edge TTS 的中文语音模型。

## 许可证

MIT License

## 致谢

- [通义千问](https://tongyi.aliyun.com/) - 脚本生成
- [SiliconFlow](https://siliconflow.cn/) - 图片/视频生成
- [Edge TTS](https://github.com/rany2/edge-tts) - 语音合成
- [Mantine UI](https://mantine.dev/) - UI 组件库