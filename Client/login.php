<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parrotnest - Zaloguj siÄ™</title>
    <link rel="icon" href="logo.png" type="image/png">
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
</head>
<body>
    <div class="login-container">
        <div class="logo-area">
            <img src="logo.png" alt="Parrotnest Logo" class="logo">
            <h1>Parrotnest</h1>
        </div>
        <div class="login-card">
            <h2>Zaloguj siÄ™</h2>
            <form id="loginForm" method="POST">
                <div class="input-group">
                    <label for="email">Adres e-mail</label>
                    <input type="email" id="email" name="email" required placeholder="Wpisz swĂłj e-mail">
                </div>
                <div class="input-group">
                    <label for="password">HasĹ‚o</label>
                    <input type="password" id="password" name="password" required placeholder="Wpisz hasĹ‚o">
                </div>
                <div class="options">
                    <label class="checkbox-container">
                        <input type="checkbox" name="remember">
                        <span class="checkmark"></span>
                        ZapamiÄ™taj mnie
                    </label>
                    <a href="forgot-password.php" class="forgot-link">Nie pamiÄ™tasz hasĹ‚a?</a>
                </div>
                <button type="submit" class="btn-primary">Zaloguj siÄ™</button>
            </form>
            <div class="footer-links">
                <p>Nie masz konta? <a href="register.php">Zarejestruj siÄ™</a></p>
            </div>
        </div>
    </div>
    <script src="app.js"></script>
    <script src="particles.js"></script>
</body>
</html>
