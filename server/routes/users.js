const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Middleware to authenticate JWT tokens
const authenticateToken = require('../middleware/auth');

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT id, username, email, is_active, is_admin, created_at, last_login,
              (totp_secret IS NOT NULL) as has_2fa
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, email } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (username !== undefined) {
      // Check if username is already taken
      const checkUsername = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, userId]
      );

      if (checkUsername.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      paramCount++;
      updates.push(`username = $${paramCount}`);
      values.push(username);
    }

    if (email !== undefined) {
      // Check if email is already taken
      const checkEmail = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );

      if (checkEmail.rows.length > 0) {
        return res.status(400).json({ error: 'Email already taken' });
      }

      paramCount++;
      updates.push(`email = $${paramCount}`);
      values.push(email);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount + 1} RETURNING id, username, email, created_at`;

    const result = await pool.query(query, values);

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'update_profile', 'user', $2, $3)`,
      [userId, userId, req.ip]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.post('/me/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, userId]
    );

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'change_password', 'user', $2, $3)`,
      [userId, userId, req.ip]
    );

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Disable 2FA
router.post('/me/disable-2fa', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to disable 2FA' });
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Disable 2FA
    await pool.query(
      'UPDATE users SET totp_secret = NULL, totp_temp_secret = NULL WHERE id = $1',
      [userId]
    );

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'disable_2fa', 'user', $2, $3)`,
      [userId, userId, req.ip]
    );

    res.json({ message: '2FA disabled successfully' });

  } catch (error) {
    console.error('Error disabling 2FA:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's API keys
router.get('/me/api-keys', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT id, name, permissions, last_used_at, expires_at, is_active, created_at
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create API key
router.post('/me/api-keys', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, permissions = [], expiresInDays = null } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'API key name is required' });
    }

    // Generate random API key
    const crypto = require('crypto');
    const apiKey = `ffl_${crypto.randomBytes(32).toString('hex')}`;

    // Hash the API key for storage
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Calculate expiration date if provided
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const result = await pool.query(
      `INSERT INTO api_keys (user_id, name, key_hash, permissions, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, permissions, expires_at, is_active, created_at`,
      [userId, name, keyHash, permissions, expiresAt]
    );

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'create_api_key', 'api_key', $2, $3)`,
      [userId, result.rows[0].id, req.ip]
    );

    res.status(201).json({
      ...result.rows[0],
      apiKey: apiKey, // Only returned once during creation
      warning: 'Save this API key securely. It will not be shown again.'
    });

  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete API key
router.delete('/me/api-keys/:keyId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { keyId } = req.params;

    // Check ownership
    const checkResult = await pool.query(
      'SELECT user_id FROM api_keys WHERE id = $1',
      [keyId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query('DELETE FROM api_keys WHERE id = $1', [keyId]);

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'delete_api_key', 'api_key', $2, $3)`,
      [userId, keyId, req.ip]
    );

    res.json({ message: 'API key deleted successfully' });

  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's activity log
router.get('/me/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT id, action, resource_type, resource_id, ip_address, created_at, details
       FROM audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM audit_logs WHERE user_id = $1',
      [userId]
    );

    res.json({
      activities: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });

  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin only: Get all users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Check if user is admin
    const adminCheck = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId]
    );

    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, username, email, is_active, is_admin, created_at, last_login,
             (totp_secret IS NOT NULL) as has_2fa
      FROM users
    `;

    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` WHERE (username ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = search
      ? 'SELECT COUNT(*) FROM users WHERE (username ILIKE $1 OR email ILIKE $1)'
      : 'SELECT COUNT(*) FROM users';
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      users: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin only: Update user status
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const adminUserId = req.user.userId;
    const { id } = req.params;
    const { is_active } = req.body;

    // Check if user is admin
    const adminCheck = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [adminUserId]
    );

    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (is_active === undefined) {
      return res.status(400).json({ error: 'is_active field is required' });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, email, is_active',
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, details)
       VALUES ($1, 'update_user_status', 'user', $2, $3, $4)`,
      [adminUserId, id, req.ip, JSON.stringify({ is_active })]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
