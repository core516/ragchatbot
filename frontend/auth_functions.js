

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
    let isDragging = false;
    let startX = 0;
    let startLeft = 0;
    const trackWidth = captchaTrack.offsetWidth;
    const handleWidth = captchaHandle.offsetWidth;
    const maxLeft = trackWidth - handleWidth - 8;

    captchaHandle.addEventListener('mousedown', startDrag);
    captchaTrack.addEventListener('click', (e) => {
        if (!captchaCompleted) {
            const rect = captchaTrack.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const targetLeft = Math.min(Math.max(clickX - handleWidth / 2, 0), maxLeft);
            animateToPosition(targetLeft, true);
        }
    });

    function startDrag(e) {
        if (captchaCompleted) return;
        isDragging = true;
        startX = e.clientX;
        startLeft = parseInt(captchaHandle.style.left) || 4;
        captchaHandle.classList.add('dragging');
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
    }

    function onDrag(e) {
        if (!isDragging) return;
        const deltaX = e.clientX - startX;
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

        const currentLeft = parseInt(captchaHandle.style.left) || 4;
        if (currentLeft >= maxLeft - 5) {
            completeCaptcha();
        } else {
            captchaHandle.style.left = '4px';
        }
    }

    function animateToPosition(targetLeft, complete) {
        const startLeft = parseInt(captchaHandle.style.left) || 4;
        const duration = 300;
        const startTime = Date.now();

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const current = startLeft + (targetLeft - startLeft) * progress;
            captchaHandle.style.left = current + 'px';

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else if (complete) {
                completeCaptcha();
            }
        }
        animate();
    }

    function completeCaptcha() {
        captchaCompleted = true;
        captchaHandle.style.left = maxLeft + 'px';
        captchaHandle.classList.add('completed');
        captchaTrack.classList.add('completed');
        captchaHandle.querySelector('.captcha-arrow').innerHTML = '✓';
    }

    function resetCaptcha() {
        captchaCompleted = false;
        captchaHandle.style.left = '4px';
        captchaHandle.classList.remove('completed');
        captchaTrack.classList.remove('completed');
        captchaHandle.querySelector('.captcha-arrow').innerHTML = '→';
    }
}
