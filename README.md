# 课程材料 RAG 系统

一个基于检索增强生成 (RAG) 的系统，用于查询课程材料并获得 AI 驱动的智能回答。

## 系统概述

这是一个全栈 Web 应用，用户可以查询课程材料并获得上下文相关的智能回答。系统使用 ChromaDB 进行向量存储，Anthropic Claude 进行 AI 生成，并提供 Web 交互界面。

## 技术栈

- **Python 3.13+**
- **FastAPI** - Web 框架
- **ChromaDB** - 向量数据库
- **Anthropic Claude** - AI 模型
- **sentence-transformers** - 嵌入模型 (all-MiniLM-L6-v2)

## 环境要求

- Python 3.13 或更高版本
- uv (Python 包管理器)
- Anthropic API Key

## 安装步骤

### 1. 安装 uv

```bash
# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. 安装依赖

```bash
uv sync
```

### 3. 配置环境变量

创建 `.env` 文件：

```bash
ANTHROPIC_API_KEY=你的 API 密钥
```

## 运行应用

```bash
cd backend && uv run uvicorn app:app --reload --port 8000
```

启动后访问：
- Web 界面: http://localhost:8000
- API 文档: http://localhost:8000/docs

## 项目结构

```
├── backend/           # 后端代码
│   ├── app.py         # FastAPI 应用入口
│   ├── rag_system.py  # RAG 系统主控制器
│   ├── ai_generator.py    # Claude API 调用
│   ├── vector_store.py    # ChromaDB 向量存储
│   ├── search_tools.py    # 搜索工具接口
│   ├── document_processor.py  # 文档处理
│   ├── session_manager.py     # 会话管理
│   ├── config.py       # 配置文件
│   └── models.py       # 数据模型
├── frontend/          # 前端代码
│   ├── index.html
│   ├── script.js
│   └── style.css
├── docs/              # 课程文档
└── pyproject.toml     # 项目配置
```

## 数据流程

1. 用户在前端输入问题
2. 请求发送到 FastAPI 后端
3. RAG 系统调用 Claude API（带搜索工具）
4. Claude 决定是否需要搜索课程内容
5. 如需搜索，调用 ChromaDB 进行语义检索
6. 搜索结果返回给 Claude 生成回答
7. 回答返回前端显示给用户

## 课程文档格式

课程文档 (`docs/*.txt`) 格式：

```
Course Title: [课程标题]
Course Link: [课程链接]
Course Instructor: [讲师名称]

Lesson 1: [课时标题]
Lesson Link: [课时链接]
[内容...]

Lesson 2: [课时标题]
...
```