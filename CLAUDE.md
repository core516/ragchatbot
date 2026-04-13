# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Retrieval-Augmented Generation (RAG) system for querying course materials. Uses ChromaDB for vector storage and Anthropic Claude for AI responses with tool-based search capabilities.

## Commands

**Important**: Always use `uv` for ALL dependency management. Never use pip.

```bash
# Install dependencies
uv sync

# Add new package
uv add <package-name>

# Remove package
uv remove <package-name>

# Run Python scripts
uv run python <script.py>

# Start the server
cd backend && uv run uvicorn app:app --reload --port 8000
```

The application runs at:
- Web Interface: http://localhost:8000
- API Documentation: http://localhost:8000/docs

## Prerequisites

- Python 3.13+
- uv package manager
- ANTHROPIC_API_KEY in `.env` file

## Architecture

### Request Flow

1. **Frontend** (`frontend/script.js`) sends POST to `/api/query` with `{query, session_id}`
2. **Backend** (`backend/app.py`) routes to `RAGSystem.query()`
3. **RAGSystem** (`backend/rag_system.py`) orchestrates:
   - Retrieves conversation history from `SessionManager`
   - Calls `AIGenerator` with tool definitions
4. **AIGenerator** (`backend/ai_generator.py`) calls Claude API with tools
5. If Claude triggers tool_use, **SearchTool** (`backend/search_tools.py`) executes via **VectorStore**
6. **VectorStore** (`backend/vector_store.py`) performs semantic search on ChromaDB
7. Results flow back: tool_result → Claude → final response → frontend

### Key Components

| File | Purpose |
|------|---------|
| `backend/rag_system.py` | Main orchestrator - coordinates all components |
| `backend/ai_generator.py` | Claude API integration with Anthropic tool calling |
| `backend/vector_store.py` | ChromaDB operations: course_catalog (metadata) + course_content (chunks) |
| `backend/search_tools.py` | Tool interface (`search_course_content`) for Claude to call |
| `backend/document_processor.py` | Parses course docs, creates text chunks |
| `backend/session_manager.py` | Conversation history per session |
| `backend/config.py` | All configuration: chunk size, model names, paths |

### Data Model

- `Course`: title (ID), course_link, instructor, lessons[]
- `Lesson`: lesson_number, title, lesson_link
- `CourseChunk`: content, course_title, lesson_number, chunk_index

### ChromaDB Collections

Two collections for different data types:
- `course_catalog`: Course metadata for semantic course name matching
- `course_content`: Actual text chunks for content search

### Document Format

Course documents (`docs/*.txt`) follow this format:
```
Course Title: [title]
Course Link: [url]
Course Instructor: [name]

Lesson 1: [title]
Lesson Link: [url]
[content...]

Lesson 2: [title]
...
```

## Configuration

Key settings in `backend/config.py`:
- `CHUNK_SIZE`: 800 characters
- `CHUNK_OVERLAP`: 100 characters
- `MAX_RESULTS`: 5 search results
- `MAX_HISTORY`: 2 conversation exchanges
- `EMBEDDING_MODEL`: all-MiniLM-L6-v2
- `ANTHROPIC_MODEL`: claude-sonnet-4-20250514