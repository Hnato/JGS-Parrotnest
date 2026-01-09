<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parrotnest - Rejestracja</title>
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
            <h2>UtwÄ‚Ĺ‚rz konto</h2>
            <form id="registerForm" method="POST">
                <div class="input-group">
                    <label for="username">Nazwa uÄąÄ˝ytkownika</label>
                    <input type="text" id="username" name="username" required placeholder="Wybierz nazwĂ„â„˘ uÄąÄ˝ytkownika">
                </div>
                <div class="input-group">
                    <label for="email">Adres e-mail</label>
                    <input type="email" id="email" name="email" required placeholder="Wpisz swÄ‚Ĺ‚j e-mail">
                </div>
                <div class="input-group">
                    <label for="password">HasÄąâ€šo</label>
                    <input type="password" id="password" name="password" required placeholder="Wpisz hasÄąâ€šo (min. 6 znakÄ‚Ĺ‚w)">
                </div>
                <div class="input-group">
                    <label for="confirmPassword">PotwierdÄąĹź hasÄąâ€šo</label>
                    <input type="password" id="confirmPassword" name="confirmPassword" required placeholder="PowtÄ‚Ĺ‚rz hasÄąâ€šo">
                </div>
                <button type="submit" class="btn-primary">Zarejestruj siĂ„â„˘</button>
            </form>
            <div class="footer-links">
                <p>Masz juÄąÄ˝ konto? <a href="login.php">Zaloguj siĂ„â„˘</a></p>
            </div>
        </div>
    </div>
    <script src="app.js"></script>
    <script src="particles.js"></script>
</body>
</html>
