# 代码评估平台

基于LlamaIndex和豆包API的项目代码智能评估系统。该系统能够获取GitHub仓库代码，使用LlamaIndex处理后通过豆包API进行智能评估，为开发者提供代码质量、功能实现、可维护性和安全性的专业评估。

## 主要功能

- **GitHub代码获取**：自动获取完整仓库代码，支持缓存
- **LlamaIndex处理**：分析项目结构，提取关键文件
- **豆包API评估**：专业代码质量评估，提供改进建议
- **可视化界面**：直观展示评估结果和建议
- **API接口**：支持外部系统集成

## 技术栈

- **前端**：Next.js 15, React 19, TailwindCSS
- **后端**：Next.js API Routes
- **数据存储**：Firebase Firestore
- **核心服务**：
  - LlamaIndex - 代码分析
  - 豆包API - AI评估
  - GitHub API - 代码获取
- **缓存**：Node-Cache

## 快速开始

### 环境要求

- Node.js 18+
- 必要环境变量（见下文）

### 安装依赖

```bash
npm install
```

### 配置环境变量

在项目根目录创建 `.env.local` 文件，添加以下环境变量：

```
# Firebase配置
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-domain.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_FIREBASE_DATABASE_PREFIX=your_prefix

# Firebase Admin SDK配置
FIREBASE_CLIENT_EMAIL=your-client-email@example.com
FIREBASE_PRIVATE_KEY="your-private-key"

# GitHub Token
GITHUB_TOKEN=your-github-token

# 豆包API密钥
DOUBAO_API_KEY=your-doubao-api-key

# Google Gemini API密钥
GEMINI_API_KEY=your-gemini-api-key
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000 查看应用。

## API文档

### 评估代码

POST `/api/evaluate`

请求体格式：

```json
{
  "projectDetail": "项目详情描述",
  "subtasks": ["子任务1", "子任务2", "子任务3"],
  "currentTask": "当前任务描述",
  "githubRepoUrl": "https://github.com/username/repo",
  "youtubeLink": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

响应示例：

```json
{
  "success": true,
  "message": "评估请求已接收，正在处理中",
  "evaluationId": "uuid-evaluation-id",
  "status": "pending"
}
```

### 查询评估状态

GET `/api/status/{evaluationId}`

响应示例（处理中）：

```json
{
  "success": true,
  "evaluation": {
    "id": "uuid-evaluation-id",
    "status": "processing_repo",
    "statusMessage": "正在获取GitHub仓库代码",
    "createdAt": "2023-05-01T12:00:00.000Z",
    "updatedAt": "2023-05-01T12:01:00.000Z"
  }
}
```

响应示例（完成）：

```json
{
  "success": true,
  "evaluation": {
    "id": "uuid-evaluation-id",
    "status": "completed",
    "projectDetail": "项目详情...",
    "currentTask": "当前任务...",
    "githubRepoUrl": "https://github.com/username/repo",
    "result": {
      "overall": 8,
      "quality": 7,
      "functionality": 8,
      "maintainability": 9,
      "security": 7,
      "comments": "详细评价...",
      "suggestions": ["建议1", "建议2", "建议3"]
    },
    "createdAt": "2023-05-01T12:00:00.000Z",
    "completedAt": "2023-05-01T12:05:00.000Z",
    "videoEvaluation": {
      "presentationScore": 0.85,
      "summary": "视频演示摘要...",
      "codeVideoAlignment": [
        { "aspect": "功能A", "aligned": true, "details": "详细说明..." },
        // ...更多方面的评估
      ],
      "overallFeedback": "整体反馈..."
    }
  }
}
```

### 测试API

GET `/api/test` - 测试系统组件连通性

POST `/api/test` - 测试评估流程

## 开发注意事项

- Firebase连接使用HTTP代理 (端口33210) 和SOCKS代理 (端口33211)
- GitHub API访问需要有效的GitHub Token
- 豆包API需要有效的API密钥

## 许可证

此项目采用 MIT 许可证
