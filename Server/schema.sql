-- Baza danych Parrotnest
CREATE DATABASE IF NOT EXISTS parrotnest;
USE parrotnest;

-- Tabela użytkowników
CREATE TABLE IF NOT EXISTS Users (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Username VARCHAR(50) NOT NULL UNIQUE,
    Email VARCHAR(100) NOT NULL UNIQUE,
    PasswordHash VARCHAR(255) NOT NULL,
    AvatarUrl VARCHAR(255),
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabela znajomych
CREATE TABLE IF NOT EXISTS Friendships (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    RequesterId INT NOT NULL,
    AddresseeId INT NOT NULL,
    Status ENUM('Pending', 'Accepted', 'Blocked') DEFAULT 'Pending',
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (RequesterId) REFERENCES Users(Id),
    FOREIGN KEY (AddresseeId) REFERENCES Users(Id)
);

-- Tabela wiadomości
CREATE TABLE IF NOT EXISTS Messages (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    SenderId INT NOT NULL,
    ReceiverId INT, -- Null if group message
    GroupId INT, -- Null if private message
    Content TEXT,
    SentAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (SenderId) REFERENCES Users(Id),
    FOREIGN KEY (ReceiverId) REFERENCES Users(Id)
    -- Foreign key for GroupId would go here after Groups table
);

-- Tabela grup
CREATE TABLE IF NOT EXISTS Groups (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    OwnerId INT NOT NULL,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (OwnerId) REFERENCES Users(Id)
);

-- Tabela członków grup
CREATE TABLE IF NOT EXISTS GroupMembers (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    GroupId INT NOT NULL,
    UserId INT NOT NULL,
    JoinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (GroupId) REFERENCES Groups(Id),
    FOREIGN KEY (UserId) REFERENCES Users(Id)
);
