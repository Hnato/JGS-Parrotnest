(() => {
    // Force port 6069 for the API server
    const port = '6069';
    const hostname = window.location.hostname === '0.0.0.0' ? 'localhost' : window.location.hostname;
    // If we are running on the server port itself, use origin, otherwise default to localhost:6069
    let origin = `http://${hostname}:${port}`;
    
    window.__SERVER_BASE_DEFAULT__ = origin;
})();

// Force update if port 5000 is detected in storage
let storedBase = localStorage.getItem('serverBase');
if (storedBase && (storedBase.includes(':5000') || !storedBase.includes(':6069'))) {
    localStorage.removeItem('serverBase');
    storedBase = null;
}

const SERVER_BASE = (storedBase || window.__SERVER_BASE_DEFAULT__).replace(/\/+$/,'');
const API_URL = `${SERVER_BASE}/api`;
const HUB_URL = `${SERVER_BASE}/chatHub`;

function resolveUrl(url) {
    if (!url) return null;
    
    // Fix legacy port 5000 in absolute URLs
    if (typeof url === 'string' && url.includes(':5000')) {
        url = url.replace(':5000', ':6069');
    }

    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    
    // Normalize path separators
    url = url.replace(/\\/g, '/');
    
    // Ensure leading slash for consistency in checking
    if (!url.startsWith('/')) {
        url = '/' + url;
    }

    // For uploads, always use the API server URL (port 6069)
    if (url.startsWith('/uploads/')) {
        const baseUrl = API_URL.replace(/\/api$/, ''); // Remove /api suffix
        return `${baseUrl}${url}`;
    }

    if (url.startsWith('/')) {
        const baseUrl = API_URL.replace(/\/api$/, '');
        return `${baseUrl}${url}`;
    }
    return url;
}

// Notification System
function showNotification(message, type = 'success') {
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.className = 'notification-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

async function handleApiError(response, defaultMessage = 'Wystąpił błąd') {
    const text = await response.text();
    let message = text;
    try {
        const json = JSON.parse(text);
        message = json.message || json.error || json.title || defaultMessage;
        
        if (json.errors) {
             const details = Object.values(json.errors).flat().join(', ');
             if (details) message += `: ${details}`;
        }
    } catch (e) {
        if (text.trim().startsWith('<')) {
            message = `${defaultMessage} (Status: ${response.status})`;
        }
    }
    showNotification(message, 'error');
}


// Login Page Logic
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                showNotification('Zalogowano pomyślnie.', 'success');
                setTimeout(() => {
                    window.location.href = 'index.php';
                }, 800);
            } else {
                await handleApiError(response, 'Logowanie nieudane');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('Wystąpił błąd podczas logowania.', 'error');
        }
    });
}

// Register Page Logic
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (password !== confirmPassword) {
            showNotification('Hasła nie są identyczne!', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });
            
            if (response.ok) {
                showNotification('Rejestracja udana! Możesz się teraz zalogować.', 'success');
                setTimeout(() => {
                    window.location.href = 'login.php';
                }, 1500);
            } else {
                await handleApiError(response, 'Rejestracja nieudana');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('Wystąpił błąd podczas rejestracji.', 'error');
        }
    });
}

// Chat Page Logic
const messageInput = document.getElementById('messageInput');
if (messageInput) {
    (async function() {
        // Sprawdzenie czy SignalR jest dostępny – nie blokuj UI, tylko pracuj bez połączenia
        let signalRAvailable = typeof signalR !== 'undefined';
        if (!signalRAvailable) {
            console.warn('SignalR library not loaded – funkcje czatu ograniczone, ale UI działa.');
            showNotification('Brak połączenia z serwerem czatu. Próba ponownego połączenia...', 'warning');
        }

        const token = localStorage.getItem('token');
        let user = null;
        try {
            user = JSON.parse(localStorage.getItem('user'));
        } catch (e) {
            console.error('Error parsing user from localStorage', e);
        }
        
        if (!token || !user) {
            window.location.href = 'login.php';
            return;
        }

        // Request notification permission
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }

        let selectedImageFile = null;
        let pendingGroupAvatarBlob = null;

        let currentChatId = null; // null = global
        let currentChatType = 'global'; // 'global', 'private', 'group'
        let friends = [];
        let pendingRequests = [];
        let groups = [];
        let peerConnection = null;
        let localStream = null;
        let remoteStream = null;

        const notificationSound = new Audio('parrot.mp3');
        let originalTitle = document.title;
        let titleInterval = null;

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                document.title = originalTitle;
                if (titleInterval) {
                    clearInterval(titleInterval);
                    titleInterval = null;
                }
            }
        });

        if (signalRAvailable && typeof window.connection === 'undefined') {
            try {
                window.connection = new signalR.HubConnectionBuilder()
                    .withUrl(HUB_URL, {
                        accessTokenFactory: () => token
                    })
                    .withAutomaticReconnect()
                    .build();
            } catch (e) {
                console.error('SignalR build error:', e);
                showNotification('Błąd inicjalizacji połączenia.', 'error');
            }

            loadFriends();
            loadGroups();
            loadPendingRequests();
        } else {
            console.log("SignalR connection already initialized");
        }
        
        const connection = window.connection;

        // Elements
        const messageForm = document.getElementById('messageForm');
        const imageInput = document.getElementById('imageInput');
        const attachmentPreview = document.getElementById('attachmentPreview');
        const attachButton = document.getElementById('attachButton');
        const userStatusEl = document.getElementById('userStatus');
        const notificationBell = document.getElementById('notificationButton');
        let notificationsMuted = localStorage.getItem('notificationsMuted') === 'true';
        
        if (notificationBell) {
            notificationBell.textContent = notificationsMuted ? '🔕' : '🔔';
            notificationBell.addEventListener('click', () => {
                notificationsMuted = !notificationsMuted;
                localStorage.setItem('notificationsMuted', notificationsMuted ? 'true' : 'false');
                notificationBell.textContent = notificationsMuted ? '🔕' : '🔔';
                showNotification(notificationsMuted ? 'Powiadomienia wyłączone' : 'Powiadomienia włączone', 'info');
            });
        }
        if (userStatusEl) {
            if (signalRAvailable) {
                userStatusEl.textContent = 'Online';
                userStatusEl.classList.remove('status-offline');
                userStatusEl.classList.add('status-online');
            } else {
                userStatusEl.textContent = 'Offline';
                userStatusEl.classList.remove('status-online');
                userStatusEl.classList.add('status-offline');
            }
        }

        // Attach button handler
        if (attachButton && imageInput) {
            attachButton.addEventListener('click', () => {
                imageInput.click();
            });
        }

        const groupAvatarInput = document.getElementById('groupAvatarInput');
        const changeGroupAvatarBtn = document.getElementById('changeGroupAvatarBtn');
        const groupAvatarPreview = document.getElementById('groupAvatarPreview');

        if (changeGroupAvatarBtn && groupAvatarInput) {
            changeGroupAvatarBtn.addEventListener('click', () => {
                groupAvatarInput.click();
            });
        }

        if (groupAvatarPreview && groupAvatarInput) {
             groupAvatarPreview.addEventListener('click', () => {
                groupAvatarInput.click();
            });
        }

        if (groupAvatarInput && groupAvatarPreview) {
            groupAvatarInput.addEventListener('change', () => {
                if (groupAvatarInput.files && groupAvatarInput.files[0]) {
                     const file = groupAvatarInput.files[0];
                     const url = URL.createObjectURL(file);
                     groupAvatarPreview.style.backgroundImage = `url('${url}')`;
                     groupAvatarPreview.style.backgroundSize = 'cover';
                     groupAvatarPreview.style.backgroundPosition = 'center';
                     groupAvatarPreview.textContent = '';
                }
            });
        }

        

        // Logo click handler (play sound)
        const logoContainer = document.getElementById('logoContainer');
        if (logoContainer) {
            logoContainer.addEventListener('click', () => {
                const audio = new Audio('parrot.mp3');
                audio.play().catch(e => console.error('Error playing sound:', e));
            });
        }

        // Image input change handler
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    selectedImageFile = e.target.files[0];
                    if (attachmentPreview) {
                        const url = URL.createObjectURL(selectedImageFile);
                        const sizeKb = Math.max(1, Math.round(selectedImageFile.size / 1024));
                        attachmentPreview.style.display = 'flex';
                        attachmentPreview.innerHTML = `
                            <img src="${url}" class="attachment-thumb" alt="">
                            <span class="attachment-name">${selectedImageFile.name} (${sizeKb} KB)</span>
                            <button type="button" class="btn-icon attachment-remove" title="Usuń">×</button>
                        `;
                        const removeBtn = attachmentPreview.querySelector('.attachment-remove');
                        if (removeBtn) {
                            removeBtn.addEventListener('click', () => {
                                selectedImageFile = null;
                                imageInput.value = '';
                                attachmentPreview.style.display = 'none';
                                attachmentPreview.innerHTML = '';
                            });
                        }
                    }
                }
            });
        }

        // Message submit handler
        if (messageForm) {
            messageForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = document.getElementById('messageInput');
                const message = input.value.trim();
                let imageUrl = null;

                if (selectedImageFile) {
                    const formData = new FormData();
                    formData.append('file', selectedImageFile);
                    
                    try {
                        const response = await fetch(`${API_URL}/messages/upload`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${token}`
                            },
                            body: formData
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            imageUrl = data.url;
                        } else {
                            console.error('Upload failed');
                            showNotification('Nie udało się wysłać obrazka.', 'error');
                            return;
                        }
                    } catch (err) {
                        console.error('Error uploading file:', err);
                        showNotification('Błąd podczas wysyłania pliku.', 'error');
                        return;
                    }
                }
                
                if (message || imageUrl) {
                    try {
                        if (!signalRAvailable || !connection || connection.state !== signalR.HubConnectionState.Connected) {
                            console.warn('SignalR not connected. State:', connection.state);
                            showNotification('Połączenie z serwerem nie jest aktywne. Poczekaj chwilę.', 'error');
                            return;
                        }

                        const senderName = user.username || user.userName || user.email || 'Nieznany';
                        
                        // Ensure IDs are integers or null
                        const chatIdInt = currentChatId ? parseInt(currentChatId) : null;
                        
                        if (currentChatType === 'group') {
                            await connection.invoke("SendMessage", senderName, message, imageUrl, null, chatIdInt);
                        } else if (currentChatType === 'private') {
                            await connection.invoke("SendMessage", senderName, message, imageUrl, chatIdInt, null);
                        } else {
                            await connection.invoke("SendMessage", senderName, message, imageUrl, null, null);
                        }
                        
                        // Clear inputs
                        input.value = '';
                        selectedImageFile = null;
                        if (imageInput) imageInput.value = '';
                        if (attachmentPreview) {
                            attachmentPreview.style.display = 'none';
                            attachmentPreview.textContent = '';
                        }
                    } catch (err) {
                        console.error('Błąd wysyłania wiadomości:', err);
                        showNotification('Nie udało się wysłać wiadomości.', 'error');
                    }
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.code === 'Space') {
                    e.preventDefault();
                    messageForm.requestSubmit();
                }
            });
        }
    
        // Update user profile display
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) {
            userNameEl.textContent = user.username || 'Użytkownik';
        }
        if (userAvatarEl) {
            const uAv = user.avatarUrl || user.AvatarUrl;
            if (uAv) {
                userAvatarEl.style.backgroundImage = `url('${resolveUrl(uAv)}')`;
                userAvatarEl.style.backgroundSize = 'cover';
                userAvatarEl.textContent = '';
            } else if (user.username) {
                userAvatarEl.textContent = user.username.charAt(0).toUpperCase();
                userAvatarEl.style.backgroundImage = '';
            }
        }

        // Handlers for SignalR
        connection.on("UserStatusChanged", (userId, isOnline) => {
            console.log(`User ${userId} status changed: ${isOnline}`);
            // Update friend status in local array
            const friendIndex = friends.findIndex(f => f.id == userId || f.Id == userId);
            if (friendIndex !== -1) {
                friends[friendIndex].isOnline = isOnline;
                friends[friendIndex].IsOnline = isOnline; // handle both casing just in case
                updateChatList();
            }
        });

        // Live updates for groups
        connection.on("GroupMembershipChanged", async (action, group) => {
            try {
                await loadGroups();
                if (action === 'added') {
                    showNotification(`Dołączono do grupy: ${group?.Name || group?.name}`, 'success');
                } else if (action === 'removed') {
                    showNotification(`Usunięto z grupy: ${group?.Name || group?.name}`, 'info');
                    const last = localStorage.getItem('lastChat');
                    if (last) {
                        const { id, type } = JSON.parse(last);
                        if (type === 'group' && id == group?.Id) {
                            selectChat(null, 'Ogólny', null, 'global');
                        }
                    }
                } else if (action === 'updated') {
                    showNotification(`Zaktualizowano grupę: ${group?.Name || group?.name}`, 'info');
                }
            } catch (e) {
                console.error('GroupMembershipChanged handler error', e);
            }
        });

        connection.on("ReceiveMessage", (senderId, senderUsername, message, imageUrl, receiverId, groupId, senderAvatarUrl) => {
            // Fix image URL if needed
            if (imageUrl) {
                imageUrl = resolveUrl(imageUrl);
            }

            // Determine if message belongs to current chat
            let shouldShow = false;
            const currentUser = JSON.parse(localStorage.getItem('user'));
            // Fix: ensure correct ID comparison
            const currentUserId = currentUser.id || currentUser.Id;
            const isOwnMessage = parseInt(senderId) === parseInt(currentUserId);
            
            if (groupId) {
                // Group message
                if (currentChatType === 'group' && currentChatId == groupId) {
                    shouldShow = true;
                }
            } else if (receiverId) {
                // Private message
                if (currentChatType === 'private') {
                     if (isOwnMessage) {
                         shouldShow = (currentChatId == receiverId);
                     } else {
                         shouldShow = (currentChatId == senderId);
                     }
                }
            } else {
                // Global message
                if (currentChatType === 'global') {
                    shouldShow = true;
                }
            }

            // Notifications
            if (!isOwnMessage) {
                if (!notificationsMuted) {
                    notificationSound.play().catch(e => console.log('Sound play error:', e));
                }

                // Browser notification
                if (document.hidden || !shouldShow) {
                    if (Notification.permission === "granted") {
                        new Notification(`Nowa wiadomość od ${senderUsername}`, {
                            body: message || (imageUrl ? "Przesłano zdjęcie" : "Nowa wiadomość"),
                            icon: 'parrot.png'
                        });
                    }
                    
                    // Title flashing
                    if (document.hidden) {
                        if (!titleInterval) {
                            let isOriginal = false;
                            titleInterval = setInterval(() => {
                                document.title = isOriginal ? originalTitle : "Nowa wiadomość!";
                                isOriginal = !isOriginal;
                            }, 1000);
                        }
                    }
                }
            }

            if (!shouldShow) return;
            
            const messageWrapper = document.createElement("div");
            messageWrapper.className = `message-wrapper ${isOwnMessage ? 'own-message' : ''}`;
            
            const row = document.createElement("div");
            row.className = "message-row";
            
            const avatarEl = document.createElement("div");
            avatarEl.className = "message-avatar";
            if (senderAvatarUrl) {
                const url = resolveUrl(senderAvatarUrl);
                avatarEl.style.backgroundImage = `url('${url}')`;
                avatarEl.textContent = '';
            } else if (senderUsername) {
                avatarEl.textContent = senderUsername.charAt(0).toUpperCase();
            }
            
            const msgDiv = document.createElement("div");
            msgDiv.className = isOwnMessage ? "message sent" : "message received";
            
            if (!isOwnMessage) {
                const senderName = document.createElement("div");
                senderName.className = "message-sender";
                senderName.textContent = senderUsername;
                messageWrapper.appendChild(senderName);
            }
            
            // Image rendering
            if (imageUrl) {
                const img = document.createElement("img");
                img.src = imageUrl;
                img.className = "message-image";
                img.onclick = () => openLightbox(imageUrl);
                msgDiv.appendChild(img);
            }

            // Text rendering
            if (message) {
                const messageText = document.createElement("div");
                messageText.className = "message-text";
                messageText.textContent = message;
                msgDiv.appendChild(messageText);
            }
            
            const timestamp = document.createElement("div");
            timestamp.className = "message-time";
            timestamp.textContent = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
            msgDiv.appendChild(timestamp);
            
            row.appendChild(avatarEl);
            row.appendChild(msgDiv);
            messageWrapper.appendChild(row);
            
            const messagesContainer = document.getElementById("chat-messages");
            if (messagesContainer) {
                messagesContainer.appendChild(messageWrapper);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        });

        connection.on("ReceiveSignal", async (user, signal) => {
            const signalData = JSON.parse(signal);
            // Handle WebRTC signaling here (Offer/Answer/Candidate)
            console.log("Received signal from", user, signalData);
        });

        // Load friends and setup chat list
        async function loadFriends() {
            try {
                const response = await fetch(`${API_URL}/friends`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    friends = await response.json();
                    updateChatList();
                } else {
                    await handleApiError(response, 'Błąd pobierania listy znajomych');
                }
            } catch (error) {
                console.error('Error loading friends:', error);
                showNotification('Brak połączenia z bazą lub serwerem (znajomi).', 'error');
            }
        }

        async function loadGroups() {
            try {
                const response = await fetch(`${API_URL}/groups`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    groups = await response.json();
                    updateChatList();
                } else {
                    await handleApiError(response, 'Błąd pobierania grup');
                }
            } catch (error) {
                console.error('Error loading groups:', error);
                showNotification('Brak połączenia z bazą lub serwerem (grupy).', 'error');
            }
        }

        // Update Notification Badge
        function updateNotificationBadge() {
            const badge = document.getElementById('notificationBadge');
            if (!badge) return;
            
            const count = pendingRequests.length;
            // You can add unread messages count here if tracked
            
            if (count > 0) {
                badge.style.display = 'flex';
                if (count > 4) {
                    badge.textContent = '4+';
                } else {
                    badge.textContent = count;
                }
            } else {
                badge.style.display = 'none';
            }
        }

        async function loadPendingRequests() {
            try {
                const response = await fetch(`${API_URL}/friends/pending`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    pendingRequests = await response.json();
                    updateChatList();
                    updateNotificationBadge();
                    renderPendingRequestsModal();
                } else {
                    await handleApiError(response, 'Błąd pobierania zaproszeń');
                }
            } catch (error) {
                console.error('Error loading pending requests:', error);
                showNotification('Brak połączenia z bazą lub serwerem (zaproszenia).', 'error');
            }
        }

        async function acceptFriend(friendshipId) {
            try {
                const response = await fetch(`${API_URL}/friends/accept/${friendshipId}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    // Reload everything
                    loadPendingRequests();
                    loadFriends();
                } else {
                    showNotification('Nie udało się zaakceptować zaproszenia.', 'error');
                }
            } catch (error) {
                console.error('Error accepting friend:', error);
            }
        }

        async function rejectFriend(friendshipId) {
            if (!confirm('Czy na pewno chcesz odrzucić to zaproszenie?')) return;
            try {
                // Assuming we can use DELETE /friends/{id} where id is friendshipId
                // Based on backend analysis, this might be tricky if it expects UserId.
                // However, let's try DELETE /friends/{friendshipId}
                // If the backend Logic at 242 finds by ID, it works.
                const response = await fetch(`${API_URL}/friends/${friendshipId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    loadPendingRequests();
                } else {
                    showNotification('Nie udało się odrzucić zaproszenia.', 'error');
                }
            } catch (error) {
                console.error('Error rejecting friend:', error);
            }
        }

        function updateChatList() {
            const chatList = document.querySelector('.chat-list');
            if (!chatList) return;

            // Clear existing chat items (except global)
            // We need to be careful not to duplicate headers if we re-run this
            // Simplest way is to remove all dynamic items and headers
            const items = Array.from(chatList.children);
            items.forEach(item => {
                // Keep the first item if it is Global Chat (usually the first .chat-item)
                // Assuming Global is always first and static in HTML or created once
                const h4 = item.querySelector('h4');
                if (item.classList.contains('chat-item') && h4 && h4.textContent === 'Ogólny') {
                    // Keep Global
                } else {
                    item.remove();
                }
            });

            // Add Pending Requests Section
            if (pendingRequests.length > 0) {
                const pendingHeader = document.createElement('div');
                pendingHeader.textContent = 'Oczekujące zaproszenia';
                pendingHeader.style.padding = '10px 20px';
                pendingHeader.style.fontSize = '0.75rem';
                pendingHeader.style.fontWeight = 'bold';
                pendingHeader.style.color = 'var(--text-secondary)';
                pendingHeader.style.textTransform = 'uppercase';
                pendingHeader.style.letterSpacing = '1px';
                chatList.appendChild(pendingHeader);

                pendingRequests.forEach(req => {
                    const reqItem = document.createElement('div');
                    reqItem.className = 'chat-item pending-request';
                    reqItem.style.cursor = 'default';
                    reqItem.style.flexDirection = 'column';
                    reqItem.style.alignItems = 'flex-start';
                    reqItem.style.gap = '5px';
                    
                    const headerDiv = document.createElement('div');
                    headerDiv.style.display = 'flex';
                    headerDiv.style.alignItems = 'center';
                    headerDiv.style.gap = '10px';
                    headerDiv.style.width = '100%';

                    const avatar = document.createElement('div');
                    avatar.className = 'avatar';
                    if (req.avatarUrl) {
                        avatar.style.backgroundImage = `url('${resolveUrl(req.avatarUrl)}')`;
                        avatar.style.backgroundSize = 'cover';
                        avatar.style.backgroundPosition = 'center';
                        avatar.textContent = '';
                    } else {
                        avatar.textContent = req.username.charAt(0).toUpperCase();
                    }
                    
                    const nameDiv = document.createElement('div');
                    nameDiv.style.fontWeight = 'bold';
                    nameDiv.textContent = req.username;

                    headerDiv.appendChild(avatar);
                    headerDiv.appendChild(nameDiv);

                    const actionsDiv = document.createElement('div');
                    actionsDiv.style.display = 'flex';
                    actionsDiv.style.gap = '10px';
                    actionsDiv.style.width = '100%';
                    actionsDiv.style.marginTop = '5px';
                    actionsDiv.style.paddingLeft = '50px'; // Align with name

                    const acceptBtn = document.createElement('button');
                    acceptBtn.textContent = 'Akceptuj';
                    acceptBtn.style.padding = '5px 10px';
                    acceptBtn.style.border = 'none';
                    acceptBtn.style.borderRadius = '4px';
                    acceptBtn.style.backgroundColor = 'var(--accent-green)';
                    acceptBtn.style.color = 'white';
                    acceptBtn.style.cursor = 'pointer';
                    acceptBtn.style.fontSize = '0.8rem';
                    acceptBtn.onclick = (e) => {
                        e.stopPropagation();
                        acceptFriend(req.id);
                    };

                    const rejectBtn = document.createElement('button');
                    rejectBtn.textContent = 'Odrzuć';
                    rejectBtn.style.padding = '5px 10px';
                    rejectBtn.style.border = '1px solid var(--error-color)';
                    rejectBtn.style.borderRadius = '4px';
                    rejectBtn.style.backgroundColor = 'transparent';
                    rejectBtn.style.color = 'var(--error-color)';
                    rejectBtn.style.cursor = 'pointer';
                    rejectBtn.style.fontSize = '0.8rem';
                    rejectBtn.onclick = (e) => {
                        e.stopPropagation();
                        rejectFriend(req.id); // This might need to be req.id (friendshipId) or requesterId depending on API
                    };

                    actionsDiv.appendChild(acceptBtn);
                    actionsDiv.appendChild(rejectBtn);

                    reqItem.appendChild(headerDiv);
                    reqItem.appendChild(actionsDiv);
                    
                    chatList.appendChild(reqItem);
                });
            }

            // Add Groups Section
            if (groups.length > 0) {
                const groupHeader = document.createElement('div');
                groupHeader.textContent = 'Grupy';
                groupHeader.style.padding = '10px 20px';
                groupHeader.style.fontSize = '0.75rem';
                groupHeader.style.fontWeight = 'bold';
                groupHeader.style.color = 'var(--text-secondary)';
                groupHeader.style.textTransform = 'uppercase';
                groupHeader.style.letterSpacing = '1px';
                chatList.appendChild(groupHeader);
                
                groups.forEach(group => {
                    const chatItem = document.createElement('div');
                    chatItem.className = 'chat-item';
                    chatItem.dataset.groupId = group.id;
                    if (currentChatType === 'group' && currentChatId == group.id) {
                        chatItem.classList.add('active');
                    }
                    
                    const avatar = document.createElement('div');
                    avatar.className = 'avatar';
                    {
                        const gAv = group.avatarUrl || group.AvatarUrl;
                        if (gAv) {
                            avatar.style.backgroundImage = `url('${resolveUrl(gAv)}')`;
                            avatar.style.backgroundSize = 'cover';
                            avatar.style.backgroundPosition = 'center';
                            avatar.textContent = '';
                        } else {
                            avatar.textContent = group.name.charAt(0).toUpperCase();
                            avatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                        }
                    }
                    
                    const chatInfo = document.createElement('div');
                    chatInfo.className = 'chat-info';
                    const h4 = document.createElement('h4');
                    h4.textContent = group.name;
                    chatInfo.appendChild(h4);
                    
                    chatItem.appendChild(avatar);
                    chatItem.appendChild(chatInfo);
                    
                    chatItem.addEventListener('click', () => {
                        const gAv = group.avatarUrl || group.AvatarUrl;
                        selectChat(group.id, group.name, gAv, 'group');
                    });
                    
                    chatList.appendChild(chatItem);
                });
            }

            // Add Friends Section
            if (friends.length > 0) {
                const friendHeader = document.createElement('div');
                friendHeader.textContent = 'Znajomi';
                friendHeader.style.padding = '10px 20px';
                friendHeader.style.fontSize = '0.75rem';
                friendHeader.style.fontWeight = 'bold';
                friendHeader.style.color = 'var(--text-secondary)';
                friendHeader.style.textTransform = 'uppercase';
                friendHeader.style.letterSpacing = '1px';
                chatList.appendChild(friendHeader);

                friends.forEach(friend => {
                    const chatItem = document.createElement('div');
                    chatItem.className = 'chat-item';
                    chatItem.dataset.friendId = friend.id;
                    if (currentChatType === 'private' && currentChatId == friend.id) {
                        chatItem.classList.add('active');
                    }
                    
                    const avatar = document.createElement('div');
                    avatar.className = 'avatar';
                    {
                        const fAv = friend.avatarUrl || friend.AvatarUrl;
                        if (fAv) {
                            avatar.style.backgroundImage = `url('${resolveUrl(fAv)}')`;
                            avatar.style.backgroundSize = 'cover';
                            avatar.style.backgroundPosition = 'center';
                            avatar.textContent = '';
                        } else {
                            avatar.textContent = friend.username.charAt(0).toUpperCase();
                        }
                    }
                    
                    const chatInfo = document.createElement('div');
                    chatInfo.className = 'chat-info';
                    const h4 = document.createElement('h4');
                    h4.textContent = friend.username;
                    chatInfo.appendChild(h4);
                    
                    // Online status
                    if (friend.isOnline || friend.IsOnline) {
                        const statusDot = document.createElement('span');
                        statusDot.className = 'status-dot-online';
                        statusDot.textContent = '●';
                        statusDot.style.color = 'var(--accent-green)';
                        statusDot.style.marginLeft = '5px';
                        statusDot.style.fontSize = '12px';
                        statusDot.title = 'Dostępny';
                        
                        // Append to h4 (name)
                        h4.appendChild(statusDot);
                    }
                    
                    // Remove friend button (X)
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'btn-icon';
                    removeBtn.title = 'Usuń znajomego';
                    removeBtn.textContent = '×';
                    removeBtn.style.marginLeft = 'auto';
                    removeBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Usunąć znajomego ${friend.username}?`)) return;
                        try {
                            const response = await fetch(`${API_URL}/friends/${friend.id}`, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            if (response.ok) {
                                showNotification('Znajomy usunięty.', 'success');
                                await loadFriends();
                                updateChatList();
                            } else {
                                await handleApiError(response, 'Nie udało się usunąć znajomego');
                            }
                        } catch (err) {
                            console.error('Error removing friend:', err);
                            showNotification('Wystąpił błąd.', 'error');
                        }
                    };
                    
                    chatItem.appendChild(avatar);
                    chatItem.appendChild(chatInfo);
                    chatItem.appendChild(removeBtn);
                    
                    chatItem.addEventListener('click', () => {
                        const fAv = friend.avatarUrl || friend.AvatarUrl;
                        selectChat(friend.id, friend.username, fAv, 'private');
                    });
                    
                    chatList.appendChild(chatItem);
                });
            }
        }

        function renderPendingRequestsModal() {
            const list = document.getElementById('pendingRequestsList');
            if (!list) return;
            list.innerHTML = '';
            if (!pendingRequests || pendingRequests.length === 0) {
                const empty = document.createElement('div');
                empty.style.color = 'var(--text-muted)';
                empty.style.fontSize = '0.8rem';
                empty.style.width = '100%';
                empty.style.textAlign = 'center';
                empty.textContent = 'Brak zaproszeń.';
                list.appendChild(empty);
                return;
            }
            pendingRequests.forEach(req => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '10px';
                
                const avatar = document.createElement('div');
                avatar.className = 'avatar';
                // Click to show profile
                avatar.style.cursor = 'pointer';
                avatar.onclick = (e) => {
                    e.stopPropagation();
                    const rAv = req.avatarUrl || req.AvatarUrl;
                    const rId = req.requesterId || req.RequesterId;
                    if (rId) {
                        showUserProfile(rId, req.username || 'Użytkownik', rAv, false);
                    }
                };
                {
                    const rAv = req.avatarUrl || req.AvatarUrl;
                    if (rAv) {
                        avatar.style.backgroundImage = `url('${resolveUrl(rAv)}')`;
                        avatar.style.backgroundSize = 'cover';
                        avatar.style.backgroundPosition = 'center';
                        avatar.textContent = '';
                    } else {
                        avatar.textContent = (req.username || 'U').charAt(0).toUpperCase();
                    }
                }
                
                const name = document.createElement('div');
                name.style.flex = '1';
                name.textContent = req.username || `Użytkownik ${req.requesterId}`;
                
                const accept = document.createElement('button');
                accept.className = 'btn-secondary';
                accept.textContent = 'Akceptuj';
                accept.onclick = async () => {
                    try {
                        const response = await fetch(`${API_URL}/friends/accept/${req.id}`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                            showNotification('Zaproszenie zaakceptowane.', 'success');
                            await loadPendingRequests();
                            await loadFriends();
                        } else {
                            await handleApiError(response, 'Nie udało się zaakceptować zaproszenia');
                        }
                    } catch (err) {
                        console.error('Accept error', err);
                        showNotification('Błąd akceptacji zaproszenia.', 'error');
                    }
                };
                
                const reject = document.createElement('button');
                reject.className = 'btn-secondary';
                reject.textContent = 'Odrzuć';
                reject.onclick = async () => {
                    if (!confirm('Odrzucić zaproszenie?')) return;
                    try {
                        const response = await fetch(`${API_URL}/friends/${req.id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                            showNotification('Zaproszenie odrzucone.', 'success');
                            await loadPendingRequests();
                        } else {
                            await handleApiError(response, 'Nie udało się odrzucić zaproszenia');
                        }
                    } catch (err) {
                        console.error('Reject error', err);
                        showNotification('Błąd odrzucania zaproszenia.', 'error');
                    }
                };
                
                row.appendChild(avatar);
                row.appendChild(name);
                row.appendChild(accept);
                row.appendChild(reject);
                
                list.appendChild(row);
            });
        }

        // Update chat selection logic

        function selectChat(chatId, chatName, chatAvatar, type = 'private') {
            currentChatId = chatId;
            currentChatType = type; // Update the chat type
            
            // Persist chat state
            localStorage.setItem('lastChat', JSON.stringify({
                id: chatId,
                name: chatName,
                avatar: chatAvatar,
                type: type
            }));
            
            // Update active chat item
            document.querySelectorAll('.chat-item').forEach(item => {
                item.classList.remove('active');
                if (type === 'group' && item.dataset.groupId == chatId) {
                    item.classList.add('active');
                } else if (type === 'private' && item.dataset.friendId == chatId) {
                    item.classList.add('active');
                } else if (!chatId && item.querySelector('h4')?.textContent === 'Ogólny') {
                    item.classList.add('active');
                }
            });
            
            // Update chat header
            const chatHeader = document.querySelector('.chat-header h3');
            if (chatHeader) {
                chatHeader.textContent = chatName || 'Ogólny';
            }
            
            const headerAvatar = document.querySelector('.chat-header .avatar');
            if (headerAvatar) {
                // Remove old event listeners by cloning
                const newAvatar = headerAvatar.cloneNode(true);
                headerAvatar.parentNode.replaceChild(newAvatar, headerAvatar);
                
                if (chatAvatar) {
                    newAvatar.style.backgroundImage = `url('${resolveUrl(chatAvatar)}')`;
                    newAvatar.style.backgroundSize = 'cover';
                    newAvatar.textContent = '';
                } else {
                    newAvatar.style.backgroundImage = '';
                    newAvatar.textContent = chatName ? chatName.charAt(0).toUpperCase() : 'O';
                }

                // Group Icon Change Logic
                if (type === 'group' && chatId) {
                    const group = groups.find(g => g.id == chatId);
                    const currentUser = JSON.parse(localStorage.getItem('user'));
                    // Check ownership
                    if (group && currentUser && (group.ownerId == currentUser.id || group.OwnerId == currentUser.id)) {
                        newAvatar.style.cursor = 'pointer';
                        newAvatar.title = 'Kliknij, aby zmienić ikonę grupy';
                        
                        // Enable add member button for owner
                        const addMemberBtn = document.getElementById('addGroupMemberBtn');
                        if (addMemberBtn) {
                             addMemberBtn.style.display = 'block';
                        }
                        const deleteGroupBtn = document.getElementById('deleteGroupBtn');
                        if (deleteGroupBtn) {
                            deleteGroupBtn.style.display = 'block';
                            deleteGroupBtn.onclick = async () => {
                                if (!confirm('Usunąć tę grupę?')) return;
                                try {
                                    const response = await fetch(`${API_URL}/groups/${chatId}`, {
                                        method: 'DELETE',
                                        headers: { 'Authorization': `Bearer ${token}` }
                                    });
                                    if (response.ok) {
                                        showNotification('Grupa została usunięta.', 'success');
                                        await loadGroups();
                                        selectChat(null, 'Ogólny', null, 'global');
                                    } else {
                                        await handleApiError(response, 'Nie udało się usunąć grupy');
                                    }
                                } catch (err) {
                                    showNotification('Błąd usuwania grupy.', 'error');
                                }
                            };
                        }
                        
                        newAvatar.onclick = () => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = async (e) => {
                                if (input.files && input.files[0]) {
                                    const formData = new FormData();
                                    formData.append('avatar', input.files[0]);
                                    
                                    try {
                                        showNotification('Wysyłanie ikony...', 'info');
                                        const response = await fetch(`${API_URL}/groups/${chatId}/avatar`, {
                                            method: 'POST',
                                            headers: {
                                                'Authorization': `Bearer ${token}`
                                            },
                                            body: formData
                                        });
                                        
                                        if (response.ok) {
                                            const data = await response.json();
                                            const newUrl = resolveUrl(data.url);
                                            
                                            // Update UI immediately
                                            newAvatar.style.backgroundImage = `url('${newUrl}')`;
                                            newAvatar.style.backgroundSize = 'cover';
                                            newAvatar.textContent = '';
                                            
                                            // Update group data
                                            group.avatarUrl = data.url;
                                            
                                            // Update list item avatar
                                            const listItem = document.querySelector(`.chat-item[data-group-id="${chatId}"] .avatar`);
                                            if (listItem) {
                                                listItem.style.backgroundImage = `url('${newUrl}')`;
                                                listItem.style.backgroundSize = 'cover';
                                                listItem.textContent = '';
                                                listItem.style.background = ''; // clear gradient
                                            }
                                            
                                            // Update localStorage
                                            localStorage.setItem('lastChat', JSON.stringify({
                                                id: chatId,
                                                name: chatName,
                                                avatar: data.url,
                                                type: type
                                            }));

                                            showNotification('Ikona grupy została zmieniona!', 'success');
                                        } else {
                                            await handleApiError(response, 'Błąd zmiany ikony');
                                        }
                                    } catch (err) {
                                        console.error('Error uploading avatar:', err);
                                        showNotification('Wystąpił błąd.', 'error');
                                    }
                                }
                            };
                            input.click();
                        };
                    } else {
                        newAvatar.style.cursor = 'default';
                        newAvatar.title = '';
                        newAvatar.onclick = null;
                        
                        const addMemberBtn = document.getElementById('addGroupMemberBtn');
                        if (addMemberBtn) {
                             addMemberBtn.style.display = 'none';
                        }
                        const deleteGroupBtn = document.getElementById('deleteGroupBtn');
                        if (deleteGroupBtn) {
                            deleteGroupBtn.style.display = 'none';
                            deleteGroupBtn.onclick = null;
                        }
                    }
                } else {
                    newAvatar.style.cursor = 'default';
                    newAvatar.title = '';
                    newAvatar.onclick = null;
                    
                    const addMemberBtn = document.getElementById('addGroupMemberBtn');
                    if (addMemberBtn) {
                         addMemberBtn.style.display = 'none';
                    }
                    const deleteGroupBtn = document.getElementById('deleteGroupBtn');
                    if (deleteGroupBtn) {
                        deleteGroupBtn.style.display = 'none';
                        deleteGroupBtn.onclick = null;
                    }
                }
            }
            
            // Show/hide call buttons (only for private chats)
            const videoCallButton = document.getElementById('videoCallButton');
            const voiceCallButton = document.getElementById('voiceCallButton');
            
            if (videoCallButton) {
                videoCallButton.style.display = (type === 'private' && chatId) ? 'block' : 'none';
            }
            if (voiceCallButton) {
                voiceCallButton.style.display = (type === 'private' && chatId) ? 'block' : 'none';
            }
            
            // Load messages for this chat
            loadPreviousMessages();
        }

        // Global chat click handler
        const globalChatItem = document.getElementById('globalChatItem') || document.querySelector('.chat-item:first-child');
        if (globalChatItem) {
            globalChatItem.addEventListener('click', () => {
                selectChat(null, 'Ogólny', null, 'global');
            });
        }

        // Restore last chat or load default
        const lastChat = localStorage.getItem('lastChat');
        let restored = false;
        if (lastChat) {
            try {
                const { id, name, avatar, type } = JSON.parse(lastChat);
                // We will select chat, which triggers loadPreviousMessages
                selectChat(id, name, avatar, type);
                restored = true;
            } catch (e) {
                console.error('Error parsing lastChat', e);
            }
        }
        
        if (!restored) {
            // Load messages immediately, even before SignalR connects (defaults to global)
            loadPreviousMessages();
        }
        
        // SignalR connection is started at the end of the file to ensure all handlers are registered.
        
        // Load previous messages function
        async function loadPreviousMessages() {
            const messagesContainer = document.getElementById("chat-messages");
            if (messagesContainer) {
                messagesContainer.innerHTML = '<div class="message received"><div class="message-text">Ładowanie wiadomości...</div></div>';
            }

            try {
                // Determine URL based on chat type and ID
                let url = `${API_URL}/messages`;
                if (currentChatType === 'private' && currentChatId) {
                    url = `${API_URL}/messages?receiverId=${currentChatId}`;
                } else if (currentChatType === 'group' && currentChatId) {
                    // Implement group messages endpoint later if needed
                    url = `${API_URL}/messages?groupId=${currentChatId}`;
                }
                
                console.log('Fetching messages from:', url);
                    
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Error loading messages:', response.status, errorText);
                    if (messagesContainer) {
                        messagesContainer.innerHTML = '<div class="message received"><div class="message-text" style="color:red">Błąd ładowania wiadomości.</div></div>';
                    }
                    return;
                }
                
                const messages = await response.json();
                console.log('Loaded messages:', messages?.length || 0);
                
                if (!messagesContainer) {
                    console.error('Messages container not found');
                    return;
                }

                const currentUser = JSON.parse(localStorage.getItem('user'));
                if (!currentUser) {
                    console.error('Current user not found');
                    return;
                }
                
                // Always clear the container first
                messagesContainer.innerHTML = '';
                
                // If no messages, show welcome message
                if (!messages || !Array.isArray(messages) || messages.length === 0) {
                    const welcomeMsg = document.createElement("div");
                    welcomeMsg.className = "message received";
                    welcomeMsg.textContent = "Witaj w Parrotnest! To jest początek twojej konwersacji.";
                    messagesContainer.appendChild(welcomeMsg);
                    return;
                }
                
                messages.forEach(msg => {
                    try {
                        // Ensure we compare usernames correctly (handle both string and object cases)
                        const senderObj = msg.sender || msg.Sender;
                        const senderUsername = typeof senderObj === 'string' ? senderObj : (senderObj?.username || senderObj?.Username || 'Nieznany');
                        const senderAvatarUrl = msg.senderAvatarUrl || msg.SenderAvatarUrl || null;
                        
                        // Use ID for reliable ownership check if available
                        let isOwnMessage = false;
                        const msgSenderId = msg.senderId || msg.SenderId;
                        const currentUserId = currentUser.id || currentUser.Id;
                        
                        if (msgSenderId && currentUserId) {
                            isOwnMessage = parseInt(msgSenderId) === parseInt(currentUserId);
                        } else {
                            const currentUsername = currentUser.username || currentUser.userName || currentUser.email || '';
                            isOwnMessage = senderUsername === currentUsername;
                        }

                        const messageWrapper = document.createElement("div");
                        messageWrapper.className = `message-wrapper ${isOwnMessage ? 'own-message' : ''}`;
                        
                        const row = document.createElement("div");
                        row.className = "message-row";
                        
                        const avatarEl = document.createElement("div");
                        avatarEl.className = "message-avatar";
                        // Profile Click
                        avatarEl.style.cursor = 'pointer';
                        avatarEl.onclick = (e) => {
                            e.stopPropagation();
                            // If senderId is available use it, else try to find user by name or fallback
                            const sId = msg.senderId || msg.SenderId;
                            // Check if own
                            const isOwn = isOwnMessage;
                            
                            if (isOwn) {
                                // For own profile, we might not need ID if we just show static "My Profile" info
                                // But passing ID is safer if we want consistent API.
                                // Current user data:
                                const cUser = JSON.parse(localStorage.getItem('user'));
                                showUserProfile(cUser.id, cUser.username, cUser.avatarUrl, true);
                            } else {
                                if (sId) {
                                    showUserProfile(sId, senderUsername, senderAvatarUrl, false);
                                } else {
                                    // Fallback if no ID (shouldn't happen with DB)
                                    // Try to find in friends list to get ID?
                                    const f = friends.find(fr => fr.username === senderUsername);
                                    if (f) {
                                        showUserProfile(f.id, f.username, f.avatarUrl || f.AvatarUrl, false);
                                    } else {
                                        // Just show basic info without ID (no mutuals fetching possible)
                                        showUserProfile(0, senderUsername, senderAvatarUrl, false);
                                    }
                                }
                            }
                        };

                        if (senderAvatarUrl) {
                            const url = resolveUrl(senderAvatarUrl);
                            avatarEl.style.backgroundImage = `url('${url}')`;
                            avatarEl.textContent = '';
                        } else if (senderUsername) {
                            avatarEl.textContent = senderUsername.charAt(0).toUpperCase();
                        }
                        
                        const msgDiv = document.createElement("div");
                        msgDiv.className = isOwnMessage ? "message sent" : "message received";
                        
                        // Show sender name in global AND group chats for received messages
                        if (!isOwnMessage && (currentChatType === 'global' || currentChatType === 'group')) {
                            const senderName = document.createElement("div");
                            senderName.className = "message-sender";
                            senderName.textContent = senderUsername;
                            messageWrapper.appendChild(senderName);
                        }
                        
                        const imgUrlRaw = msg.imageUrl || msg.ImageUrl;
                        if (imgUrlRaw) {
                            let imgUrl = resolveUrl(imgUrlRaw);
                            const img = document.createElement("img");
                            img.src = imgUrl;
                            img.className = "message-image";
                            img.onclick = () => openLightbox(imgUrl);
                            msgDiv.appendChild(img);
                        }

                        const content = msg.content || msg.Content;
                        if (content && content.trim() !== '') {
                            const messageText = document.createElement("div");
                            messageText.className = "message-text";
                            messageText.textContent = content;
                            msgDiv.appendChild(messageText);
                        }
                        
                        const timestamp = document.createElement("div");
                        timestamp.className = "message-time";
                        const rawDate = msg.timestamp || msg.Timestamp;
                        
                        if (rawDate) {
                            const msgDate = new Date(rawDate);
                            if (!isNaN(msgDate.getTime())) {
                                timestamp.textContent = msgDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
                            } else {
                                timestamp.textContent = "";
                            }
                        } else {
                            timestamp.textContent = "";
                        }
                        msgDiv.appendChild(timestamp);
                        
                        row.appendChild(avatarEl);
                        row.appendChild(msgDiv);
                        messageWrapper.appendChild(row);
                        messagesContainer.appendChild(messageWrapper);
                    } catch (msgError) {
                        console.error('Error processing message:', msgError, msg);
                    }
                });
                    
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                console.log('Messages displayed successfully');
            } catch (error) {
                console.error('Error loading messages:', error);
                // Show error message to user
                const messagesContainer = document.getElementById("chat-messages");
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                    const errorMsg = document.createElement("div");
                    errorMsg.className = "message received";
                    errorMsg.style.color = "var(--error-color)";
                    errorMsg.textContent = "Błąd podczas ładowania wiadomości. Odśwież stronę.";
                    messagesContainer.appendChild(errorMsg);
                }
            }
        }

        // Modal functionality
        const addFriendGroupButton = document.getElementById('addFriendGroupButton');
        const addModal = document.getElementById('addModal');
        const closeModal = document.getElementById('closeModal');
        const tabButtons = document.querySelectorAll('.tab-button');
        const friendTab = document.getElementById('friendTab');
        const groupTab = document.getElementById('groupTab');
        const addFriendBtn = document.getElementById('addFriendBtn');
        const addGroupBtn = document.getElementById('addGroupBtn');

        if (addFriendGroupButton && addModal) {
            addFriendGroupButton.addEventListener('click', () => {
                addModal.classList.add('show');
            });
        }

        if (closeModal) {
            closeModal.addEventListener('click', () => {
                addModal.classList.remove('show');
            });
        }

        // Close modal when clicking outside
        if (addModal) {
            addModal.addEventListener('click', (e) => {
                if (e.target === addModal) {
                    addModal.classList.remove('show');
                }
            });
        }

        // Friend Selection Logic
        function renderFriendSelection(containerId, hiddenInputId) {
            const container = document.getElementById(containerId);
            const hiddenInput = document.getElementById(hiddenInputId);
            if (!container || !hiddenInput) return;

            container.innerHTML = '';
            const selectedUsernames = new Set(hiddenInput.value ? hiddenInput.value.split(',').filter(x => x) : []);

            if (friends.length === 0) {
                container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; width: 100%; text-align: center;">Brak znajomych do wyboru.</div>';
                return;
            }

            friends.forEach(friend => {
                const tile = document.createElement('div');
                tile.className = 'friend-tile';
                if (selectedUsernames.has(friend.username)) {
                    tile.classList.add('selected');
                }
                
                // Avatar
                const avatar = document.createElement('div');
                avatar.className = 'avatar';
                if (friend.avatarUrl) {
                    avatar.style.backgroundImage = `url('${resolveUrl(friend.avatarUrl)}')`;
                    avatar.style.backgroundSize = 'cover';
                    avatar.style.backgroundPosition = 'center';
                } else {
                    avatar.textContent = friend.username.charAt(0).toUpperCase();
                }

                // Name
                const name = document.createElement('span');
                name.textContent = friend.username;
                name.title = friend.username;

                // Check Icon
                const check = document.createElement('div');
                check.className = 'check-icon';
                check.textContent = '✔';

                tile.appendChild(avatar);
                tile.appendChild(name);
                tile.appendChild(check);

                tile.onclick = () => {
                    tile.classList.toggle('selected');
                    if (tile.classList.contains('selected')) {
                        selectedUsernames.add(friend.username);
                    } else {
                        selectedUsernames.delete(friend.username);
                    }
                    hiddenInput.value = Array.from(selectedUsernames).join(',');
                };

                container.appendChild(tile);
            });
        }

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.dataset.tab;
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                if (tab === 'friend') {
                    friendTab.classList.add('active');
                    groupTab.classList.remove('active');
                } else {
                    groupTab.classList.add('active');
                    friendTab.classList.remove('active');
                    renderFriendSelection('friendsSelectionList', 'groupMembers');
                }
            });
        });
        if (addFriendBtn) {
            addFriendBtn.addEventListener('click', async () => {
                const friendInput = document.getElementById('friendUsername');
                const friendValue = friendInput.value.trim();
                
                if (!friendValue) {
                    showNotification('Wpisz nazwę użytkownika lub email', 'error');
                    return;
                }

                try {
                    const response = await fetch(`${API_URL}/friends/add`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ usernameOrEmail: friendValue })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        friendInput.value = '';
                        addModal.classList.remove('show');

                        await loadFriends();

                        if (data.pending) {
                            showNotification('Zaproszenie zostało wysłane. Poczekaj na akceptację użytkownika.', 'success');
                        } else if (data.alreadyFriends) {
                            showNotification(data.message || 'Jesteście już znajomymi.', 'success');

                            if (data.friendId) {
                                selectChat(data.friendId, data.username, data.avatarUrl);
                            }
                        } else {
                             showNotification(data.message || 'Operacja zakończona sukcesem.', 'success');
                        }
                    } else {
                        await handleApiError(response, 'Błąd podczas dodawania znajomego');
                    }
                } catch (error) {
                    console.error('Error adding friend:', error);
                    showNotification('Wystąpił błąd podczas dodawania znajomego.', 'error');
                }
            });
        }

        if (addGroupBtn) {
            addGroupBtn.addEventListener('click', async () => {
                const groupNameInput = document.getElementById('groupName');
                const groupMembersInput = document.getElementById('groupMembers');
                const groupName = groupNameInput ? groupNameInput.value.trim() : '';
                if (!groupName) {
                    showNotification('Wpisz nazwę grupy', 'error');
                    return;
                }
                const members = groupMembersInput ? groupMembersInput.value.trim().split(',').map(m => m.trim()).filter(m => m) : [];
                try {
                    const response = await fetch(`${API_URL}/groups`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ name: groupName, members })
                    });
                    if (response.ok) {
                        const data = await response.json();
                        const groupId = data.groupId;
                        if ((pendingGroupAvatarBlob || (groupAvatarInput && groupAvatarInput.files && groupAvatarInput.files.length > 0)) && groupId) {
                            const formData = new FormData();
                            if (pendingGroupAvatarBlob) {
                                formData.append('avatar', pendingGroupAvatarBlob, 'group_avatar.png');
                            } else {
                                formData.append('avatar', groupAvatarInput.files[0]);
                            }
                            try {
                                await fetch(`${API_URL}/groups/${groupId}/avatar`, {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${token}` },
                                    body: formData
                                });
                            } catch (avatarErr) {
                                console.error('Error uploading group avatar:', avatarErr);
                            }
                        }
                        showNotification('Grupa została utworzona.', 'success');
                        if (groupNameInput) groupNameInput.value = '';
                        if (groupMembersInput) groupMembersInput.value = '';
                        if (groupAvatarInput) groupAvatarInput.value = '';
                        pendingGroupAvatarBlob = null;
                        if (groupAvatarPreview) {
                            groupAvatarPreview.style.backgroundImage = '';
                            groupAvatarPreview.textContent = '';
                        }
                        addModal.classList.remove('show');
                        await loadGroups();
                    } else {
                        await handleApiError(response, 'Nie udało się utworzyć grupy');
                    }
                } catch (error) {
                    console.error('Error creating group:', error);
                    showNotification('Wystąpił błąd podczas tworzenia grupy.', 'error');
                }
            });
        }
        const addGroupMemberBtn = document.getElementById('addGroupMemberBtn');
        const addMemberModal = document.getElementById('addMemberModal');
        const closeAddMemberModal = document.getElementById('closeAddMemberModal');
        const confirmAddMemberBtn = document.getElementById('confirmAddMemberBtn');

        if (addGroupMemberBtn) {
            addGroupMemberBtn.addEventListener('click', () => {
                if (currentChatType !== 'group' || !currentChatId) return;
                
                let hiddenInput = document.getElementById('addMemberHiddenInput');
                if (!hiddenInput) {
                    hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.id = 'addMemberHiddenInput';
                    document.body.appendChild(hiddenInput);
                }
                hiddenInput.value = '';

                renderFriendSelection('addMemberSelectionList', 'addMemberHiddenInput');
                addMemberModal.classList.add('show');
            });
        }

        if (closeAddMemberModal) {
            closeAddMemberModal.addEventListener('click', () => {
                addMemberModal.classList.remove('show');
            });
        }
        
        if (addMemberModal) {
             addMemberModal.addEventListener('click', (e) => {
                if (e.target === addMemberModal) {
                    addMemberModal.classList.remove('show');
                }
            });
        }

        if (confirmAddMemberBtn) {
            confirmAddMemberBtn.addEventListener('click', async () => {
                const hiddenInput = document.getElementById('addMemberHiddenInput');
                const selectedUsernames = hiddenInput ? hiddenInput.value.split(',').filter(x => x) : [];

                if (selectedUsernames.length === 0) {
                    showNotification('Wybierz przynajmniej jedną osobę.', 'warning');
                    return;
                }

                try {
                    const response = await fetch(`${API_URL}/groups/${currentChatId}/members`, {
                        method: 'POST',
                        headers: {
                             'Content-Type': 'application/json',
                             'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(selectedUsernames)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        showNotification(data.message || 'Dodano członków do grupy.', 'success');
                        addMemberModal.classList.remove('show');
                    } else {
                        await handleApiError(response, 'Nie udało się dodać członków');
                    }
                } catch (error) {
                    console.error('Error adding members:', error);
                    showNotification('Wystąpił błąd.', 'error');
                }
            });
        }

        const settingsButton = document.getElementById('settingsButton');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettingsModal = document.getElementById('closeSettingsModal');
        const changeAvatarBtn = document.getElementById('changeAvatarBtn');
        const avatarInput = document.getElementById('avatarInput');
        const settingsForm = document.getElementById('settingsForm');
        const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
        const settingsUsername = document.getElementById('settingsUsername');
        const settingsEmail = document.getElementById('settingsEmail');

        if (settingsButton && settingsModal) {
            settingsButton.addEventListener('click', async () => {
                settingsModal.classList.add('show');
                await loadUserData();
            });
        }


        if (closeSettingsModal) {
            closeSettingsModal.addEventListener('click', () => {
                settingsModal.classList.remove('show');
            });
        }


        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                if (e.target === settingsModal) {
                    settingsModal.classList.remove('show');
                }
            });
        }


        async function loadUserData() {
            try {
                const response = await fetch(`${API_URL}/users/me`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    const user = await response.json();
                    if (settingsUsername) settingsUsername.value = user.username;
                    if (settingsEmail) settingsEmail.value = user.email;
                    
                    {
                        const uAv = user.avatarUrl || user.AvatarUrl;
                        if (uAv) {
                            settingsAvatarPreview.style.backgroundImage = `url('${resolveUrl(uAv)}')`;
                            settingsAvatarPreview.textContent = '';
                        } else {
                            settingsAvatarPreview.style.backgroundImage = '';
                            settingsAvatarPreview.textContent = user.username.charAt(0).toUpperCase();
                            settingsAvatarPreview.style.display = 'flex';
                            settingsAvatarPreview.style.alignItems = 'center';
                            settingsAvatarPreview.style.justifyContent = 'center';
                            settingsAvatarPreview.style.fontSize = '2rem';
                            settingsAvatarPreview.style.color = 'var(--text-primary)';
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading user data:', error);
            }
        }

        // Change Avatar Button
        if (changeAvatarBtn && avatarInput) {
            changeAvatarBtn.addEventListener('click', () => {
                avatarInput.click();
            });
        }



        async function uploadUserAvatar(blob) {
            const formData = new FormData();
            formData.append('file', blob);

            try {
                const response = await fetch(`${API_URL}/users/avatar`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                if (response.ok) {
                    const data = await response.json();
                    // Update preview
                    settingsAvatarPreview.style.backgroundImage = `url('${resolveUrl(data.url)}')`;
                    settingsAvatarPreview.textContent = '';
                    
                    // Update main avatar immediately
                    const mainAvatar = document.getElementById('userAvatar');
                    if (mainAvatar) {
                        mainAvatar.style.backgroundImage = `url('${resolveUrl(data.url)}')`;
                        mainAvatar.textContent = '';
                    }
                    
                    // Update local storage
                    const currentUser = JSON.parse(localStorage.getItem('user'));
                    currentUser.avatarUrl = data.url;
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    
                    showNotification('Zdjęcie profilowe zostało zaktualizowane.', 'success');
                } else {
                    await handleApiError(response, 'Błąd aktualizacji zdjęcia');
                }
            } catch (error) {
                console.error('Error uploading avatar:', error);
                showNotification('Wystąpił błąd podczas wysyłania zdjęcia.', 'error');
            }
        }



        // Handle Avatar File Selection
        if (avatarInput) {
            avatarInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    // Direct upload without cropping
                    uploadUserAvatar(file);
                }
            });
        }

        // Handle Settings Form Submit
        if (settingsForm) {
            settingsForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const newUsername = settingsUsername.value.trim();
                const newPassword = document.getElementById('settingsPassword').value;
                
                const updateData = {};
                if (newUsername) updateData.username = newUsername;
                if (newPassword) updateData.password = newPassword;

                try {
                    const response = await fetch(`${API_URL}/users/profile`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(updateData)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        
                        // Update local storage
                        const currentUser = JSON.parse(localStorage.getItem('user'));
                        currentUser.username = data.user.username;
                        localStorage.setItem('user', JSON.stringify(currentUser));
                        
                        // Update UI
                        const userNameEl = document.getElementById('userName');
                        if (userNameEl) userNameEl.textContent = data.user.username;
                        
                        showNotification('Profil został zaktualizowany.', 'success');
                        settingsModal.classList.remove('show');
                        document.getElementById('settingsPassword').value = ''; // Clear password field
                    } else {
                        await handleApiError(response, 'Błąd aktualizacji profilu');
                    }
                } catch (error) {
                    console.error('Error updating profile:', error);
                    showNotification('Wystąpił błąd podczas aktualizacji profilu.', 'error');
                }
            });
        }

        const logoutButton = document.getElementById('logoutButton');
        if (logoutButton) {
            logoutButton.addEventListener('click', () => {
                if (confirm('Czy na pewno chcesz się wylogować?')) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.href = '/';
                }
            });
        }

        // Add Friend/Group Modal Logic - already initialized above
        
        // Ensure event listeners are attached if not already done
        if (addFriendGroupButton) {
            // Remove old listener to avoid duplicates if possible, or just rely on the fact that this code runs once
             addFriendGroupButton.onclick = () => {
                if (addModal) addModal.classList.add('show');
            };
        }

        // Tab switching logic is unique here
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                button.classList.add('active');
                const tabId = button.dataset.tab + 'Tab';
                document.getElementById(tabId).classList.add('active');
            });
        });



        // User Profile Logic
        const userProfileModal = document.getElementById('userProfileModal');
        const closeUserProfileModal = document.getElementById('closeUserProfileModal');

        if (closeUserProfileModal && userProfileModal) {
            closeUserProfileModal.onclick = () => {
                userProfileModal.classList.remove('show');
            };
            // Close on click outside
            userProfileModal.addEventListener('click', (e) => {
                if (e.target === userProfileModal) {
                    userProfileModal.classList.remove('show');
                }
            });
        }

        async function showUserProfile(userId, username, avatarUrl, isOwnProfile = false) {
            if (!userProfileModal) return;

            const avatarEl = document.getElementById('profileAvatar');
            const usernameEl = document.getElementById('profileUsername');
            const statusEl = document.getElementById('profileStatus');
            const mutualsSection = document.getElementById('profileMutualsSection');
            const mutualsList = document.getElementById('profileMutualFriendsList');
            const serversList = document.getElementById('profileCommonServersList');

            // Reset content
            usernameEl.textContent = username;
            
            // Set Avatar
            if (avatarUrl) {
                avatarEl.style.backgroundImage = `url('${resolveUrl(avatarUrl)}')`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.textContent = '';
            } else {
                avatarEl.style.backgroundImage = 'none';
                avatarEl.textContent = username.charAt(0).toUpperCase();
                // Ensure default styling matches
                avatarEl.style.backgroundColor = 'var(--accent-color)';
                avatarEl.style.display = 'flex';
                avatarEl.style.alignItems = 'center';
                avatarEl.style.justifyContent = 'center';
                avatarEl.style.color = 'white';
                avatarEl.style.fontSize = '2rem';
            }

            // Status
            // Try to find status from friends list if possible
            let status = 'Niedostępny';
            const friend = friends.find(f => (f.id == userId) || (f.Id == userId));
            if (friend && (friend.isOnline || friend.IsOnline)) {
                status = 'Dostępny';
                statusEl.style.color = 'var(--accent-green)';
            } else if (isOwnProfile) {
                 status = 'Twój profil'; // Or fetch current status
                 statusEl.style.color = 'var(--text-color)';
            } else {
                statusEl.style.color = 'var(--text-muted)';
            }
            statusEl.textContent = status;

            // Mutuals & Commons
            if (isOwnProfile) {
                mutualsSection.style.display = 'none';
            } else {
                mutualsSection.style.display = 'block';
                mutualsList.innerHTML = '<div style="padding:10px;">Ładowanie...</div>';
                serversList.innerHTML = '<div style="padding:10px;">Ładowanie...</div>';

                // Fetch Mutual Friends
                try {
                    const res = await fetch(`${API_URL}/friends/mutual/${userId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const mutuals = await res.json();
                        renderProfileList(mutualsList, mutuals, 'Brak wspólnych znajomych.');
                    } else {
                        mutualsList.innerHTML = '<div style="color:var(--error-color)">Błąd ładowania</div>';
                    }
                } catch (e) {
                    console.error(e);
                    mutualsList.innerHTML = '<div style="color:var(--error-color)">Błąd</div>';
                }

                // Fetch Common Servers
                try {
                    const res = await fetch(`${API_URL}/groups/common/${userId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const commons = await res.json();
                        renderProfileList(serversList, commons, 'Brak wspólnych serwerów.');
                    } else {
                        serversList.innerHTML = '<div style="color:var(--error-color)">Błąd ładowania</div>';
                    }
                } catch (e) {
                    console.error(e);
                    serversList.innerHTML = '<div style="color:var(--error-color)">Błąd</div>';
                }
            }

            userProfileModal.classList.add('show');
        }

        function renderProfileList(container, items, emptyText) {
            container.innerHTML = '';
            if (!items || items.length === 0) {
                container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.9rem;">${emptyText}</div>`;
                return;
            }

            items.forEach(item => {
                const tile = document.createElement('div');
                tile.className = 'friend-tile'; // Reuse existing class for styling
                tile.style.cursor = 'default';
                tile.style.minWidth = '80px';
                
                const av = document.createElement('div');
                av.className = 'avatar';
                const url = item.avatarUrl || item.AvatarUrl;
                const name = item.username || item.Username || item.name || item.Name;
                
                if (url) {
                    av.style.backgroundImage = `url('${resolveUrl(url)}')`;
                    av.style.backgroundSize = 'cover';
                    av.style.backgroundPosition = 'center';
                } else {
                    av.textContent = name.charAt(0).toUpperCase();
                }

                const label = document.createElement('span');
                label.textContent = name;
                label.style.fontSize = '0.8rem';
                label.style.overflow = 'hidden';
                label.style.textOverflow = 'ellipsis';
                label.style.whiteSpace = 'nowrap';
                label.style.maxWidth = '100%';

                tile.appendChild(av);
                tile.appendChild(label);
                container.appendChild(tile);
            });
        }

        // WebRTC Call functionality removed

        // Start SignalR Connection with retry logic
        async function startConnection() {
            try {
                if (!signalRAvailable) return;
                if (connection.state === signalR.HubConnectionState.Disconnected) {
                    await connection.start();
                    console.log("SignalR Connected.");
                    // Load data after successful connection
                    loadFriends();
                    loadGroups();
                }
            } catch (err) {
                console.error("SignalR Connection Error: ", err);
                // Retry after 5 seconds
                setTimeout(startConnection, 5000);
            }
        }

        connection.onclose(async () => {
            console.log("SignalR Connection Closed. Reconnecting...");
            await startConnection();
        });


        loadFriends();
        loadGroups();

        await startConnection();
        
        setInterval(() => {
            loadPendingRequests();
            loadFriends();
            loadGroups();
        }, 5000);

        const imageModal = document.getElementById('image-modal');
        const modalImg = document.getElementById("img-preview");
        const closeImageModal = document.getElementsByClassName("close-image-modal")[0];

        function openLightbox(src) {
            if (imageModal && modalImg) {
                imageModal.style.display = "flex";
                // Small delay to allow display:flex to apply before opacity transition
                setTimeout(() => {
                    imageModal.style.opacity = "1";
                }, 10);
                modalImg.src = src;
            }
        }

        if (closeImageModal) {
            closeImageModal.onclick = function() {
                if (imageModal) {
                    imageModal.style.opacity = "0";
                    setTimeout(() => {
                        imageModal.style.display = "none";
                    }, 300);
                }
            }
        }

        if (imageModal) {
            imageModal.onclick = function(e) {
                if (e.target === imageModal) {
                    imageModal.style.opacity = "0";
                    setTimeout(() => {
                        imageModal.style.display = "none";
                    }, 300);
                }
            }
        }

    })();
}
