import warnings
warnings.filterwarnings("ignore", message="resource_tracker: There appear to be.*")

import asyncio
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import os

from config import config
from rag_system import RAGSystem
import auth as auth_module

# Initialize FastAPI app
app = FastAPI(title="Course Materials RAG System", root_path="")

# Add trusted host middleware for proxy
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]
)

# Enable CORS with proper settings for proxy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Initialize RAG system
print(f"DEBUG: Initializing RAG with model={config.ANTHROPIC_MODEL}, base_url={config.ANTHROPIC_BASE_URL}")
rag_system = RAGSystem(config)
print(f"DEBUG: AI Generator model={rag_system.ai_generator.model}")

# Pydantic models for request/response
class QueryRequest(BaseModel):
    """Request model for course queries"""
    query: str
    session_id: Optional[str] = None

class QueryResponse(BaseModel):
    """Response model for course queries"""
    answer: str
    sources: List[str]
    session_id: str

class CourseStats(BaseModel):
    """Response model for course statistics"""
    total_courses: int
    course_titles: List[str]

class LoginRequest(BaseModel):
    """Request model for login"""
    username: str
    password: str

class LoginResponse(BaseModel):
    """Response model for login"""
    success: bool
    message: str
    username: Optional[str] = None
    session_token: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    """Request model for change password"""
    old_password: str
    new_password: str

# API Endpoints

# Auth endpoints
@app.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Authenticate user and create session."""
    # Initialize default user
    auth_module.init_default_user()

    session_token = auth_module.login(request.username, request.password)
    if session_token:
        return LoginResponse(
            success=True,
            message="Login successful",
            username=request.username,
            session_token=session_token
        )
    else:
        return LoginResponse(
            success=False,
            message="Invalid username or password"
        )

@app.post("/api/auth/logout")
async def logout(session_token: str):
    """Logout user."""
    auth_module.logout(session_token)
    return {"success": True}

@app.post("/api/auth/change-password")
async def change_password(request: ChangePasswordRequest, session_token: str, username: str):
    """Change user password."""
    success = auth_module.change_password(username, request.old_password, request.new_password)
    if success:
        return {"success": True, "message": "Password changed successfully"}
    return {"success": False, "message": "Invalid old password"}

@app.get("/api/auth/me")
async def get_current_user(session_token: str):
    """Get current user info."""
    username = auth_module.verify_session(session_token)
    if username:
        return {"authenticated": True, "username": username}
    return {"authenticated": False}

@app.post("/api/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """Process a query and return response with sources"""
    try:
        print(f"DEBUG query: AI Generator model={rag_system.ai_generator.model}")
        print(f"DEBUG query: Client base_url={rag_system.ai_generator.client._base_url}")
        # Create session if not provided
        session_id = request.session_id
        if not session_id:
            session_id = rag_system.session_manager.create_session()

        # Process query using RAG system in a thread to avoid blocking event loop
        answer, sources = await asyncio.to_thread(
            rag_system.query, request.query, session_id
        )

        return QueryResponse(
            answer=answer,
            sources=sources,
            session_id=session_id
        )
    except Exception as e:
        print(f"DEBUG error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/query/stream")
async def query_stream(request: QueryRequest):
    """Stream a RAG response using Server-Sent Events."""
    session_id = request.session_id
    if not session_id:
        session_id = rag_system.session_manager.create_session()

    async def event_generator():
        try:
            # Step 1: Search for context (fast)
            results = rag_system.vector_store.search(query=request.query)
            context = ""
            sources = []
            if not results.is_empty():
                context, sources = rag_system._format_search_results(results)

            # Send sources as first SSE event
            yield f"data: {json.dumps({'type': 'sources', 'data': sources})}\n\n"

            history = None
            if session_id:
                history = rag_system.session_manager.get_conversation_history(session_id)

            # Step 2: Stream LLM response
            full_response = ""
            try:
                for chunk in rag_system.ai_generator.generate_streaming_with_context(
                    query=request.query, context=context, conversation_history=history
                ):
                    full_response += chunk
                    yield f"data: {json.dumps({'type': 'token', 'data': chunk})}\n\n"
            except Exception as e:
                print(f"DEBUG streaming fallback: {e}")
                # Fallback: if streaming not supported by proxy, do blocking call
                response = rag_system.ai_generator.generate_response_with_context(
                    query=request.query, context=context, conversation_history=history
                )
                full_response = response
                yield f"data: {json.dumps({'type': 'full', 'data': response})}\n\n"

            # Send final event
            yield f"data: {json.dumps({'type': 'done', 'data': {'session_id': session_id, 'answer': full_response, 'sources': sources}})}\n\n"

            # Update conversation history
            if session_id:
                rag_system.session_manager.add_exchange(session_id, request.query, full_response)
        except Exception as e:
            print(f"ERROR in query_stream: {e}")
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/courses", response_model=CourseStats)
async def get_course_stats():
    """Get course analytics and statistics"""
    try:
        analytics = rag_system.get_course_analytics()
        return CourseStats(
            total_courses=analytics["total_courses"],
            course_titles=analytics["course_titles"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/config")
async def get_config():
    """Get current configuration including model"""
    return {
        "model": rag_system.ai_generator.model,
        "base_url": str(rag_system.ai_generator.client._base_url) if rag_system.ai_generator.client else None
    }

@app.on_event("startup")
async def startup_event():
    """Load initial documents on startup"""
    docs_path = "../docs"
    if os.path.exists(docs_path):
        print("Loading initial documents...")
        try:
            courses, chunks = rag_system.add_course_folder(docs_path, clear_existing=False)
            print(f"Loaded {courses} courses with {chunks} chunks")
        except Exception as e:
            print(f"Error loading documents: {e}")

# Custom static file handler with no-cache headers for development
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from pathlib import Path


class DevStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if isinstance(response, FileResponse):
            # Add no-cache headers for development
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response
    
    
# Serve static files for the frontend
app.mount("/", StaticFiles(directory="../frontend", html=True), name="static")