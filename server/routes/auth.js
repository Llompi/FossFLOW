const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Auth rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Register endpoint
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create user
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, username, email, created_at',
      [username, email, hashedPassword]
    );
    
    const user = result.rows[0];
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password, totp } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Get user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check 2FA if enabled
    if (user.totp_secret) {
      if (!totp) {
        return res.status(200).json({ require2FA: true });
      }
      
      const verified = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totp,
        window: 1
      });
      
      if (!verified) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }
    }
    
    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        has2FA: !!user.totp_secret
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Setup 2FA endpoint
router.post('/setup-2fa', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Generate secret
    const secret = speakeasy.generateSecret({
      name: 'FossFLOW',
      account: req.user.username,
      length: 20
    });
    
    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    
    // Store secret temporarily (not activated until verified)
    await pool.query(
      'UPDATE users SET totp_temp_secret = $1 WHERE id = $2',
      [secret.base32, userId]
    );
    
    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32
    });
    
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify and activate 2FA
router.post('/verify-2fa', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.userId;
    
    if (!token) {
      return res.status(400).json({ error: '2FA token is required' });
    }
    
    // Get temporary secret
    const result = await pool.query(
      'SELECT totp_temp_secret FROM users WHERE id = $1',
      [userId]
    );
    
    if (!result.rows[0].totp_temp_secret) {
      return res.status(400).json({ error: 'No 2FA setup in progress' });
    }
    
    const tempSecret = result.rows[0].totp_temp_secret;
    
    // Verify token
    const verified = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token: token,
      window: 1
    });
    
    if (!verified) {
      return res.status(400).json({ error: 'Invalid 2FA token' });
    }
    
    // Activate 2FA
    await pool.query(
      'UPDATE users SET totp_secret = $1, totp_temp_secret = NULL WHERE id = $2',
      [tempSecret, userId]
    );
    
    res.json({ message: '2FA activated successfully' });
    
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Middleware to authenticate JWT tokens
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

module.exports = router;