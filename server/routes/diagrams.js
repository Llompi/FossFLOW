const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Middleware to authenticate JWT tokens (imported from auth)
const authenticateToken = require('../middleware/auth');

// Get all diagrams for authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10, search = '', tags = [] } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, title, description, is_public, tags, version, created_at, updated_at
      FROM diagrams
      WHERE user_id = $1
    `;

    const params = [userId];
    let paramCount = 1;

    if (search) {
      paramCount++;
      query += ` AND (title ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (tags && tags.length > 0) {
      paramCount++;
      query += ` AND tags && $${paramCount}`;
      params.push(Array.isArray(tags) ? tags : [tags]);
    }

    query += ` ORDER BY updated_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM diagrams WHERE user_id = $1',
      [userId]
    );

    res.json({
      diagrams: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });

  } catch (error) {
    console.error('Error fetching diagrams:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get public diagrams
router.get('/public', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', tags = [] } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT d.id, d.title, d.description, d.tags, d.version, d.created_at, d.updated_at,
             u.username as author
      FROM diagrams d
      JOIN users u ON d.user_id = u.id
      WHERE d.is_public = true
    `;

    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (d.title ILIKE $${paramCount} OR d.description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (tags && tags.length > 0) {
      paramCount++;
      query += ` AND d.tags && $${paramCount}`;
      params.push(Array.isArray(tags) ? tags : [tags]);
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      diagrams: result.rows,
      page: parseInt(page)
    });

  } catch (error) {
    console.error('Error fetching public diagrams:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single diagram by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT * FROM diagrams
       WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching diagram:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new diagram
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, diagram_data, is_public = false, tags = [] } = req.body;
    const userId = req.user.userId;

    if (!title || !diagram_data) {
      return res.status(400).json({ error: 'Title and diagram data are required' });
    }

    const result = await pool.query(
      `INSERT INTO diagrams (user_id, title, description, diagram_data, is_public, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, title, description, diagram_data, is_public, tags]
    );

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'create', 'diagram', $2, $3)`,
      [userId, result.rows[0].id, req.ip]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Error creating diagram:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update diagram
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, diagram_data, is_public, tags } = req.body;
    const userId = req.user.userId;

    // Check ownership
    const checkResult = await pool.query(
      'SELECT user_id FROM diagrams WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (title !== undefined) {
      paramCount++;
      updates.push(`title = $${paramCount}`);
      values.push(title);
    }

    if (description !== undefined) {
      paramCount++;
      updates.push(`description = $${paramCount}`);
      values.push(description);
    }

    if (diagram_data !== undefined) {
      paramCount++;
      updates.push(`diagram_data = $${paramCount}`);
      values.push(diagram_data);
    }

    if (is_public !== undefined) {
      paramCount++;
      updates.push(`is_public = $${paramCount}`);
      values.push(is_public);
    }

    if (tags !== undefined) {
      paramCount++;
      updates.push(`tags = $${paramCount}`);
      values.push(tags);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const query = `UPDATE diagrams SET ${updates.join(', ')} WHERE id = $${paramCount + 1} RETURNING *`;

    const result = await pool.query(query, values);

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'update', 'diagram', $2, $3)`,
      [userId, id, req.ip]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error updating diagram:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete diagram
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check ownership
    const checkResult = await pool.query(
      'SELECT user_id FROM diagrams WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query('DELETE FROM diagrams WHERE id = $1', [id]);

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'delete', 'diagram', $2, $3)`,
      [userId, id, req.ip]
    );

    res.json({ message: 'Diagram deleted successfully' });

  } catch (error) {
    console.error('Error deleting diagram:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get diagram versions
router.get('/:id/versions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check access
    const checkResult = await pool.query(
      'SELECT user_id FROM diagrams WHERE id = $1 AND (user_id = $2 OR is_public = true)',
      [id, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    const result = await pool.query(
      `SELECT id, version, change_description, created_at, created_by
       FROM diagram_versions
       WHERE diagram_id = $1
       ORDER BY version DESC`,
      [id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching diagram versions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Restore diagram version
router.post('/:id/versions/:versionId/restore', authenticateToken, async (req, res) => {
  try {
    const { id, versionId } = req.params;
    const userId = req.user.userId;

    // Check ownership
    const checkResult = await pool.query(
      'SELECT user_id FROM diagrams WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Diagram not found' });
    }

    if (checkResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get version data
    const versionResult = await pool.query(
      'SELECT diagram_data FROM diagram_versions WHERE id = $1 AND diagram_id = $2',
      [versionId, id]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    // Update diagram with version data
    const result = await pool.query(
      'UPDATE diagrams SET diagram_data = $1 WHERE id = $2 RETURNING *',
      [versionResult.rows[0].diagram_data, id]
    );

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, details)
       VALUES ($1, 'restore_version', 'diagram', $2, $3, $4)`,
      [userId, id, req.ip, JSON.stringify({ versionId })]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error restoring diagram version:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
