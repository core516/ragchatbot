# RAG 系统请求流程图

## 整体架构流程

```mermaid
flowchart TD
    subgraph Frontend["前端 (frontend/)"]
        A[用户输入问题] --> B[script.js: sendMessage]
        B --> C[POST /api/query/stream (SSE)]
    end

    subgraph Backend["后端 (backend/)"]
        D[app.py: query_stream] --> E[vector_store.py: search]
        E --> F[ChromaDB 语义搜索]
        F --> G[返回相关文档]
        G --> H[rag_system.py: _format_search_results]
        H --> I[格式化 context + sources]
        I --> J[ai_generator.py: generate_response_with_context]
        J --> K{流式输出}
        K -->|token| L[SSE event: token]
        K -->|完成| M[SSE event: done]
        K -->|异常| N[SSE event: error]
    end

    C --> D
    L --> O[前端实时更新回答]
    M --> P[显示来源 Sources]
    N --> Q[显示错误信息]

    style Frontend fill:#e1f5fe
    style Backend fill:#fff3e0
```

## 非流式备用流程

```mermaid
flowchart TD
    A[POST /api/query] --> B[app.py: query_documents]
    B --> C[rag_system.py: query]
    C --> D{响应缓存?}
    D -->|命中| E[直接返回缓存结果]
    D -->|未命中| F[vector_store: search]
    F --> G[_format_search_results]
    G --> H[ai_generator: generate_response_with_context]
    H --> I[Claude API 单次调用]
    I --> J[更新对话历史 + 缓存结果]
    J --> K[返回 answer + sources]

    style D fill:#fff9c4
    style E fill:#c8e6c9
```

## 数据流详解

### 流式查询（主路径）

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as Frontend (script.js)
    participant API as FastAPI (app.py query_stream)
    participant VS as VectorStore
    participant DB as ChromaDB
    participant RS as RAGSystem (_format_search_results)
    participant AI as AIGenerator
    participant Claude as Claude API

    U->>F: 输入问题
    F->>API: POST /api/query/stream {query, session_id}

    API->>API: 发送 SSE sources 事件

    API->>VS: search(query)
    VS->>DB: course_content.query(query_texts, n_results, where)
    DB-->>VS: 相关文档块
    VS-->>API: SearchResults

    API->>RS: _format_search_results(results)
    RS-->>API: (context_str, sources_list)

    API->>AI: generate_streaming_with_context(query, context, history)
    AI->>Claude: messages.stream (system+context+query)

    loop 流式输出
        Claude-->>AI: text_chunk
        AI-->>API: yield text_chunk
        API-->>F: SSE event: token
    end

    Claude-->>AI: 完成
    API->>API: 发送 SSE done 事件 (含 session_id, answer, sources)

    F->>U: 实时渲染回答 + 可点击来源链接
```

### 非流式查询（备用路径）

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as Frontend (script.js)
    participant API as FastAPI (app.py query_documents)
    participant RS as RAGSystem (query)
    participant Cache as 响应缓存
    participant VS as VectorStore
    participant AI as AIGenerator
    participant SM as SessionManager
    participant Claude as Claude API

    U->>F: 输入问题
    F->>API: POST /api/query {query, session_id}
    API->>API: asyncio.to_thread(RAGSystem.query)

    RS->>Cache: 检查缓存 (query.lower())
    alt 缓存命中
        Cache-->>RS: 返回 (answer, sources)
    else 缓存未命中
        RS->>VS: search(query)
        VS-->>RS: SearchResults
        RS->>RS: _format_search_results → (context, sources)
        RS->>SM: get_conversation_history(session_id)
        SM-->>RS: 对话历史

        RS->>AI: generate_response_with_context(query, context, history)
        AI->>Claude: messages.create (system+context+query)
        Claude-->>AI: 完整回答

        RS->>SM: add_exchange(session_id, query, answer)
        RS->>Cache: 缓存结果
    end

    RS-->>API: (answer, sources)
    API-->>F: JSON {answer, sources, session_id}
    F->>U: 显示回答 + 来源
```

## 文件关系图

```mermaid
graph LR
    subgraph frontend["frontend/"]
        HTML[index.html]
        JS[script.js]
        CSS[style.css]
    end

    subgraph backend["backend/"]
        APP[app.py]
        RAG[rag_system.py]
        AI[ai_generator.py]
        VS[vector_store.py]
        DP[document_processor.py]
        ST[search_tools.py]
        SM[session_manager.py]
        CFG[config.py]
        MDL[models.py]
        TEST[test_query.py]
    end

    subgraph external["外部服务"]
        CLAUDE[Claude API / 自定义代理]
        CHROMA[ChromaDB]
        ST2[SentenceTransformer]
    end

    subgraph docs["docs/"]
        C1[course1_script.txt]
        C2[course2_script.txt]
        C3[course3_script.txt]
        C4[course4_script.txt]
    end

    HTML --> JS
    JS -->|SSE /api/query/stream| APP
    JS -->|POST /api/query| APP

    APP --> RAG
    RAG --> AI
    RAG --> VS
    RAG --> SM
    RAG --> DP
    RAG -.缓存.-> RAG

    AI --> CFG
    AI --> CLAUDE

    VS --> CFG
    VS --> MDL
    VS --> CHROMA
    VS --> ST2

    ST --> VS
    DP --> MDL
    SM --> CFG

    DP --> docs

    style frontend fill:#bbdefb
    style backend fill:#c8e6c9
    style external fill:#ffe0b2
    style docs fill:#f8bbd0
```

## 启动流程

```mermaid
flowchart LR
    A[uvicorn app:app] --> B[FastAPI 启动]
    B --> C[startup_event]
    C --> D[RAGSystem 初始化]
    D --> E[VectorStore: 加载课程标题索引]
    D --> F[AIGenerator: 连接 Claude API]
    E --> G[加载 docs/ 文档]
    G --> H[DocumentProcessor 处理]
    H --> I[VectorStore 存储到 ChromaDB]
    I --> J[系统就绪]

    J --> K[用户访问 localhost:8000]
    K --> L[返回 index.html + 前端加载]
```

## 关键架构变更说明

| 变更 | 原实现 | 新实现 |
|------|--------|--------|
| 查询方式 | Tool-use 循环 (2次API调用) | 预搜索 + 单次API调用 |
| 前端请求 | POST /api/query (同步) | POST /api/query/stream (SSE流式) |
| 响应缓存 | 无 | RAGSystem 内置 LRU 缓存 |
| 来源链接 | 纯文本 | `|||` 分隔嵌入URL，前端渲染为可点击链接 |
| 课程名解析 | 纯向量搜索 | 精确匹配 → 子串匹配 → 向量搜索 (三级) |
| 自定义代理 | 不支持 | config.py 支持 ANTHROPIC_BASE_URL |
| 流式异常处理 | HTTP 500 | SSE error 事件 |
