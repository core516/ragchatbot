// API base URL - use relative path to work from any host
const API_URL = '/api';

// Global state
let currentSessionId = null;
let authToken = localStorage.getItem('auth_token') || null;
let currentUsername = localStorage.getItem('username') || null;

// DOM elements
let chatMessages, chatInput, sendButton, totalCourses, courseTitles, modelName;
let loginOverlay, loginForm, loginUsername, loginPassword, loginError, loginBtn;
let captchaTrack, captchaHandle, captchaCompleted = false;
let userMenu, userMenuBtn, userDropdown, headerUsername;
let passwordModal, changePasswordForm, passwordError, cancelPasswordBtn;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements after page loads
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    sendButton = document.getElementById('sendButton');
    totalCourses = document.getElementById('totalCourses');
    courseTitles = document.getElementById('courseTitles');
    modelName = document.getElementById('modelName');

    // Auth elements
    loginOverlay = document.getElementById('loginOverlay');
    loginForm = document.getElementById('loginForm');
    loginUsername = document.getElementById('loginUsername');
    loginPassword = document.getElementById('loginPassword');
    loginError = document.getElementById('loginError');
    loginBtn = document.getElementById('loginBtn');
    captchaTrack = document.getElementById('captchaTrack');
    captchaHandle = document.getElementById('captchaHandle');
    userMenu = document.getElementById('userMenu');
    userMenuBtn = document.getElementById('userMenuBtn');
    userDropdown = document.getElementById('userDropdown');
    headerUsername = document.getElementById('headerUsername');
    passwordModal = document.getElementById('passwordModal');
    changePasswordForm = document.getElementById('changePasswordForm');
    passwordError = document.getElementById('passwordError');
    cancelPasswordBtn = document.getElementById('cancelPasswordBtn');

    setupEventListeners();
    checkAuth();
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

    // Auth - Login form
    loginForm.addEventListener('submit', handleLogin);
    setupCaptcha();

    // Auth - User menu
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('open');
        userDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        userMenu.classList.remove('open');
        userDropdown.classList.remove('show');
    });

    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('changePasswordBtn').addEventListener('click', () => {
        passwordModal.classList.add('active');
        userMenu.classList.remove('open');
        userDropdown.classList.remove('show');
    });

    changePasswordForm.addEventListener('submit', handleChangePassword);
    cancelPasswordBtn.addEventListener('click', () => {
        passwordModal.classList.remove('active');
        changePasswordForm.reset();
        passwordError.classList.remove('show');
    });

    // Close modal on outside click
    passwordModal.addEventListener('click', (e) => {
        if (e.target === passwordModal) {
            passwordModal.classList.remove('active');
        }
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
                    const cleaned = cleanAnswerText(fullAnswer);
                    messageDiv.querySelector('.message-content').innerHTML = marked.parse(cleaned);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (event.type === 'full') {
                    // Fallback: received complete response at once
                    fullAnswer = cleanAnswerText(event.data);
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
    // Deduplicate sources
    const unique = [...new Set(sources.map(s => s.split('|||')[0]))];
    const deduped = unique.map(key => sources.find(s => s.split('|||')[0] === key));

    const sourceItems = deduped.map((source, i) => {
        const { displayText, url } = parseSource(source);
        if (url) {
            return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${i + 1}. ${escapeHtml(displayText)}</a></li>`;
        }
        return `<li>${i + 1}. ${escapeHtml(displayText)}</li>`;
    });

    const details = document.createElement('details');
    details.className = 'sources-collapsible';
    details.innerHTML = `<summary class="sources-header">Sources (${deduped.length})</summary><div class="sources-content"><ol class="source-list">${sourceItems.join('')}</ol></div>`;
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
        // Deduplicate by display text
        const unique = [...new Set(sources.map(s => s.split('|||')[0]))];
        const deduped = unique.map(key => sources.find(s => s.split('|||')[0] === key));

        const sourceItems = deduped.map((source, i) => {
            const { displayText, url } = parseSource(source);
            if (url) {
                return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${i + 1}. ${escapeHtml(displayText)}</a></li>`;
            }
            return `<li>${i + 1}. ${escapeHtml(displayText)}</li>`;
        });

        html += `
            <details class="sources-collapsible">
                <summary class="sources-header">Sources (${deduped.length})</summary>
                <div class="sources-content"><ol class="source-list">${sourceItems.join('')}</div>
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

// Clean up raw "|||url" source references from LLM answer text.
// The LLM sometimes echoes context lines like "Course Title - Lesson N|||URL" back in its response.
function cleanAnswerText(text) {
    // Match lines containing |||https:// and remove the entire line
    return text
        .replace(/[^\n]*\|\|\|https?:\/\/[^\s\n]+[^\n]*/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// Replace inline source references in answer text with clickable markdown links.
// Handles both "Title - Lesson N|||URL" and "Title - Lesson N" formats.
function formatSourcesInAnswer(text) {
    return text.replace(/(.+?)\s+\|\|\|\s*([^\s]+)/g, (_, displayText, url) => {
        return `[${displayText}](${url})`;
    });
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

// Load model configuration
async function loadModelConfig() {
    try {
        const response = await fetch(`${API_URL}/config`);
        if (!response.ok) throw new Error('Failed to load config');
        const data = await response.json();
        if (modelName) {
            modelName.textContent = data.model || 'Unknown';
        }
    } catch (error) {
        console.error('Error loading model config:', error);
        if (modelName) {
            modelName.textContent = 'Error';
        }
    }
}


// ==================== Auth Functions ====================

// Check authentication status
async function checkAuth() {
    if (authToken) {
        try {
            const response = await fetch(`${API_URL}/auth/me?session_token=${encodeURIComponent(authToken)}`);
            const data = await response.json();
            if (data.authenticated) {
                currentUsername = data.username;
                localStorage.setItem('username', currentUsername);
                showLoggedInState();
                return;
            }
        } catch (e) {
            console.error('Auth check failed:', e);
        }
    }
    // Not authenticated - show login
    showLoginState();
}

function showLoginState() {
    loginOverlay.classList.add('active');
    userMenu.style.display = 'none';
}

function showLoggedInState() {
    loginOverlay.classList.remove('active');
    userMenu.style.display = 'block';
    headerUsername.textContent = currentUsername;
}

async function handleLogin(e) {
    e.preventDefault();

    if (!captchaCompleted) {
        loginError.textContent = 'Please complete the security check';
        loginError.classList.add('show');
        return;
    }

    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username || !password) {
        loginError.textContent = 'Please enter username and password';
        loginError.classList.add('show');
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';

    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            authToken = data.session_token;
            currentUsername = data.username;
            localStorage.setItem('auth_token', authToken);
            localStorage.setItem('username', currentUsername);
            loginForm.reset();
            resetCaptcha();
            showLoggedInState();
            createNewSession();
            loadCourseStats();
            loadModelConfig();
        } else {
            loginError.textContent = data.message || 'Login failed';
            loginError.classList.add('show');
        }
    } catch (error) {
        loginError.textContent = 'Login failed: ' + error.message;
        loginError.classList.add('show');
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

async function handleLogout() {
    try {
        await fetch(`${API_URL}/auth/logout?session_token=${encodeURIComponent(authToken)}`, {
            method: 'POST'
        });
    } catch (e) {
        console.error('Logout error:', e);
    }

    authToken = null;
    currentUsername = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    showLoginState();
}

async function handleChangePassword(e) {
    e.preventDefault();

    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
        passwordError.textContent = 'New passwords do not match';
        passwordError.classList.add('show');
        return;
    }

    if (newPassword.length < 6) {
        passwordError.textContent = 'Password must be at least 6 characters';
        passwordError.classList.add('show');
        return;
    }

    try {
        const response = await fetch(
            `${API_URL}/auth/change-password?session_token=${encodeURIComponent(authToken)}&username=${encodeURIComponent(currentUsername)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
            }
        );

        const data = await response.json();

        if (data.success) {
            alert('Password changed successfully');
            passwordModal.classList.remove('active');
            changePasswordForm.reset();
        } else {
            passwordError.textContent = data.message || 'Failed to change password';
            passwordError.classList.add('show');
        }
    } catch (error) {
        passwordError.textContent = 'Error: ' + error.message;
        passwordError.classList.add('show');
    }
}

// Slider Captcha
function setupCaptcha() {
    if (!captchaTrack || !captchaHandle) {
        console.error('Captcha elements not found');
        return;
    }

    let isDragging = false;
    let startX = 0;
    let startLeft = 4;

    function updateDimensions() {
        return {
            trackWidth: captchaTrack.offsetWidth,
            handleWidth: captchaHandle.offsetWidth,
            maxLeft: captchaTrack.offsetWidth - captchaHandle.offsetWidth - 8
        };
    }

    function startDrag(e) {
        if (captchaCompleted) return;
        e.preventDefault();
        isDragging = true;
        startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        startLeft = parseInt(captchaHandle.style.left) || 4;
        captchaHandle.classList.add('dragging');
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', onDrag);
        document.addEventListener('touchend', stopDrag);
    }

    function onDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const { maxLeft } = updateDimensions();
        const deltaX = currentX - startX;
        let newLeft = startLeft + deltaX;
        newLeft = Math.min(Math.max(newLeft, 4), maxLeft);
        captchaHandle.style.left = newLeft + 'px';
    }

    function stopDrag() {
        if (!isDragging) return;
        isDragging = false;
        captchaHandle.classList.remove('dragging');
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('touchend', stopDrag);

        const { maxLeft } = updateDimensions();
        const currentLeft = parseInt(captchaHandle.style.left) || 4;
        if (currentLeft >= maxLeft - 5) {
            completeCaptcha(maxLeft);
        } else {
            captchaHandle.style.left = '4px';
        }
    }

    function completeCaptcha(maxLeft) {
        if (!maxLeft) { maxLeft = updateDimensions().maxLeft; }
        captchaCompleted = true;
        captchaHandle.style.left = maxLeft + 'px';
        captchaHandle.classList.add('completed');
        captchaTrack.classList.add('completed');
        const arrow = captchaHandle.querySelector('.captcha-arrow');
        if (arrow) arrow.innerHTML = '✓';
    }

    function resetCaptcha() {
        captchaCompleted = false;
        captchaHandle.style.left = '4px';
        captchaHandle.classList.remove('completed');
        captchaTrack.classList.remove('completed');
        const arrow = captchaHandle.querySelector('.captcha-arrow');
        if (arrow) arrow.innerHTML = '→';
    }

    // Add event listeners - support both mouse and touch
    captchaHandle.addEventListener('mousedown', startDrag);
    captchaHandle.addEventListener('touchstart', startDrag, { passive: false });

    // Click on track to jump
    captchaTrack.addEventListener('click', (e) => {
        if (captchaCompleted) return;
        const { maxLeft } = updateDimensions();
        const rect = captchaTrack.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const handleWidth = captchaHandle.offsetWidth;
        const targetLeft = Math.min(Math.max(clickX - handleWidth / 2, 0), maxLeft);
        captchaHandle.style.left = targetLeft + 'px';
        if (targetLeft >= maxLeft - 5) {
            completeCaptcha(maxLeft);
        }
    });
}
