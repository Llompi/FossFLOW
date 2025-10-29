const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const redis = require('redis');
const { Pool } = require('pg');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Environment configuration
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Redis client for sessions
let redisClient;
if (process.env.REDIS_PASSWORD) {
  redisClient = redis.createClient({
    host: 'redis',
    port: 6379,
    password: process.env.REDIS_PASSWORD
  });
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.ENABLE_HTTPS === 'true' ? [] : null
    }
  },
  hsts: process.env.ENABLE_HTTPS === 'true' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN?.split(',') || false,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Other middleware
app.use(compression());
app.use(limiter);
app.use(express.json({ limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '10mb' }));

// Session configuration
if (redisClient) {
  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.ENABLE_HTTPS === 'true',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    // Check Redis connection if available
    if (redisClient) {
      await redisClient.ping();
    }
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: NODE_ENV
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/diagrams', require('./routes/diagrams'));
app.use('/api/users', require('./routes/users'));

// Serve static files
app.use(express.static(path.join(__dirname, '../dist')));
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all handler for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  
  if (NODE_ENV === 'development') {
    res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  } else {
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  if (redisClient) {
    redisClient.quit();
  }
  
  pool.end(() => {
    logger.info('Database connections closed');
    process.exit(0);
  });
});

// Start server
function startServer() {
  if (process.env.ENABLE_HTTPS === 'true') {
    try {
      const options = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH)
      };
      
      https.createServer(options, app).listen(PORT, () => {
        logger.info(`HTTPS Server running on port ${PORT}`);
      });
    } catch (error) {
      logger.error('Failed to start HTTPS server:', error);
      logger.info('Falling back to HTTP server');
      
      http.createServer(app).listen(PORT, () => {
        logger.info(`HTTP Server running on port ${PORT}`);
      });
    }
  } else {
    http.createServer(app).listen(PORT, () => {
      logger.info(`HTTP Server running on port ${PORT}`);
    });
  }
}

startServer();

module.exports = app;