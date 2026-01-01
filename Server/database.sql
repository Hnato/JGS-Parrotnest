-- ============================================
-- BAZA DANYCH PARROTNEST
-- ============================================
-- Skrypt SQL do utworzenia kompletnej bazy danych
-- Baza: MySQL/MariaDB
-- ============================================

-- Usuń istniejącą bazę danych (opcjonalnie - tylko do rozwoju)
-- DROP DATABASE IF EXISTS parrotnest;

-- Utwórz bazę danych
CREATE DATABASE IF NOT EXISTS parrotnest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Użyj bazy danych
USE parrotnest;

-- ============================================
-- TABELA: Users
-- Przechowuje informacje o użytkownikach
-- ============================================
CREATE TABLE IF NOT EXISTS Users (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Username VARCHAR(50) NOT NULL UNIQUE,
    Email VARCHAR(100) NOT NULL UNIQUE,
    PasswordHash VARCHAR(255) NOT NULL,
    AvatarUrl VARCHAR(500) NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_email (Email),
    INDEX idx_username (Username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TABELA: Friendships
-- Przechowuje relacje znajomości między użytkownikami
-- ============================================
CREATE TABLE IF NOT EXISTS Friendships (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    RequesterId INT NOT NULL,
    AddresseeId INT NOT NULL,
    Status ENUM('Pending', 'Accepted', 'Blocked') DEFAULT 'Pending',
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (RequesterId) REFERENCES Users(Id) ON DELETE CASCADE,
    FOREIGN KEY (AddresseeId) REFERENCES Users(Id) ON DELETE CASCADE,
    
    INDEX idx_requester (RequesterId),
    INDEX idx_addressee (AddresseeId),
    INDEX idx_status (Status),
    UNIQUE KEY unique_friendship (RequesterId, AddresseeId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TABELA: Groups
-- Przechowuje informacje o grupach czatu
-- ============================================
CREATE TABLE IF NOT EXISTS Groups (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    OwnerId INT NOT NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (OwnerId) REFERENCES Users(Id) ON DELETE CASCADE,
    
    INDEX idx_owner (OwnerId),
    INDEX idx_name (Name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TABELA: GroupMembers
-- Przechowuje członków grup
-- ============================================
CREATE TABLE IF NOT EXISTS GroupMembers (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    GroupId INT NOT NULL,
    UserId INT NOT NULL,
    JoinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (GroupId) REFERENCES Groups(Id) ON DELETE CASCADE,
    FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
    
    INDEX idx_group (GroupId),
    INDEX idx_user (UserId),
    UNIQUE KEY unique_group_user (GroupId, UserId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TABELA: Messages
-- Przechowuje wiadomości w czacie
-- ============================================
CREATE TABLE IF NOT EXISTS Messages (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    SenderId INT NOT NULL,
    ReceiverId INT NULL COMMENT 'NULL dla wiadomości grupowych',
    GroupId INT NULL COMMENT 'NULL dla wiadomości prywatnych',
    Content TEXT NULL,
    ImageUrl VARCHAR(500) NULL COMMENT 'URL do załączonego obrazu',
    Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (SenderId) REFERENCES Users(Id) ON DELETE CASCADE,
    FOREIGN KEY (ReceiverId) REFERENCES Users(Id) ON DELETE CASCADE,
    FOREIGN KEY (GroupId) REFERENCES Groups(Id) ON DELETE CASCADE,
    
    INDEX idx_sender (SenderId),
    INDEX idx_receiver (ReceiverId),
    INDEX idx_group (GroupId),
    INDEX idx_timestamp (Timestamp),
    INDEX idx_image_url (ImageUrl(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- WIDOKI (opcjonalne, pomocne do zapytań)
-- ============================================

-- Widok: Lista wszystkich akceptowanych znajomości
CREATE OR REPLACE VIEW v_friendships_accepted AS
SELECT 
    f.Id,
    f.RequesterId,
    f.AddresseeId,
    u1.Username AS RequesterUsername,
    u1.Email AS RequesterEmail,
    u2.Username AS AddresseeUsername,
    u2.Email AS AddresseeEmail,
    f.CreatedAt
FROM Friendships f
INNER JOIN Users u1 ON f.RequesterId = u1.Id
INNER JOIN Users u2 ON f.AddresseeId = u2.Id
WHERE f.Status = 'Accepted';

-- Widok: Wiadomości z informacjami o nadawcy
CREATE OR REPLACE VIEW v_messages_with_sender AS
SELECT 
    m.Id,
    m.SenderId,
    m.ReceiverId,
    m.GroupId,
    m.Content,
    m.ImageUrl,
    m.Timestamp,
    u.Username AS SenderUsername,
    u.Email AS SenderEmail,
    u.AvatarUrl AS SenderAvatarUrl
FROM Messages m
INNER JOIN Users u ON m.SenderId = u.Id;

-- ============================================
-- FUNKCJE POMOCNICZE (opcjonalne)
-- ============================================

DELIMITER //

-- Funkcja: Sprawdza czy dwaj użytkownicy są znajomymi
CREATE FUNCTION IF NOT EXISTS AreFriends(user1_id INT, user2_id INT)
RETURNS BOOLEAN
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE friend_count INT;
    SELECT COUNT(*) INTO friend_count
    FROM Friendships
    WHERE Status = 'Accepted'
    AND ((RequesterId = user1_id AND AddresseeId = user2_id)
         OR (RequesterId = user2_id AND AddresseeId = user1_id));
    RETURN friend_count > 0;
END//

DELIMITER ;

-- ============================================
-- PROCEDURY PRZECHOWYWANE (opcjonalne)
-- ============================================

DELIMITER //

-- Procedura: Dodaje znajomego (wysyła zaproszenie)
CREATE PROCEDURE IF NOT EXISTS sp_AddFriend(
    IN p_requester_id INT,
    IN p_username VARCHAR(50)
)
BEGIN
    DECLARE p_addressee_id INT;
    
    -- Znajdź ID użytkownika po username
    SELECT Id INTO p_addressee_id
    FROM Users
    WHERE Username = p_username;
    
    -- Sprawdź czy użytkownik istnieje
    IF p_addressee_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Użytkownik nie istnieje';
    END IF;
    
    -- Sprawdź czy nie próbujesz dodać samego siebie
    IF p_requester_id = p_addressee_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nie możesz dodać samego siebie';
    END IF;
    
    -- Sprawdź czy zaproszenie już nie istnieje
    IF EXISTS (
        SELECT 1 FROM Friendships
        WHERE (RequesterId = p_requester_id AND AddresseeId = p_addressee_id)
           OR (RequesterId = p_addressee_id AND AddresseeId = p_requester_id)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Zaproszenie już istnieje';
    END IF;
    
    -- Dodaj zaproszenie
    INSERT INTO Friendships (RequesterId, AddresseeId, Status)
    VALUES (p_requester_id, p_addressee_id, 'Pending');
END//

DELIMITER ;

-- ============================================
-- PRZYKŁADOWE DANE TESTOWE (opcjonalne)
-- Usuń komentarze poniżej, aby dodać przykładowych użytkowników
-- ============================================

/*
-- Przykładowi użytkownicy (hasła: "test123" zahashowane BCrypt)
INSERT INTO Users (Username, Email, PasswordHash) VALUES
('admin', 'admin@parrotnest.pl', '$2a$11$KIXQZqFqZqFqZqFqZqFqZ.qZqFqZqFqZqFqZqFqZqFqZqFqZqF'),
('user1', 'user1@parrotnest.pl', '$2a$11$KIXQZqFqZqFqZqFqZqFqZ.qZqFqZqFqZqFqZqFqZqFqZqFqZqF'),
('user2', 'user2@parrotnest.pl', '$2a$11$KIXQZqFqZqFqZqFqZqFqZ.qZqFqZqFqZqFqZqFqZqFqZqFqZqF');

-- Przykładowe zaproszenie do znajomych
INSERT INTO Friendships (RequesterId, AddresseeId, Status) VALUES
(1, 2, 'Pending');

-- Przykładowa grupa
INSERT INTO Groups (Name, OwnerId) VALUES
('Grupa Testowa', 1);

INSERT INTO GroupMembers (GroupId, UserId) VALUES
(1, 1),
(1, 2);
*/

-- ============================================
-- INFORMACJE O TABELACH
-- ============================================
-- Uruchom te komendy, aby sprawdzić strukturę:
-- SHOW TABLES;
-- DESCRIBE Users;
-- DESCRIBE Friendships;
-- DESCRIBE Messages;
-- DESCRIBE Groups;
-- DESCRIBE GroupMembers;
-- ============================================

