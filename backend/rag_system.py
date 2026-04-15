from typing import List, Tuple, Optional, Dict
import os
from document_processor import DocumentProcessor
from vector_store import VectorStore
from ai_generator import AIGenerator
from session_manager import SessionManager
from search_tools import ToolManager, CourseSearchTool
from models import Course, Lesson, CourseChunk

class RAGSystem:
    """Main orchestrator for the Retrieval-Augmented Generation system"""
    
    def __init__(self, config):
        self.config = config

        # Initialize core components
        self.document_processor = DocumentProcessor(config.CHUNK_SIZE, config.CHUNK_OVERLAP)
        self.vector_store = VectorStore(config.CHROMA_PATH, config.EMBEDDING_MODEL, config.MAX_RESULTS)
        self.ai_generator = AIGenerator(
            config.ANTHROPIC_API_KEY,
            config.ANTHROPIC_MODEL,
            config.ANTHROPIC_BASE_URL
        )
        self.session_manager = SessionManager(config.MAX_HISTORY)

        # Initialize search tools
        self.tool_manager = ToolManager()
        self.search_tool = CourseSearchTool(self.vector_store)
        self.tool_manager.register_tool(self.search_tool)

        # Response cache: lowercase query -> (answer, sources)
        self._response_cache = {}
        self._cache_max_size = 100
    
    def add_course_document(self, file_path: str) -> Tuple[Course, int]:
        """
        Add a single course document to the knowledge base.
        
        Args:
            file_path: Path to the course document
            
        Returns:
            Tuple of (Course object, number of chunks created)
        """
        try:
            # Process the document
            course, course_chunks = self.document_processor.process_course_document(file_path)
            
            # Add course metadata to vector store for semantic search
            self.vector_store.add_course_metadata(course)
            
            # Add course content chunks to vector store
            self.vector_store.add_course_content(course_chunks)
            
            return course, len(course_chunks)
        except Exception as e:
            print(f"Error processing course document {file_path}: {e}")
            return None, 0
    
    def add_course_folder(self, folder_path: str, clear_existing: bool = False) -> Tuple[int, int]:
        """
        Add all course documents from a folder.
        
        Args:
            folder_path: Path to folder containing course documents
            clear_existing: Whether to clear existing data first
            
        Returns:
            Tuple of (total courses added, total chunks created)
        """
        total_courses = 0
        total_chunks = 0
        
        # Clear existing data if requested
        if clear_existing:
            print("Clearing existing data for fresh rebuild...")
            self.vector_store.clear_all_data()
        
        if not os.path.exists(folder_path):
            print(f"Folder {folder_path} does not exist")
            return 0, 0
        
        # Get existing course titles to avoid re-processing
        existing_course_titles = set(self.vector_store.get_existing_course_titles())
        
        # Process each file in the folder
        for file_name in os.listdir(folder_path):
            file_path = os.path.join(folder_path, file_name)
            if os.path.isfile(file_path) and file_name.lower().endswith(('.pdf', '.docx', '.txt')):
                try:
                    # Check if this course might already exist
                    # We'll process the document to get the course ID, but only add if new
                    course, course_chunks = self.document_processor.process_course_document(file_path)
                    
                    if course and course.title not in existing_course_titles:
                        # This is a new course - add it to the vector store
                        self.vector_store.add_course_metadata(course)
                        self.vector_store.add_course_content(course_chunks)
                        total_courses += 1
                        total_chunks += len(course_chunks)
                        print(f"Added new course: {course.title} ({len(course_chunks)} chunks)")
                        existing_course_titles.add(course.title)
                    elif course:
                        print(f"Course already exists: {course.title} - skipping")
                except Exception as e:
                    print(f"Error processing {file_name}: {e}")
        
        return total_courses, total_chunks
    
    def query(self, query: str, session_id: Optional[str] = None) -> Tuple[str, List[str]]:
        """
        Process a user query using search-first RAG approach.

        Searches the vector store first, then calls the LLM with context in a single API call.
        This eliminates the previous two-call pattern (tool_use -> tool_result -> final).

        Args:
            query: User's question
            session_id: Optional session ID for conversation context

        Returns:
            Tuple of (response, sources list)
        """
        # Check response cache
        cache_key = query.strip().lower()
        if cache_key in self._response_cache:
            print(f"DEBUG: Cache hit for query: {cache_key[:50]}...")
            return self._response_cache[cache_key]

        # Step 1: Search for relevant context first
        results = self.vector_store.search(query=query)

        # Format search results as context and extract sources
        context = ""
        sources = []
        if not results.is_empty():
            context, sources = self._format_search_results(results)

        # Step 2: Get conversation history
        history = None
        if session_id:
            history = self.session_manager.get_conversation_history(session_id)

        # Step 3: Generate response with context in a single API call
        response = self.ai_generator.generate_response_with_context(
            query=query,
            context=context,
            conversation_history=history
        )

        # Update conversation history
        if session_id:
            self.session_manager.add_exchange(session_id, query, response)

        # Cache the result
        if len(self._response_cache) >= self._cache_max_size:
            self._response_cache.pop(next(iter(self._response_cache)))
        self._response_cache[cache_key] = (response, sources)

        return response, sources

    def _sort_sources(self, sources: List[str]) -> List[str]:
        """Sort sources by course name (asc), then lesson number (asc).
        Source format: 'Course - Lesson N|||url' or 'Course - Lesson N'."""
        import re

        def sort_key(s):
            # Extract course name (everything before ' - Lesson')
            lesson_match = re.search(r'^(.+?)\s+-\s+Lesson\s+(\d+)', s)
            if lesson_match:
                course_name = lesson_match.group(1).strip().lower()
                lesson_num = int(lesson_match.group(2))
                return (course_name, lesson_num)
            # Fallback: no lesson info, sort alphabetically
            return (s.lower(), float('inf'))

        return sorted(sources, key=sort_key)

    def _format_search_results(self, results) -> Tuple[str, List[str]]:
        """Format search results into context string and sources list."""
        context_parts = []
        sources = []

        for doc, meta in zip(results.documents, results.metadata):
            course_title = meta.get('course_title', 'unknown')
            lesson_num = meta.get('lesson_number')

            # Build context header
            header = f"[{course_title}"
            if lesson_num is not None:
                header += f" - Lesson {lesson_num}"
            header += "]"

            context_parts.append(f"{header}\n{doc}")

            # Build source with embedded link
            source = course_title
            if lesson_num is not None:
                source += f" - Lesson {lesson_num}"
                lesson_link = self.vector_store.get_lesson_link(course_title, lesson_num)
                if lesson_link:
                    source = f"{source}|||{lesson_link}"

            sources.append(source)

        return "\n\n".join(context_parts), self._sort_sources(sources)
    
    def get_course_analytics(self) -> Dict:
        """Get analytics about the course catalog"""
        return {
            "total_courses": self.vector_store.get_course_count(),
            "course_titles": self.vector_store.get_existing_course_titles()
        }