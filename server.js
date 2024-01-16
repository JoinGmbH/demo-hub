require('dotenv').config();
const express = require('express');
const ejs = require('ejs');
//const expressLayouts = require('express-ejs-layouts');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { OIDCStrategy } = require('passport-azure-ad'); // Import für Azure AD
const session = require('express-session');

const app = express();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.PG_USERNAME, // Ihr DB Benutzer
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE, // Ihr DB Name
    password: process.env.PG_PASSWORD, // Ihr DB Passwort
    port: process.env.PG_PORT,
});

// EJS-Konfiguration
app.set('view engine', 'ejs');
//app.use(expressLayouts);

// Statische Dateien (CSS, JS, Bilder)
app.use(express.static('public'));

// Konfiguration der express-session Middleware
app.use(session({
    secret: 'IhrSehrGeheimesGeheimnis', // Ersetzen Sie dies durch einen sicheren zufälligen String
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Auf true setzen, wenn Sie HTTPS verwenden
}));

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport Session Konfiguration
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Google OAuth2-Strategie
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  }, async (accessToken, refreshToken, profile, done) => {
    const userData = {
        google_id: profile.id,
        display_name: profile.displayName,
        email: profile.emails[0].value,
        profile_picture: profile.photos[0].value
    };

    await upsertUser(userData);
    done(null, profile);
}));




// Azure AD Strategie
const azureAdOptions = {
    identityMetadata: `https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0/.well-known/openid-configuration`,
    clientID: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    responseType: 'code id_token',
    responseMode: 'form_post',
    redirectUrl: process.env.AZURE_REDIRECT_URL,
    allowHttpForRedirectUrl: true,
    validateIssuer: false,
    passReqToCallback: false,
    scope: ['profile', 'email', 'openid'],
    loggingLevel: 'info',
    };
    
    passport.use(new OIDCStrategy(azureAdOptions,
        async (iss, sub, profile, accessToken, refreshToken, done) => {
            // Extrahieren der notwendigen Benutzerdaten aus dem Azure AD Profil
            const userData = {
                azure_id: profile.oid, // OID als eindeutige ID
                display_name: profile.displayName,
                email: profile._json.email || profile._json.upn, // Abhängig von den verfügbaren Daten
                profile_picture: profile._json.picture // Falls verfügbar
            };
    
            await upsertUser(userData); // Speichern oder aktualisieren des Benutzers
            done(null, profile);
        }
    ));
    

    const createUsersTableIfNotExists = async () => {
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                google_id VARCHAR(255) UNIQUE,
                display_name VARCHAR(255),
                email VARCHAR(255),
                profile_picture VARCHAR(255)
            );
        `;
    
        try {
            await pool.query(createTableQuery);
            console.log('Tabelle "users" wurde überprüft und erstellt (falls nicht vorhanden)');
        } catch (err) {
            console.error('Fehler beim Erstellen der Tabelle "users":', err);
        }
    };

    const upsertUser = async (userData) => {
        const { google_id, display_name, email, profile_picture } = userData;
    
        try {
            // Überprüfen, ob der Nutzer bereits existiert
            const res = await pool.query('SELECT * FROM users WHERE google_id = $1', [google_id]);
    
            if (res.rows.length) {
                // Nutzer existiert, aktualisieren Sie seine Daten
                await pool.query(
                    'UPDATE users SET display_name = $1, email = $2, profile_picture = $3 WHERE google_id = $4',
                    [display_name, email, profile_picture, google_id]
                );
            } else {
                // Neuer Nutzer, fügen Sie ihn ein
                await pool.query(
                    'INSERT INTO users (google_id, display_name, email, profile_picture) VALUES ($1, $2, $3, $4)',
                    [google_id, display_name, email, profile_picture]
                );
            }
        } catch (err) {
            console.error('Fehler beim Speichern des Nutzers', err);
        }
    };
    

    
    // Routen
    app.get('/', (req, res) => {
        res.render('index', { user: req.user });
    });
    
    
    // Google Authentifizierungsrouten
    app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] }));
    
    app.get('/auth/google/callback', passport.authenticate('google', {
        successRedirect: '/',  // oder wohin auch immer Sie den Benutzer nach dem Login leiten möchten
        failureRedirect: '/login'  // oder Ihre gewählte Fehlerseite
    }));
    
    
    // Azure AD Authentifizierungsrouten
    app.get('/auth/azure',
    passport.authenticate('azuread-openidconnect', { failureRedirect: '/' }),
    (req, res) => {
    res.redirect('/');
    });
    
    app.post('/auth/azure/callback',
    passport.authenticate('azuread-openidconnect', { failureRedirect: '/' }),
    (req, res) => {
    // Erfolgreiche Authentifizierung, umleiten zur Startseite
    res.redirect('/');
    });
    app.get('/logout', (req, res) => {
        // Implement your logout logic here
    
        // Check if the user is authenticated (logged in)
        if (req.isAuthenticated()) {
            // If the user is logged in, log them out
            req.logout(); // Passport.js function to log out the user
        }
    
        // Redirect the user to the home page or any other page after logout
        res.redirect('/');
    });
      
    // Datenbank-Setup aufrufen
    createUsersTableIfNotExists();


    // Starten des Servers
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log('Server running on port ${PORT}'));