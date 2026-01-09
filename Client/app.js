(() => {
    let serverBase;
    let apiUrl;
    if (window.location.protocol === 'file:') {
        serverBase = 'http://localhost:6069';
    } else {
        serverBase = window.location.origin;
    }
    apiUrl = `${serverBase}/api`;
    window.__SERVER_BASE_DEFAULT__ = serverBase;
    window.__API_URL_DEFAULT__ = apiUrl;
})();
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '0.0.0.0';
let storedBase = localStorage.getItem('serverBase');

if (!isLocal) {
    if (storedBase) {
        localStorage.removeItem('serverBase');
        storedBase = null;
    }
} else if (storedBase) {
    const port = '6069';
    const expectedLocalPort = `:${port}`;
    if (!storedBase.includes(expectedLocalPort)) {
        localStorage.removeItem('serverBase');
        storedBase = null;
    }
}
const SERVER_BASE = (storedBase || window.__SERVER_BASE_DEFAULT__).replace(/\/+$/,'');
const API_URL = window.__API_URL_DEFAULT__ || `${SERVER_BASE}/api`;
const HUB_URL = `${SERVER_BASE}/chatHub`;
function resolveUrl(url) {
    if (!url) return null;
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    url = url.replace(/\\/g, '/');
    if (!url.startsWith('/')) {
        url = '/' + url;
    }
    if (url.startsWith('/uploads/')) {
        const baseUrl = API_URL.replace(/\/api$/, '');
        return `${baseUrl}${url}`;
    }
    if (url.startsWith('/')) {
        const baseUrl = API_URL.replace(/\/api$/, '');
        return `${baseUrl}${url}`;
    }
    return url;
}
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
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}
async function handleApiError(response, defaultMessage = 'WystÄ…piĹ‚ bĹ‚Ä…d') {
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
                showNotification('Zalogowano pomyĹ›lnie.', 'success');
                setTimeout(() => {
                    window.location.href = 'index.php';
                }, 800);
            } else {
                await handleApiError(response, 'Logowanie nieudane');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('WystÄ…piĹ‚ bĹ‚Ä…d podczas logowania.', 'error');
        }
    });
}
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        if (password !== confirmPassword) {
            showNotification('HasĹ‚a nie sÄ… identyczne!', 'error');
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
                showNotification('Rejestracja udana! MoĹĽesz siÄ™ teraz zalogowaÄ‡.', 'success');
                setTimeout(() => {
                    window.location.href = 'login.php';
                }, 1500);
            } else {
                await handleApiError(response, 'Rejestracja nieudana');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('WystÄ…piĹ‚ bĹ‚Ä…d podczas rejestracji.', 'error');
        }
    });
}
const messageInput = document.getElementById('messageInput');
if (messageInput) {
    (async function() {
        let signalRAvailable = typeof signalR !== 'undefined';
        if (!signalRAvailable) {
            console.warn('SignalR library not loaded â€“ funkcje czatu ograniczone, ale UI dziaĹ‚a.');
            showNotification('Brak poĹ‚Ä…czenia z serwerem czatu. PrĂłba ponownego poĹ‚Ä…czenia...', 'warning');
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
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
        let selectedImageFile = null;
        let pendingGroupAvatarBlob = null;
        let currentChatId = null;
        let currentChatType = 'global';
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
                showNotification('BĹ‚Ä…d inicjalizacji poĹ‚Ä…czenia.', 'error');
            }
            loadFriends();
            loadGroups();
            loadPendingRequests();
        } else {
            console.log("SignalR connection already initialized");
        }
        const connection = window.connection;
        const messageForm = document.getElementById('messageForm');
        const imageInput = document.getElementById('imageInput');
        const attachmentPreview = document.getElementById('attachmentPreview');
        const attachButton = document.getElementById('attachButton');
        const userStatusEl = document.getElementById('userStatus');
        const notificationBell = document.getElementById('notificationButton');
        let notificationsMuted = localStorage.getItem('notificationsMuted') === 'true';
        if (notificationBell) {
            notificationBell.textContent = notificationsMuted ? 'đź”•' : 'đź””';
            notificationBell.addEventListener('click', () => {
                notificationsMuted = !notificationsMuted;
                localStorage.setItem('notificationsMuted', notificationsMuted ? 'true' : 'false');
                notificationBell.textContent = notificationsMuted ? 'đź”•' : 'đź””';
                showNotification(notificationsMuted ? 'Powiadomienia wyĹ‚Ä…czone' : 'Powiadomienia wĹ‚Ä…czone', 'info');
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
        window.logoAudio = window.logoAudio || new Audio('parrot.mp3');
        if (!window.logoAudioConfigured) {
            window.logoAudio.addEventListener('ended', () => {
                window.logoAudioPlaying = false;
                window.logoAudio.currentTime = 0;
            });
            window.logoAudioConfigured = true;
        }
        const logoContainer = document.getElementById('logoContainer');
        if (logoContainer) {
            logoContainer.onclick = () => {
                if (window.logoAudioPlaying) return;
                window.logoAudioPlaying = true;
                window.logoAudio.currentTime = 0;
                window.logoAudio.play().catch(() => {
                    window.logoAudioPlaying = false;
                });
            };
        }
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
                            <button type="button" class="btn-icon attachment-remove" title="UsuĹ„">Ă—</button>
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
                            showNotification('Nie udaĹ‚o siÄ™ wysĹ‚aÄ‡ obrazka.', 'error');
                            return;
                        }
                    } catch (err) {
                        console.error('Error uploading file:', err);
                        showNotification('BĹ‚Ä…d podczas wysyĹ‚ania pliku.', 'error');
                        return;
                    }
                }
                if (message || imageUrl) {
                    try {
                        if (!signalRAvailable || !connection || connection.state !== signalR.HubConnectionState.Connected) {
                            console.warn('SignalR not connected. State:', connection.state);
                            showNotification('PoĹ‚Ä…czenie z serwerem nie jest aktywne. Poczekaj chwilÄ™.', 'error');
                            return;
                        }
                        const senderName = user.username || user.userName || user.email || 'Nieznany';
                        const chatIdInt = currentChatId ? parseInt(currentChatId) : null;
                        if (currentChatType === 'group') {
                            await connection.invoke("SendMessage", senderName, message, imageUrl, null, chatIdInt);
                        } else if (currentChatType === 'private') {
                            await connection.invoke("SendMessage", senderName, message, imageUrl, chatIdInt, null);
                        } else {
                            await connection.invoke("SendMessage", senderName, message, imageUrl, null, null);
                        }
                        input.value = '';
                        selectedImageFile = null;
                        if (imageInput) imageInput.value = '';
                        if (attachmentPreview) {
                            attachmentPreview.style.display = 'none';
                            attachmentPreview.textContent = '';
                        }
                    } catch (err) {
                        console.error('BĹ‚Ä…d wysyĹ‚ania wiadomoĹ›ci:', err);
                        showNotification('Nie udaĹ‚o siÄ™ wysĹ‚aÄ‡ wiadomoĹ›ci.', 'error');
                    }
                }
            });
        }
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) {
            userNameEl.textContent = user.username || 'UĹĽytkownik';
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
        connection.on("UserStatusChanged", (userId, isOnline) => {
            console.log(`User ${userId} status changed: ${isOnline}`);
            const friendIndex = friends.findIndex(f => f.id == userId || f.Id == userId);
            if (friendIndex !== -1) {
                friends[friendIndex].isOnline = isOnline;
                friends[friendIndex].IsOnline = isOnline;
                updateChatList();
            }
        });
        connection.on("GroupMembershipChanged", async (action, group) => {
            try {
                await loadGroups();
                if (action === 'added') {
                    showNotification(`DoĹ‚Ä…czono do grupy: ${group?.Name || group?.name}`, 'success');
                } else if (action === 'removed') {
                    showNotification(`UsuniÄ™to z grupy: ${group?.Name || group?.name}`, 'info');
                    const last = localStorage.getItem('lastChat');
                    if (last) {
                        const { id, type } = JSON.parse(last);
                        if (type === 'group' && id == group?.Id) {
                            selectChat(null, 'OgĂłlny', null, 'global');
                        }
                    }
                } else if (action === 'updated') {
                    showNotification(`Zaktualizowano grupÄ™: ${group?.Name || group?.name}`, 'info');
                }
            } catch (e) {
                console.error('GroupMembershipChanged handler error', e);
            }
        });
        connection.on("ReceiveMessage", (senderId, senderUsername, message, imageUrl, receiverId, groupId, senderAvatarUrl) => {
            if (imageUrl) {
                imageUrl = resolveUrl(imageUrl);
            }
            let shouldShow = false;
            const currentUser = JSON.parse(localStorage.getItem('user'));
            const currentUserId = currentUser.id || currentUser.Id;
            const isOwnMessage = parseInt(senderId) === parseInt(currentUserId);
            if (groupId) {
                if (currentChatType === 'group' && currentChatId == groupId) {
                    shouldShow = true;
                }
            } else if (receiverId) {
                if (currentChatType === 'private') {
                     if (isOwnMessage) {
                         shouldShow = (currentChatId == receiverId);
                     } else {
                         shouldShow = (currentChatId == senderId);
                     }
                }
            } else {
                if (currentChatType === 'global') {
                    shouldShow = true;
                }
            }
            if (!isOwnMessage) {
                if (!notificationsMuted) {
                    notificationSound.play().catch(e => console.log('Sound play error:', e));
                }
                if (document.hidden || !shouldShow) {
                    if (Notification.permission === "granted") {
                        new Notification(`Nowa wiadomoĹ›Ä‡ od ${senderUsername}`, {
                            body: message || (imageUrl ? "PrzesĹ‚ano zdjÄ™cie" : "Nowa wiadomoĹ›Ä‡"),
                            icon: 'parrot.png'
                        });
                    }
                    if (document.hidden) {
                        if (!titleInterval) {
                            let isOriginal = false;
                            titleInterval = setInterval(() => {
                                document.title = isOriginal ? originalTitle : "Nowa wiadomoĹ›Ä‡!";
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
            if (imageUrl) {
                const img = document.createElement("img");
                img.src = imageUrl;
                img.className = "message-image";
                img.onclick = () => openLightbox(imageUrl);
                msgDiv.appendChild(img);
            }
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
            console.log("Received signal from", user, signalData);
        });
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
                    await handleApiError(response, 'BĹ‚Ä…d pobierania listy znajomych');
                }
            } catch (error) {
                console.error('Error loading friends:', error);
                showNotification('Brak poĹ‚Ä…czenia z bazÄ… lub serwerem (znajomi).', 'error');
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
                    await handleApiError(response, 'BĹ‚Ä…d pobierania grup');
                }
            } catch (error) {
                console.error('Error loading groups:', error);
                showNotification('Brak poĹ‚Ä…czenia z bazÄ… lub serwerem (grupy).', 'error');
            }
        }
        function updateNotificationBadge() {
            const badge = document.getElementById('notificationBadge');
            if (!badge) return;
            const count = pendingRequests.length;
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
                    await handleApiError(response, 'BĹ‚Ä…d pobierania zaproszeĹ„');
                }
            } catch (error) {
                console.error('Error loading pending requests:', error);
                showNotification('Brak poĹ‚Ä…czenia z bazÄ… lub serwerem (zaproszenia).', 'error');
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
                    loadPendingRequests();
                    loadFriends();
                } else {
                    showNotification('Nie udaĹ‚o siÄ™ zaakceptowaÄ‡ zaproszenia.', 'error');
                }
            } catch (error) {
                console.error('Error accepting friend:', error);
            }
        }
        async function rejectFriend(friendshipId) {
            if (!confirm('Czy na pewno chcesz odrzuciÄ‡ to zaproszenie?')) return;
            try {
                const response = await fetch(`${API_URL}/friends/${friendshipId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (response.ok) {
                    loadPendingRequests();
                } else {
                    showNotification('Nie udaĹ‚o siÄ™ odrzuciÄ‡ zaproszenia.', 'error');
                }
            } catch (error) {
                console.error('Error rejecting friend:', error);
            }
        }
        function updateChatList() {
            const chatList = document.querySelector('.chat-list');
            if (!chatList) return;
            const items = Array.from(chatList.children);
            items.forEach(item => {
                const h4 = item.querySelector('h4');
                if (item.classList.contains('chat-item') && h4 && h4.textContent === 'OgĂłlny') {
                } else {
                    item.remove();
                }
            });
            if (pendingRequests.length > 0) {
                const pendingHeader = document.createElement('div');
                pendingHeader.textContent = 'OczekujÄ…ce zaproszenia';
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
                    actionsDiv.style.paddingLeft = '50px';
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
                    rejectBtn.textContent = 'OdrzuÄ‡';
                    rejectBtn.style.padding = '5px 10px';
                    rejectBtn.style.border = '1px solid var(--error-color)';
                    rejectBtn.style.borderRadius = '4px';
                    rejectBtn.style.backgroundColor = 'transparent';
                    rejectBtn.style.color = 'var(--error-color)';
                    rejectBtn.style.cursor = 'pointer';
                    rejectBtn.style.fontSize = '0.8rem';
                    rejectBtn.onclick = (e) => {
                        e.stopPropagation();
                        rejectFriend(req.id);
                    };
                    actionsDiv.appendChild(acceptBtn);
                    actionsDiv.appendChild(rejectBtn);
                    reqItem.appendChild(headerDiv);
                    reqItem.appendChild(actionsDiv);
                    chatList.appendChild(reqItem);
                });
            }
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
                    if (friend.isOnline || friend.IsOnline) {
                        const statusDot = document.createElement('span');
                        statusDot.className = 'status-dot-online';
                        statusDot.textContent = 'â—Ź';
                        statusDot.style.color = 'var(--accent-green)';
                        statusDot.style.marginLeft = '5px';
                        statusDot.style.fontSize = '12px';
                        statusDot.title = 'DostÄ™pny';
                        h4.appendChild(statusDot);
                    }
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'btn-icon';
                    removeBtn.title = 'UsuĹ„ znajomego';
                    removeBtn.textContent = 'Ă—';
                    removeBtn.style.marginLeft = 'auto';
                    removeBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm(`UsunÄ…Ä‡ znajomego ${friend.username}?`)) return;
                        try {
                            const response = await fetch(`${API_URL}/friends/${friend.id}`, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            if (response.ok) {
                                showNotification('Znajomy usuniÄ™ty.', 'success');
                                await loadFriends();
                                updateChatList();
                            } else {
                                await handleApiError(response, 'Nie udaĹ‚o siÄ™ usunÄ…Ä‡ znajomego');
                            }
                        } catch (err) {
                            console.error('Error removing friend:', err);
                            showNotification('WystÄ…piĹ‚ bĹ‚Ä…d.', 'error');
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
                empty.textContent = 'Brak zaproszeĹ„.';
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
                avatar.style.cursor = 'pointer';
                avatar.onclick = (e) => {
                    e.stopPropagation();
                    const rAv = req.avatarUrl || req.AvatarUrl;
                    const rId = req.requesterId || req.RequesterId;
                    if (rId) {
                        showUserProfile(rId, req.username || 'UĹĽytkownik', rAv, false);
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
                name.textContent = req.username || `UĹĽytkownik ${req.requesterId}`;
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
                            await handleApiError(response, 'Nie udaĹ‚o siÄ™ zaakceptowaÄ‡ zaproszenia');
                        }
                    } catch (err) {
                        console.error('Accept error', err);
                        showNotification('BĹ‚Ä…d akceptacji zaproszenia.', 'error');
                    }
                };
                const reject = document.createElement('button');
                reject.className = 'btn-secondary';
                reject.textContent = 'OdrzuÄ‡';
                reject.onclick = async () => {
                    if (!confirm('OdrzuciÄ‡ zaproszenie?')) return;
                    try {
                        const response = await fetch(`${API_URL}/friends/${req.id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                            showNotification('Zaproszenie odrzucone.', 'success');
                            await loadPendingRequests();
                        } else {
                            await handleApiError(response, 'Nie udaĹ‚o siÄ™ odrzuciÄ‡ zaproszenia');
                        }
                    } catch (err) {
                        console.error('Reject error', err);
                        showNotification('BĹ‚Ä…d odrzucania zaproszenia.', 'error');
                    }
                };
                row.appendChild(avatar);
                row.appendChild(name);
                row.appendChild(accept);
                row.appendChild(reject);
                list.appendChild(row);
            });
        }
        function selectChat(chatId, chatName, chatAvatar, type = 'private') {
            currentChatId = chatId;
            currentChatType = type;
            localStorage.setItem('lastChat', JSON.stringify({
                id: chatId,
                name: chatName,
                avatar: chatAvatar,
                type: type
            }));
            document.querySelectorAll('.chat-item').forEach(item => {
                item.classList.remove('active');
                if (type === 'group' && item.dataset.groupId == chatId) {
                    item.classList.add('active');
                } else if (type === 'private' && item.dataset.friendId == chatId) {
                    item.classList.add('active');
                } else if (!chatId && item.querySelector('h4')?.textContent === 'OgĂłlny') {
                    item.classList.add('active');
                }
            });
            const chatHeader = document.querySelector('.chat-header h3');
            if (chatHeader) {
                chatHeader.textContent = chatName || 'OgĂłlny';
            }
            const headerAvatar = document.querySelector('.chat-header .avatar');
            if (headerAvatar) {
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
                if (type === 'group' && chatId) {
                    const group = groups.find(g => g.id == chatId);
                    const currentUser = JSON.parse(localStorage.getItem('user'));
                    if (group && currentUser && (group.ownerId == currentUser.id || group.OwnerId == currentUser.id)) {
                        newAvatar.style.cursor = 'pointer';
                        newAvatar.title = 'Kliknij, aby zmieniÄ‡ ikonÄ™ grupy';
                        const addMemberBtn = document.getElementById('addGroupMemberBtn');
                        if (addMemberBtn) {
                             addMemberBtn.style.display = 'block';
                        }
                        const deleteGroupBtn = document.getElementById('deleteGroupBtn');
                        if (deleteGroupBtn) {
                            deleteGroupBtn.style.display = 'block';
                            deleteGroupBtn.onclick = async () => {
                                if (!confirm('UsunÄ…Ä‡ tÄ™ grupÄ™?')) return;
                                try {
                                    const response = await fetch(`${API_URL}/groups/${chatId}`, {
                                        method: 'DELETE',
                                        headers: { 'Authorization': `Bearer ${token}` }
                                    });
                                    if (response.ok) {
                                        showNotification('Grupa zostaĹ‚a usuniÄ™ta.', 'success');
                                        await loadGroups();
                                        selectChat(null, 'OgĂłlny', null, 'global');
                                    } else {
                                        await handleApiError(response, 'Nie udaĹ‚o siÄ™ usunÄ…Ä‡ grupy');
                                    }
                                } catch (err) {
                                    showNotification('BĹ‚Ä…d usuwania grupy.', 'error');
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
                                        showNotification('WysyĹ‚anie ikony...', 'info');
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
                                            newAvatar.style.backgroundImage = `url('${newUrl}')`;
                                            newAvatar.style.backgroundSize = 'cover';
                                            newAvatar.textContent = '';
                                            group.avatarUrl = data.url;
                                            const listItem = document.querySelector(`.chat-item[data-group-id="${chatId}"] .avatar`);
                                            if (listItem) {
                                                listItem.style.backgroundImage = `url('${newUrl}')`;
                                                listItem.style.backgroundSize = 'cover';
                                                listItem.textContent = '';
                                                listItem.style.background = '';
                                            }
                                            localStorage.setItem('lastChat', JSON.stringify({
                                                id: chatId,
                                                name: chatName,
                                                avatar: data.url,
                                                type: type
                                            }));
                                            showNotification('Ikona grupy zostaĹ‚a zmieniona!', 'success');
                                        } else {
                                            await handleApiError(response, 'BĹ‚Ä…d zmiany ikony');
                                        }
                                    } catch (err) {
                                        console.error('Error uploading avatar:', err);
                                        showNotification('WystÄ…piĹ‚ bĹ‚Ä…d.', 'error');
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
            const videoCallButton = document.getElementById('videoCallButton');
            const voiceCallButton = document.getElementById('voiceCallButton');
            if (videoCallButton) {
                videoCallButton.style.display = (type === 'private' && chatId) ? 'block' : 'none';
            }
            if (voiceCallButton) {
                voiceCallButton.style.display = (type === 'private' && chatId) ? 'block' : 'none';
            }
            loadPreviousMessages();
        }
        const globalChatItem = document.getElementById('globalChatItem') || document.querySelector('.chat-item:first-child');
        if (globalChatItem) {
            globalChatItem.addEventListener('click', () => {
                selectChat(null, 'OgĂłlny', null, 'global');
            });
        }
        const lastChat = localStorage.getItem('lastChat');
        let restored = false;
        if (lastChat) {
            try {
                const { id, name, avatar, type } = JSON.parse(lastChat);
                selectChat(id, name, avatar, type);
                restored = true;
            } catch (e) {
                console.error('Error parsing lastChat', e);
            }
        }
        if (!restored) {
            loadPreviousMessages();
        }
        async function loadPreviousMessages() {
            const messagesContainer = document.getElementById("chat-messages");
            if (messagesContainer) {
                messagesContainer.innerHTML = '<div class="message received"><div class="message-text">Ĺadowanie wiadomoĹ›ci...</div></div>';
            }
            try {
                let url = `${API_URL}/messages`;
                if (currentChatType === 'private' && currentChatId) {
                    url = `${API_URL}/messages?receiverId=${currentChatId}`;
                } else if (currentChatType === 'group' && currentChatId) {
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
                        messagesContainer.innerHTML = '<div class="message received"><div class="message-text" style="color:red">BĹ‚Ä…d Ĺ‚adowania wiadomoĹ›ci.</div></div>';
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
                messagesContainer.innerHTML = '';
                if (!messages || !Array.isArray(messages) || messages.length === 0) {
                    const welcomeMsg = document.createElement("div");
                    welcomeMsg.className = "message received";
                    welcomeMsg.textContent = "Witaj w Parrotnest! To jest poczÄ…tek twojej konwersacji.";
                    messagesContainer.appendChild(welcomeMsg);
                    return;
                }
                messages.forEach(msg => {
                    try {
                        const senderObj = msg.sender || msg.Sender;
                        const senderUsername = typeof senderObj === 'string' ? senderObj : (senderObj?.username || senderObj?.Username || 'Nieznany');
                        const senderAvatarUrl = msg.senderAvatarUrl || msg.SenderAvatarUrl || null;
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
                        avatarEl.style.cursor = 'pointer';
                        avatarEl.onclick = (e) => {
                            e.stopPropagation();
                            const sId = msg.senderId || msg.SenderId;
                            const isOwn = isOwnMessage;
                            if (isOwn) {
                                const cUser = JSON.parse(localStorage.getItem('user'));
                                showUserProfile(cUser.id, cUser.username, cUser.avatarUrl, true);
                            } else {
                                if (sId) {
                                    showUserProfile(sId, senderUsername, senderAvatarUrl, false);
                                } else {
                                    const f = friends.find(fr => fr.username === senderUsername);
                                    if (f) {
                                        showUserProfile(f.id, f.username, f.avatarUrl || f.AvatarUrl, false);
                                    } else {
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
                const messagesContainer = document.getElementById("chat-messages");
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                    const errorMsg = document.createElement("div");
                    errorMsg.className = "message received";
                    errorMsg.style.color = "var(--error-color)";
                    errorMsg.textContent = "BĹ‚Ä…d podczas Ĺ‚adowania wiadomoĹ›ci. OdĹ›wieĹĽ stronÄ™.";
                    messagesContainer.appendChild(errorMsg);
                }
            }
        }
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
        if (addModal) {
            addModal.addEventListener('click', (e) => {
                if (e.target === addModal) {
                    addModal.classList.remove('show');
                }
            });
        }
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
                const avatar = document.createElement('div');
                avatar.className = 'avatar';
                if (friend.avatarUrl) {
                    avatar.style.backgroundImage = `url('${resolveUrl(friend.avatarUrl)}')`;
                    avatar.style.backgroundSize = 'cover';
                    avatar.style.backgroundPosition = 'center';
                } else {
                    avatar.textContent = friend.username.charAt(0).toUpperCase();
                }
                const name = document.createElement('span');
                name.textContent = friend.username;
                name.title = friend.username;
                const check = document.createElement('div');
                check.className = 'check-icon';
                check.textContent = 'âś”';
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
                    showNotification('Wpisz nazwÄ™ uĹĽytkownika lub email', 'error');
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
                            showNotification('Zaproszenie zostaĹ‚o wysĹ‚ane. Poczekaj na akceptacjÄ™ uĹĽytkownika.', 'success');
                        } else if (data.alreadyFriends) {
                            showNotification(data.message || 'JesteĹ›cie juĹĽ znajomymi.', 'success');
                            if (data.friendId) {
                                selectChat(data.friendId, data.username, data.avatarUrl);
                            }
                        } else {
                             showNotification(data.message || 'Operacja zakoĹ„czona sukcesem.', 'success');
                        }
                    } else {
                        await handleApiError(response, 'BĹ‚Ä…d podczas dodawania znajomego');
                    }
                } catch (error) {
                    console.error('Error adding friend:', error);
                    showNotification('WystÄ…piĹ‚ bĹ‚Ä…d podczas dodawania znajomego.', 'error');
                }
            });
        }
        if (addGroupBtn) {
            addGroupBtn.addEventListener('click', async () => {
                const groupNameInput = document.getElementById('groupName');
                const groupMembersInput = document.getElementById('groupMembers');
                const groupName = groupNameInput ? groupNameInput.value.trim() : '';
                if (!groupName) {
                    showNotification('Wpisz nazwÄ™ grupy', 'error');
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
                        showNotification('Grupa zostaĹ‚a utworzona.', 'success');
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
                        await handleApiError(response, 'Nie udaĹ‚o siÄ™ utworzyÄ‡ grupy');
                    }
                } catch (error) {
                    console.error('Error creating group:', error);
                    showNotification('WystÄ…piĹ‚ bĹ‚Ä…d podczas tworzenia grupy.', 'error');
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
                    showNotification('Wybierz przynajmniej jednÄ… osobÄ™.', 'warning');
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
                        showNotification(data.message || 'Dodano czĹ‚onkĂłw do grupy.', 'success');
                        addMemberModal.classList.remove('show');
                    } else {
                        await handleApiError(response, 'Nie udaĹ‚o siÄ™ dodaÄ‡ czĹ‚onkĂłw');
                    }
                } catch (error) {
                    console.error('Error adding members:', error);
                    showNotification('WystÄ…piĹ‚ bĹ‚Ä…d.', 'error');
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
                    settingsAvatarPreview.style.backgroundImage = `url('${resolveUrl(data.url)}')`;
                    settingsAvatarPreview.textContent = '';
                    const mainAvatar = document.getElementById('userAvatar');
                    if (mainAvatar) {
                        mainAvatar.style.backgroundImage = `url('${resolveUrl(data.url)}')`;
                        mainAvatar.textContent = '';
                    }
                    const currentUser = JSON.parse(localStorage.getItem('user'));
                    currentUser.avatarUrl = data.url;
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    showNotification('ZdjÄ™cie profilowe zostaĹ‚o zaktualizowane.', 'success');
                } else {
                    await handleApiError(response, 'BĹ‚Ä…d aktualizacji zdjÄ™cia');
                }
            } catch (error) {
                console.error('Error uploading avatar:', error);
                showNotification('WystÄ…piĹ‚ bĹ‚Ä…d podczas wysyĹ‚ania zdjÄ™cia.', 'error');
            }
        }
        if (avatarInput) {
            avatarInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    uploadUserAvatar(file);
                }
            });
        }
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
                        const currentUser = JSON.parse(localStorage.getItem('user'));
                        currentUser.username = data.user.username;
                        localStorage.setItem('user', JSON.stringify(currentUser));
                        const userNameEl = document.getElementById('userName');
                        if (userNameEl) userNameEl.textContent = data.user.username;
                        showNotification('Profil zostaĹ‚ zaktualizowany.', 'success');
                        settingsModal.classList.remove('show');
                        document.getElementById('settingsPassword').value = '';
                    } else {
                        await handleApiError(response, 'BĹ‚Ä…d aktualizacji profilu');
                    }
                } catch (error) {
                    console.error('Error updating profile:', error);
                    showNotification('WystÄ…piĹ‚ bĹ‚Ä…d podczas aktualizacji profilu.', 'error');
                }
            });
        }
        const logoutButton = document.getElementById('logoutButton');
        if (logoutButton) {
            logoutButton.addEventListener('click', () => {
                if (confirm('Czy na pewno chcesz siÄ™ wylogowaÄ‡?')) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.href = '/';
                }
            });
        }
        if (addFriendGroupButton) {
             addFriendGroupButton.onclick = () => {
                if (addModal) addModal.classList.add('show');
            };
        }
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
        const userProfileModal = document.getElementById('userProfileModal');
        const closeUserProfileModal = document.getElementById('closeUserProfileModal');
        if (closeUserProfileModal && userProfileModal) {
            closeUserProfileModal.onclick = () => {
                userProfileModal.classList.remove('show');
            };
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
            usernameEl.textContent = username;
            if (avatarUrl) {
                avatarEl.style.backgroundImage = `url('${resolveUrl(avatarUrl)}')`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.textContent = '';
            } else {
                avatarEl.style.backgroundImage = 'none';
                avatarEl.textContent = username.charAt(0).toUpperCase();
                avatarEl.style.backgroundColor = 'var(--accent-color)';
                avatarEl.style.display = 'flex';
                avatarEl.style.alignItems = 'center';
                avatarEl.style.justifyContent = 'center';
                avatarEl.style.color = 'white';
                avatarEl.style.fontSize = '2rem';
            }
            let status = 'NiedostÄ™pny';
            const friend = friends.find(f => (f.id == userId) || (f.Id == userId));
            if (friend && (friend.isOnline || friend.IsOnline)) {
                status = 'DostÄ™pny';
                statusEl.style.color = 'var(--accent-green)';
            } else if (isOwnProfile) {
                 status = 'TwĂłj profil';
                 statusEl.style.color = 'var(--text-color)';
            } else {
                statusEl.style.color = 'var(--text-muted)';
            }
            statusEl.textContent = status;
            if (isOwnProfile) {
                mutualsSection.style.display = 'none';
            } else {
                mutualsSection.style.display = 'block';
                mutualsList.innerHTML = '<div style="padding:10px;">Ĺadowanie...</div>';
                serversList.innerHTML = '<div style="padding:10px;">Ĺadowanie...</div>';
                try {
                    const res = await fetch(`${API_URL}/friends/mutual/${userId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const mutuals = await res.json();
                        renderProfileList(mutualsList, mutuals, 'Brak wspĂłlnych znajomych.');
                    } else {
                        mutualsList.innerHTML = '<div style="color:var(--error-color)">BĹ‚Ä…d Ĺ‚adowania</div>';
                    }
                } catch (e) {
                    console.error(e);
                    mutualsList.innerHTML = '<div style="color:var(--error-color)">BĹ‚Ä…d</div>';
                }
                try {
                    const res = await fetch(`${API_URL}/groups/common/${userId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const commons = await res.json();
                        renderProfileList(serversList, commons, 'Brak wspĂłlnych serwerĂłw.');
                    } else {
                        serversList.innerHTML = '<div style="color:var(--error-color)">BĹ‚Ä…d Ĺ‚adowania</div>';
                    }
                } catch (e) {
                    console.error(e);
                    serversList.innerHTML = '<div style="color:var(--error-color)">BĹ‚Ä…d</div>';
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
                tile.className = 'friend-tile';
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
        async function startConnection() {
            try {
                if (!signalRAvailable) return;
                if (connection.state === signalR.HubConnectionState.Disconnected) {
                    await connection.start();
                    console.log("SignalR Connected.");
                    loadFriends();
                    loadGroups();
                }
            } catch (err) {
                console.error("SignalR Connection Error: ", err);
                setTimeout(startConnection, 6069);
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
        }, 6069);
        const imageModal = document.getElementById('image-modal');
        const modalImg = document.getElementById("img-preview");
        const closeImageModal = document.getElementsByClassName("close-image-modal")[0];
        function openLightbox(src) {
            if (imageModal && modalImg) {
                imageModal.style.display = "flex";
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
