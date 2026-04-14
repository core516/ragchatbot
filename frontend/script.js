// API base URL - use relative path to work from any host
const API_URL = '/api';

// Global state
let currentSessionId = null;

// DOM elements
let chatMessages, chatInput, sendButton, totalCourses, courseTitles;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements after page loads
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    sendButton = document.getElementById('sendButton');
    totalCourses = document.getElementById('totalCourses');
    courseTitles = document.getElementById('courseTitles');
    
    setupEventListeners();
    createNewSession();
    loadCourseStats();
});

// Event Listeners
function setupEventListeners() {
    // Chat functionality
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    
    // Suggested questions
    document.querySelectorAll('.suggested-item').forEach(button => {
        button.addEventListener('click', (e) => {
            const question = e.target.getAttribute('data-question');
            chatInput.value = question;
            sendMessage();
        });
    });
}


// Chat Functions
async function sendMessage() {
    const query = chatInput.value.trim();
    if (!query) return;

    // Disable input
    chatInput.value = '';
    chatInput.disabled = true;
    sendButton.disabled = true;

    // Add user message
    addMessage(query, 'user');

    // Create a streaming message container
    const messageDiv = createStreamingAssistantMessage();
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    let fullAnswer = '';
    let pendingSources = [];

    try {
        const response = await fetch(`${API_URL}/query/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                session_id: currentSessionId
            })
        });

        if (!response.ok) throw new Error('Query failed');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));

                if (event.type === 'sources') {
                    pendingSources = event.data;
                } else if (event.type === 'token') {
                    fullAnswer += event.data;
                    messageDiv.querySelector('.message-content').innerHTML = marked.parse(fullAnswer);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (event.type === 'full') {
                    // Fallback: received complete response at once
                    fullAnswer = event.data;
                    messageDiv.querySelector('.message-content').innerHTML = marked.parse(fullAnswer);
                } else if (event.type === 'done') {
                    if (!currentSessionId) currentSessionId = event.data.session_id;
                    // Add sources collapse section
                    if (event.data.sources && event.data.sources.length > 0) {
                        addSourcesToMessage(messageDiv, event.data.sources);
                    }
                } else if (event.type === 'error') {
                    messageDiv.querySelector('.message-content').innerHTML = `<span style="color:red;">Error: ${event.data}</span>`;
                }
            }
        }
    } catch (error) {
        messageDiv.querySelector('.message-content').innerHTML = `<span style="color:red;">Error: ${error.message}</span>`;
    } finally {
        chatInput.disabled = false;
        sendButton.disabled = false;
        chatInput.focus();
    }
}

function createStreamingAssistantMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.innerHTML = `<div class="message-content"><span class="loading"><span></span><span></span><span></span></span></div>`;
    return messageDiv;
}

function addSourcesToMessage(messageDiv, sources) {
    const sourceLinks = sources.map(source => {
        const { displayText, url } = parseSource(source);
        if (url) {
            return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="source-link">${escapeHtml(displayText)}</a>`;
        }
        return `<span class="source-item">${escapeHtml(displayText)}</span>`;
    });

    const details = document.createElement('details');
    details.className = 'sources-collapsible';
    details.innerHTML = `<summary class="sources-header">Sources</summary><div class="sources-content">${sourceLinks.join('')}</div>`;
    messageDiv.appendChild(details);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addMessage(content, type, sources = null, isWelcome = false) {
    const messageId = Date.now();
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}${isWelcome ? ' welcome-message' : ''}`;
    messageDiv.id = `message-${messageId}`;

    // Convert markdown to HTML for assistant messages
    const displayContent = type === 'assistant' ? marked.parse(content) : escapeHtml(content);

    let html = `<div class="message-content">${displayContent}</div>`;

    if (sources && sources.length > 0) {
        // Parse sources and create clickable links
        const sourceLinks = sources.map(source => {
            const { displayText, url } = parseSource(source);
            if (url) {
                // Create clickable link that opens in new tab
                return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="source-link">${escapeHtml(displayText)}</a>`;
            }
            // No URL available - display as plain text
            return `<span class="source-item">${escapeHtml(displayText)}</span>`;
        });

        html += `
            <details class="sources-collapsible">
                <summary class="sources-header">Sources</summary>
                <div class="sources-content">${sourceLinks.join('')}</div>
            </details>
        `;
    }

    messageDiv.innerHTML = html;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return messageId;
}

// Parse source string to extract display text and URL
// Format: "Course Title - Lesson N|||URL" or just "Course Title - Lesson N"
function parseSource(source) {
    const separator = '|||';
    if (source.includes(separator)) {
        const parts = source.split(separator);
        return { displayText: parts[0], url: parts[1] };
    }
    return { displayText: source, url: null };
}

// Removed removeMessage function - no longer needed since we handle loading differently

async function createNewSession() {
    currentSessionId = null;
    chatMessages.innerHTML = '';
    addMessage('Welcome to the Course Materials Assistant! I can help you with questions about courses, lessons and specific content. What would you like to know?', 'assistant', null, true);
}

// Load course statistics
async function loadCourseStats() {
    try {
        console.log('Loading course stats...');
        const response = await fetch(`${API_URL}/courses`);
        if (!response.ok) throw new Error('Failed to load course stats');
        
        const data = await response.json();
        console.log('Course data received:', data);
        
        // Update stats in UI
        if (totalCourses) {
            totalCourses.textContent = data.total_courses;
        }
        
        // Update course titles
        if (courseTitles) {
            if (data.course_titles && data.course_titles.length > 0) {
                courseTitles.innerHTML = data.course_titles
                    .map(title => `<div class="course-title-item">${title}</div>`)
                    .join('');
            } else {
                courseTitles.innerHTML = '<span class="no-courses">No courses available</span>';
            }
        }
        
    } catch (error) {
        console.error('Error loading course stats:', error);
        // Set default values on error
        if (totalCourses) {
            totalCourses.textContent = '0';
        }
        if (courseTitles) {
            courseTitles.innerHTML = '<span class="error">Failed to load courses</span>';
        }
    }
}