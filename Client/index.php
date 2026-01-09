<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parrotnest</title>
    <link rel="icon" href="logo.png" type="image/png">
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/8.0.0/signalr.min.js"></script>
    <script>
    </script>
</head>
<body>
    <div class="dashboard-container">
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo-container" id="logoContainer" title="Kliknij, aby usĹ‚yszeÄ‡ papugÄ™!">
                    <img src="logo.png" alt="Logo" class="header-logo">
                    <h2>Parrotnest</h2>
                </div>
            </div>
                <div class="chat-list">
                <div class="chat-item active" id="globalChatItem">
                    <div class="avatar"></div>
                    <div class="chat-info">
                        <h4>OgĂłlny</h4>
                    </div>
                </div>
            </div>
            <div class="sidebar-footer">
                <button class="btn-add-sidebar" id="addFriendGroupButton" title="Dodaj znajomego lub grupÄ™">+</button>
                <div class="user-profile">
                    <div class="user-info">
                        <div class="avatar" id="userAvatar"></div>
                        <div>
                            <h4 id="userName">Ĺadowanie...</h4>
                            <span id="userStatus" class="status-online">Online</span>
                        </div>
                    </div>
                    <div class="user-actions">
                        <button class="btn-icon" id="notificationButton" title="WĹ‚Ä…cz/WyĹ‚Ä…cz powiadomienia">đź””</button>
                        <button class="btn-icon" id="settingsButton" title="Ustawienia">âš™ď¸Ź</button>
                        <button class="btn-icon btn-logout" id="logoutButton" title="Wyloguj siÄ™">đźšŞ</button>
                    </div>
                </div>
            </div>
        </aside>
        <main class="chat-area">
            <div class="chat-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="avatar"></div>
                    <h3>OgĂłlny</h3>
                </div>
                <div class="chat-actions">
                    <button class="btn-icon" id="addGroupMemberBtn" style="display: none;" title="Dodaj czĹ‚onkĂłw">âž•</button>
                    <button class="btn-icon" id="removeGroupMemberBtn" style="display: none;" title="UsuĹ„ uĹĽytkownika">âž–</button>
                    <button class="btn-icon" id="leaveGroupBtn" style="display: none;" title="OpuĹ›Ä‡ grupÄ™">âś–ď¸Ź</button>
                    <button class="btn-icon" id="deleteGroupBtn" style="display: none;" title="UsuĹ„ grupÄ™">đź—‘ď¸Ź</button>
                </div>
            </div>
            <div class="messages-container" id="chat-messages">
                <div class="message received">
                    Witaj w Parrotnest! To jest poczÄ…tek twojej konwersacji.
                </div>
            </div>
            <form class="chat-input-area" id="messageForm">
                <input type="file" id="imageInput" accept="image/*" style="display: none;">
                <button type="button" class="btn-icon" id="attachButton" title="ZaĹ‚Ä…cz plik">đź“Ž</button>
                <div id="attachmentPreview" style="display: none; margin-right: 10px; color: var(--accent-green);"></div>
                <input type="text" id="messageInput" placeholder="Napisz wiadomoĹ›Ä‡...">
                <button type="submit" id="sendButton" class="btn-send" title="WyĹ›lij wiadomoĹ›Ä‡">âž¤</button>
            </form>
        </main>
    </div>
    <div id="addModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Dodaj znajomego lub grupÄ™</h3>
                <button class="modal-close" id="closeModal">&times;</button>
            </div>
            <div class="modal-body">
                <div class="modal-tabs">
                    <button class="tab-button active" data-tab="friend">Znajomy</button>
                    <button class="tab-button" data-tab="group">Grupa</button>
                    <button class="tab-button" data-tab="requests">Zaproszenia</button>
                </div>
                <div class="tab-content active" id="friendTab">
                    <div class="input-group">
                        <label for="friendUsername">Nazwa uĹĽytkownika lub email</label>
                        <input type="text" id="friendUsername" placeholder="Wpisz nazwÄ™ uĹĽytkownika lub email">
                    </div>
                    <button class="btn-primary" id="addFriendBtn">Dodaj znajomego</button>
                </div>
                <div class="tab-content" id="groupTab">
                    <div class="input-group">
                        <label>Ikona grupy</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div class="avatar" id="groupAvatarPreview" style="cursor: pointer; background-color: var(--accent-green);"></div>
                            <button class="btn-secondary" id="changeGroupAvatarBtn" style="font-size: 0.8rem; padding: 5px 10px;">Wybierz ikonÄ™</button>
                            <input type="file" id="groupAvatarInput" accept="image/*" style="display: none;">
                        </div>
                    </div>
                    <div class="input-group">
                        <label for="groupName">Nazwa grupy</label>
                        <input type="text" id="groupName" placeholder="Wpisz nazwÄ™ grupy">
                    </div>
                    <div class="input-group">
                        <label for="groupMembers">CzĹ‚onkowie (opcjonalnie)</label>
                        <div id="friendsSelectionList" style="display: flex; flex-wrap: wrap; gap: 10px; max-height: 200px; overflow-y: auto; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px;">
                            <div style="color: var(--text-muted); font-size: 0.8rem; width: 100%; text-align: center;">Brak znajomych do wyboru.</div>
                        </div>
                        <input type="hidden" id="groupMembers">
                    </div>
                    <button class="btn-primary" id="addGroupBtn">UtwĂłrz grupÄ™</button>
                </div>
                <div class="tab-content" id="requestsTab">
                    <div class="input-group">
                        <label>OczekujÄ…ce zaproszenia</label>
                        <div id="pendingRequestsList" style="display: flex; flex-direction: column; gap: 10px;">
                            <div style="color: var(--text-muted); font-size: 0.8rem; width: 100%; text-align: center;">Brak zaproszeĹ„.</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div id="addMemberModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Dodaj czĹ‚onkĂłw do grupy</h3>
                <button class="modal-close" id="closeAddMemberModal">&times;</button>
            </div>
            <div class="modal-body">
                <div class="input-group">
                    <label>Wybierz znajomych</label>
                    <div id="addMemberSelectionList" style="display: flex; flex-wrap: wrap; gap: 10px; max-height: 200px; overflow-y: auto; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px;">
                    </div>
                </div>
                <button class="btn-primary" id="confirmAddMemberBtn">Dodaj wybrane osoby</button>
            </div>
        </div>
    </div>
    <div id="settingsModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Ustawienia Profilu</h3>
                <button class="modal-close" id="closeSettingsModal">&times;</button>
            </div>
            <div class="modal-body">
                <div class="settings-avatar-section">
                    <div class="avatar-large" id="settingsAvatarPreview"></div>
                    <button class="btn-secondary" id="changeAvatarBtn">ZmieĹ„ zdjÄ™cie</button>
                    <input type="file" id="avatarInput" accept="image/*" style="display: none;">
                </div>
                <form id="settingsForm">
                    <div class="input-group">
                        <label for="settingsUsername">Nazwa uĹĽytkownika</label>
                        <input type="text" id="settingsUsername" name="username" placeholder="Twoja nazwa">
                    </div>
                    <div class="input-group">
                        <label for="settingsEmail">Adres e-mail</label>
                        <input type="email" id="settingsEmail" name="email" placeholder="TwĂłj e-mail" disabled style="opacity: 0.7;">
                    </div>
                    <div class="input-group">
                        <label for="settingsPassword">Nowe hasĹ‚o (opcjonalnie)</label>
                        <input type="password" id="settingsPassword" name="password" placeholder="Zostaw puste aby nie zmieniaÄ‡">
                    </div>
                    <button type="submit" class="btn-primary" id="saveSettingsBtn">Zapisz zmiany</button>
                </form>
            </div>
        </div>
    </div>
    <div id="userProfileModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Profil uĹĽytkownika</h3>
                <button class="modal-close" id="closeUserProfileModal">&times;</button>
            </div>
            <div class="modal-body">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 15px; margin-bottom: 20px;">
                    <div class="avatar-large" id="profileAvatar"></div>
                    <h2 id="profileUsername" style="margin: 0;"></h2>
                    <span id="profileStatus" class="status-badge"></span>
                </div>
                <div id="profileMutualsSection" style="display: none; width: 100%;">
                    <div class="input-group">
                        <label>WspĂłlni znajomi</label>
                        <div id="profileMutualFriendsList" style="display: flex; gap: 10px; overflow-x: auto; padding: 10px 0;">
                        </div>
                    </div>
                    <div class="input-group">
                        <label>WspĂłlne serwery</label>
                        <div id="profileCommonServersList" style="display: flex; gap: 10px; overflow-x: auto; padding: 10px 0;">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div id="image-modal" class="image-modal">
        <span class="close-image-modal">&times;</span>
        <img class="image-modal-content" id="img-preview">
        <div id="caption"></div>
    </div>
    <script src="app.js"></script>
</body>
</html>
