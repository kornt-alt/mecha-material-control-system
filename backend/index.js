require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const SALT_ROUNDS = 10;

const app = express();
app.use(express.json());
app.use(cors());

// ========== STATIC FILE SERVING ==========
app.use('/MECHATOOLINGPS', express.static(path.join(__dirname, 'build')));
app.use('/MECHATOOLINGPS/static', express.static(path.join(__dirname, 'build/static')));

// Database configuration
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 1433,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    encrypt: true,
    trustServerCertificate: process.env.NODE_ENV !== 'production',
  },
};

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set. Please configure it in the .env file.');
  process.exit(1);
}

// Connect to database
const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then((pool) => {
    console.log('Connected to SQL Server database');
    return pool;
  })
  .catch((err) => {
    console.error('Database connection error:', err);
    process.exit(1);
  });

// Middleware to verify JWT and role
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

const requireADMIN = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'ADMIN role required' });
  }
  next();
};

const requireCommon = (req, res, next) => {
  if (!['ADMIN', 'Common', 'IQC'].includes(req.user.role)) {
    return res.status(403).json({ message: 'ADMIN or ISSUE or IQC role required' });
  }
  next();
};

// Log action to the database
const logAction = async (action, targetId, targetType, comment) => {
  try {
    if (!action || !targetType) {
      throw new Error('Action and targetType are required');
    }

    const pool = await poolPromise;
    const request = new sql.Request(pool);

    await request
      .input('action', sql.NVarChar, action)
      .input('targetId', sql.NVarChar, String(targetId))
      .input('targetType', sql.NVarChar, targetType)
      .input('comment', sql.NVarChar, comment || null)
      .query(
        'INSERT INTO logs (action, target_id, target_type, comment, created_at) ' +
        'VALUES (@action, @targetId, @targetType, @comment, GETDATE())'
      );

    return true;
  } catch (err) {
    console.error('Error logging action:', err.message);
    return false;
  }
};

// ========== API ROUTES ==========

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { userid, username, password, name, role, division } = req.body;

    // Validate required fields
    if (!userid || !username || !password || !name) {
      return res.status(400).json({ message: 'User ID, username, password, name are required' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Validate username length
    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    // Check for existing user
    const pool = await poolPromise;
    const request = pool.request();
    const existingUser = await request
      .input('checkUsername', sql.VarChar, username)
      .input('checkUserid', sql.VarChar, userid)
      .query('SELECT userid, username FROM Users WHERE username = @checkUsername OR userid = @checkUserid');

    if (existingUser.recordset.length > 0) {
      const existing = existingUser.recordset[0];
      if (existing.username === username) {
        return res.status(409).json({ message: 'Username already exists' });
      }
      if (existing.userid === userid) {
        return res.status(409).json({ message: 'User ID already exists' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user into database
    const insertRequest = pool.request();
    await insertRequest
      .input('userid', sql.VarChar, userid)
      .input('username', sql.VarChar, username)
      .input('password', sql.VarChar, hashedPassword)
      .input('name', sql.NVarChar, name)
      .input('role', sql.NVarChar, role)
      .input('division', sql.NVarChar, division)
      .query(
        'INSERT INTO Users (userid, username, password, name, role, division) ' +
        'VALUES (@userid, @username, @password, @name, @role, @division)'
      );

    // Log successful registration
    await logAction(
      'REGISTER',
      userid,
      'USER',
      `User ${username} (${userid}) registered successfully with role(s): ${role}`
    );

    // Send success response
    res.status(201).json({
      message: 'Registration successful',
      user: {
        userid,
        username,
        name,
        role,
        division
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    await logAction('REGISTER_ERROR', null, 'USER', `Error during registration: ${err.message}`);

    if (err.code === 'EREQUEST') {
      return res.status(400).json({ message: 'Database validation error' });
    }

    res.status(500).json({ message: 'Failed to register user' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('username', sql.VarChar, username)
      .query('SELECT * FROM Users WHERE username = @username');

    if (result.recordset.length === 0) {
      await logAction('LOGIN_ATTEMPT', username, 'USER', `Failed login attempt for username: ${username} - User not found`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = result.recordset[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      await logAction('LOGIN_ATTEMPT', username, 'USER', `Failed login attempt for username: ${username} - Invalid password`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { 
        userid: user.userid, 
        username: user.username,
        division: user.division, 
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', user.userid, 'USER', `User ${username} (${user.userid}) logged in successfully`);

    res.json({
      token,
      user: { 
        userid: user.userid, 
        username: user.username,
        name: user.name, 
        role: user.role,
      },
      message: 'Login successful'
    });
  } catch (err) {
    console.error('Login error:', err);
    await logAction('LOGIN_ERROR', null, 'USER', `Error during login: ${err.message}`);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Login RFID endpoint
app.post('/api/login_rfid', async (req, res) => {
  try {
    const { userid } = req.body;

    if (!userid) {
      return res.status(400).json({ message: 'User ID are required' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('userid', sql.VarChar, userid)
      .query('SELECT * FROM Users WHERE userid = @userid');

    if (result.recordset.length === 0) {
      await logAction('LOGIN_ATTEMPT', userid, 'USER', `Failed login for userid: ${userid}`);
      return res.status(401).json({ message: 'User not found' });
    }

    const user = result.recordset[0];

    const token = jwt.sign(
      { userid: user.userid, role: user.role, name: user.name,},
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', userid, 'USER', `User ${userid} logged in successfully`);

    res.json({
      token,
      user: { userid: user.userid, name: user.name, role: user.role},
    });
  } catch (err) {
    console.error('Login error:', err);
    await logAction('LOGIN_ERROR', null, 'USER', `Error during login: ${err.message}`);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by Card ID
app.get('/api/user/:cardId', verifyToken, async (req, res) => {
  try {
    const { cardId } = req.params;

    if (!cardId) {
      return res.status(400).json({ message: 'Card ID is required' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('cardId', sql.VarChar, cardId)
      .query('SELECT userid, username, name, division, role, org FROM Users WHERE userid = @cardId');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found for this Card ID' });
    }

    const user = result.recordset[0];
    res.json({
      userid: user.userid,
      username: user.username,
      name: user.name,
      division: user.division,
      role: user.role,
      org: user.org,
    });
  } catch (err) {
    console.error('Error fetching user by Card ID:', err);
    res.status(500).json({ message: 'Failed to fetch user information' });
  }
});

// New endpoint: Update user details
app.patch('/api/user/:userid', verifyToken, requireADMIN, async (req, res) => {
  try {
    const { userid } = req.params;
    const { username, division, name, role, password } = req.body;
    
    if (!username || !name) {
      return res.status(400).json({ message: 'Username and name are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    if (password && password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    // ตรวจสอบ username ซ้ำ (ยกเว้นตัวเอง)
    const existingUser = await request
      .input('checkUsername', sql.VarChar, username)
      .input('checkUserid', sql.VarChar, userid)
      .query('SELECT userid FROM Users WHERE username = @checkUsername AND userid != @checkUserid');

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({ message: 'Username already exists' });
    }

    // เริ่มสร้าง query
    const updateFields = [];
    const now = new Date();
    const thaiTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    updateFields.push('username = @username');
    updateFields.push('division = @division');
    updateFields.push('name = @name');
    updateFields.push('role = @role');
    updateFields.push('updated_at = @updated_at');

    request.input('username', sql.VarChar, username);
    request.input('division', sql.NVarChar, division);
    request.input('name', sql.NVarChar, name);
    request.input('role', sql.NVarChar, role);
    request.input('updated_at', sql.DateTime, thaiTime);
    request.input('userid', sql.VarChar, userid);

    // อัปเดตรหัสผ่านถ้ามี
    if (password) {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      updateFields.push('password = @password');
      request.input('password', sql.VarChar, hashedPassword);
    }

    const query = `
      UPDATE Users
      SET ${updateFields.join(', ')}
      WHERE userid = @userid;

      SELECT userid, username, division, name, role, created_at, updated_at
      FROM Users
      WHERE userid = @userid;
    `;

    const result = await request.query(query);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ส่ง response กลับ
    return res.json({
      message: 'User updated successfully',
      user: result.recordset[0]  // ส่ง user กลับไป
    });

  } catch (err) {
    console.error('Error updating user:', err);
    await logAction('UPDATE_USER_ERROR', req.params.userid, 'USER', `Error updating user: ${err.message}`);
    return res.status(500).json({ message: 'Failed to update user' });
  }
});

// Log action endpoint
app.post('/api/log', verifyToken, async (req, res) => {
  try {
    const { action, targetId, targetType, comment } = req.body;

    const success = await logAction(action, targetId, targetType, comment);
    if (!success) {
      throw new Error('Failed to log action');
    }

    res.json({ message: 'Action logged successfully' });
  } catch (err) {
    console.error('Log endpoint error:', err.message);
    res.status(500).json({ message: 'Failed to log action' });
  }
});

app.get('/api/profile', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('userid', sql.VarChar, req.user.userid)
      .query('SELECT userid, username, name, division, email, org, role FROM Users WHERE userid = @userid');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.recordset[0];
    res.json({
      userid: user.userid,
      username: user.username,
      name: user.name,
      division: user.division,
      email: user.email,
      org: user.org,
      role: user.role
    });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Failed to fetch user profile' });
  }
});

app.post('/api/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    const pool = await poolPromise;
    const request = pool.request();

    const userResult = await request
      .input('userid', sql.VarChar, req.user.userid)
      .query('SELECT password FROM Users WHERE userid = @userid');

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.recordset[0];

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const updateRequest = pool.request();
    await updateRequest
      .input('userid', sql.VarChar, req.user.userid)
      .input('newPassword', sql.VarChar, hashedNewPassword)
      .query('UPDATE Users SET password = @newPassword WHERE userid = @userid');

    await logAction('PASSWORD_CHANGE', req.user.userid, 'USER', `Password changed for user ${req.user.username}`);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Error changing password:', err);
    await logAction('PASSWORD_CHANGE_ERROR', req.user.userid, 'USER', `Error changing password: ${err.message}`);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

// Fetch storage data
app.get('/api/storage', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    let query;

    if (req.user.role === 'ADMIN') {
      query = `
        SELECT 
          r.po_no, 
          r.vendor, 
          r.item_name, 
          r.item_spec, 
          r.qty, 
          r.unit, 
          r.org,
          r.confirm_to,
          r.mfg,
          DATEDIFF(day, r.date, GETDATE()) AS duration_day, 
          r.division 
        FROM ReceiveEntries r
        WHERE r.po_no NOT IN (SELECT DISTINCT po_no FROM IssueEntries WHERE po_no IS NOT NULL)
      `;
    } else if (req.user.division === 'Common') {
      const userOrgs = req.user.org.split(',').map(org => org.trim());
      const orgConditions = userOrgs.map((_, index) => `r.org = @org${index}`).join(' OR ');
      
      query = `
        SELECT r.po_no, 
              r.vendor, 
              r.item_name, 
              r.item_spec, 
              r.qty, 
              r.unit, 
              r.org,
              r.confirm_to,
              r.mfg,
              DATEDIFF(day, r.date, GETDATE()) AS duration_day, 
              r.division
              FROM ReceiveEntries r
              WHERE (${orgConditions})
              AND r.po_no NOT IN (SELECT DISTINCT po_no FROM IssueEntries WHERE po_no IS NOT NULL)
      `;
      
      userOrgs.forEach((org, index) => {
        request.input(`org${index}`, sql.VarChar, org);
      });
    } else if (req.user.division === 'M/P 1') {
      const userOrgs = req.user.org.split(',').map(org => org.trim());
      const orgConditions = userOrgs.map((_, index) => `r.org = @org${index}`).join(' OR ');
      
      query = `
        SELECT r.po_no, 
              r.vendor, 
              r.item_name, 
              r.item_spec, 
              r.qty, 
              r.unit, 
              r.org,
              r.confirm_to,
              r.mfg,
              DATEDIFF(day, r.date, GETDATE()) AS duration_day, 
              r.division
              FROM ReceiveEntries r
              WHERE (${orgConditions}) AND r.division = 'M/P 1'
              AND r.po_no NOT IN (SELECT DISTINCT po_no FROM IssueEntries WHERE po_no IS NOT NULL)
      `;
      
      userOrgs.forEach((org, index) => {
        request.input(`org${index}`, sql.VarChar, org);
      });
    } else if (req.user.division === 'M/P 2') {
      const userOrgs = req.user.org.split(',').map(org => org.trim());
      const orgConditions = userOrgs.map((_, index) => `r.org = @org${index}`).join(' OR ');
      
      query = `
        SELECT r.po_no, 
              r.vendor, 
              r.item_name, 
              r.item_spec, 
              r.qty, 
              r.unit, 
              r.org,
              r.confirm_to,
              r.mfg,
              DATEDIFF(day, r.date, GETDATE()) AS duration_day, 
              r.division
              FROM ReceiveEntries r
              WHERE (${orgConditions}) AND r.division = 'M/P 2'
              AND r.po_no NOT IN (SELECT DISTINCT po_no FROM IssueEntries WHERE po_no IS NOT NULL)
      `;
      
      userOrgs.forEach((org, index) => {
        request.input(`org${index}`, sql.VarChar, org);
      });
    } else {
      query = `
        SELECT 
          r.po_no, 
          r.vendor, 
          r.item_name, 
          r.item_spec, 
          r.qty, 
          r.unit, 
          r.org,
          r.confirm_to,
          r.mfg,
          DATEDIFF(day, r.date, GETDATE()) AS duration_day, 
          r.division 
        FROM ReceiveEntries r
        WHERE  r.po_no NOT IN (SELECT DISTINCT po_no FROM IssueEntries WHERE po_no IS NOT NULL)
      `;
      request.input('userid', sql.VarChar, req.user.userid);
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching storage data:', err);
    res.status(500).json({ message: 'Failed to fetch storage data' });
  }
});

// Fetch history data
app.get('/api/history', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    let whereClause = '';
    if (req.user.role === 'ADMIN') {
      // ADMIN เห็นข้อมูลทั้งหมด ไม่ต้องมีเงื่อนไขเพิ่มเติม
      whereClause = ''; 
    } else if (req.user.division === 'M/P 1') {
      whereClause = " AND IM.division = 'M/P 1'";
    } else if (req.user.division === 'M/P 2') {
      whereClause = " AND IM.division = 'M/P 2'";
    } else {
      // User ทั่วไป เห็นเฉพาะ item ที่ตัวเองเป็นคนสร้าง (add_item_master_by)
      whereClause = " AND IM.add_item_master_by = @issued_by";
      request.input('issued_by', sql.NVarChar, req.user.name);
    }

    const query = `
      WITH CabinetInfo AS (
        SELECT
            CabinetID,
            CONCAT(CabinetName, '-', CabinetLevel, '-', CabinetNo) AS Location
        FROM
            Cabinets
      ),
      FullData AS (
        SELECT
            i.ItemNo, i.iqc, i.OnStock, i.Active,
            ci_iqc.Location AS IQC_Location,
            ci_onstock.Location AS OnStock_Location,
            ci_active.Location AS Active_Location
        FROM
            Items AS i
            LEFT JOIN CabinetInfo AS ci_iqc ON i.CabinetID_IQC = ci_iqc.CabinetID
            LEFT JOIN CabinetInfo AS ci_onstock ON i.CabinetID_OnStock = ci_onstock.CabinetID
            LEFT JOIN CabinetInfo AS ci_active ON i.CabinetID_Active = ci_active.CabinetID
      )

      SELECT
          FullData.ItemNo, IM.item_name, IM.vendor_code, IM.vendor_name, IM.spec,
          IM.drwg, IM.account, IM.unit_price, IM.currency, IM.safety_stock, IM.division,
          IM.created_at, 'IQC' AS Type, FullData.iqc AS Qty, FullData.IQC_Location AS Location
      FROM FullData
      LEFT JOIN ItemMaster AS IM ON FullData.ItemNo = IM.item_no
      WHERE FullData.iqc > 0 ${whereClause}

      UNION ALL

      SELECT
          FullData.ItemNo, IM.item_name, IM.vendor_code, IM.vendor_name, IM.spec,
          IM.drwg, IM.account, IM.unit_price, IM.currency, IM.safety_stock, IM.division,
          IM.created_at, 'OnStock' AS Type, FullData.OnStock AS Qty, FullData.OnStock_Location AS Location
      FROM FullData
      LEFT JOIN ItemMaster AS IM ON FullData.ItemNo = IM.item_no
      WHERE FullData.OnStock > 0 ${whereClause}

      UNION ALL

      SELECT
          FullData.ItemNo, IM.item_name, IM.vendor_code, IM.vendor_name, IM.spec,
          IM.drwg, IM.account, IM.unit_price, IM.currency, IM.safety_stock, IM.division,
          IM.created_at, 'Active' AS Type, FullData.Active AS Qty, FullData.Active_Location AS Location
      FROM FullData
      LEFT JOIN ItemMaster AS IM ON FullData.ItemNo = IM.item_no
      WHERE FullData.Active > 0 ${whereClause}

      ORDER BY
          ItemNo, Type;
    `;

    const result = await request.query(query);
    res.json(result.recordset);

  } catch (err) {
    console.error('Error fetching inventory report:', err);
    res.status(500).json({ message: 'Failed to fetch inventory report' });
  }
});

// Fetch all users
app.get('/api/userall', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    let query;

    if (req.user.role === 'ADMIN') {
      query = `
        SELECT 
          username,
          userid,
          division,
          name,
          role,
          created_at,
          updated_at
        FROM Users 
        ORDER BY updated_at DESC
      `;
    } else {
      query = `
        SELECT 
          username,
          userid,
          email
        FROM Users 
        WHERE username = @username
        ORDER BY updated_at DESC
      `;
      request.input('username', sql.NVarChar, req.user.username);
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching user data:', err);
    res.status(500).json({ message: 'Failed to fetch user data' });
  }
});


// ========== ITEM MASTER ROUTES ==========
// ADD ITEM POST
app.post('/api/add_item_master', verifyToken, requireADMIN, async (req, res) => {
  try {
    const {
      item_no,
      card_id,
      date,
      vendor_code,
      vendor_name,
      item_name,
      spec,
      drwg,
      account,
      unit_price,
      currency,
      safety_stock,
      on_hand,
      pur_lead_time,
      division,
      issued_by
    } = req.body;

    if (!item_no || !division || !issued_by) {
      return res.status(400).json({
        message: 'Required fields are missing: item_no, division, issued_by'
      });
    }

    const upperItemNo = item_no.toUpperCase();
    const pool = await poolPromise;

    // ตรวจสอบ item ซ้ำ
    const checkRequest = pool.request();
    const result = await checkRequest
      .input('item_no', sql.NVarChar, upperItemNo)
      .query('SELECT COUNT(*) AS count FROM ItemMaster WHERE item_no = @item_no');

    if (result.recordset[0].count > 0) {
      return res.status(409).json({
        message: `Item No. ${upperItemNo} already exists.`
      });
    }

    // Insert ข้อมูลใหม่
    const insertRequest = pool.request();
    await insertRequest
      .input('item_no', sql.NVarChar, upperItemNo)
      .input('card_id', sql.NVarChar, card_id || null)
      .input('date', sql.Date, date ? new Date(date) : null)
      .input('vendor_code', sql.NVarChar, vendor_code || null)
      .input('vendor_name', sql.NVarChar, vendor_name || null)
      .input('item_name', sql.NVarChar, item_name || null)
      .input('spec', sql.NVarChar, spec || null)
      .input('drwg', sql.NVarChar, drwg || null)
      .input('account', sql.NVarChar, account || null)
      .input('unit_price', sql.Decimal(18, 4), unit_price ? parseFloat(unit_price) : null)
      .input('currency', sql.NVarChar, currency || null)
      .input('safety_stock', sql.Int, safety_stock ? parseInt(safety_stock) : null)
      .input('on_hand', sql.Int, on_hand ? parseInt(on_hand) : null)
      .input('pur_lead_time', sql.Int, pur_lead_time ? parseInt(pur_lead_time) : null)
      .input('division', sql.NVarChar, division)
      .input('issued_by', sql.NVarChar, issued_by)
      .query(`
        INSERT INTO ItemMaster (
          item_no, card_id, date, vendor_code, vendor_name, item_name, spec, drwg,
          account, unit_price, currency, safety_stock, on_hand, pur_lead_time,
          division, add_item_master_by, created_at, updated_at
        )
        VALUES (
          @item_no, @card_id, @date, @vendor_code, @vendor_name, @item_name, @spec, @drwg,
          @account, @unit_price, @currency, @safety_stock, @on_hand, @pur_lead_time,
          @division, @issued_by, GETDATE(), GETDATE()
        )
      `);

    await logAction('ADD_ITEM_MASTER', upperItemNo, 'ITEM', `Added item ${upperItemNo} by ${issued_by}`);
    return res.status(201).json({ message: 'Item Master created successfully', item_no: upperItemNo });
  } catch (err) {
    console.error('Error creating item master:', err);
    await logAction('ADD_ITEM_MASTER_ERROR', null, 'SYSTEM', `Error: ${err.message}`);
    return res.status(500).json({ message: 'Failed to create item master', error: err.message });
  }
});

// view item master
app.get('/api/view_item_master', verifyToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    let query = `
      SELECT TOP(100)
        item_no, 
        card_id, 
        date, 
        vendor_code, 
        vendor_name, 
        item_name, 
        spec,
        drwg,
        account,
        unit_price,
        currency, 
        safety_stock,
        on_hand,
        pur_lead_time,
        division,
        add_item_master_by,
        created_at
      FROM ItemMaster
    `;

    // กรองตามบทบาทผู้ใช้
    if (req.user.role === 'ADMIN') {
      query += ' ORDER BY created_at DESC';
    } else if (req.user.division === 'M/P 1') {
      query += " WHERE division = 'M/P 1' ORDER BY created_at DESC";
    } else if (req.user.division === 'M/P 2') {
      query += " WHERE division = 'M/P 2' ORDER BY created_at DESC";
    } else {
      // สำหรับ user ทั่วไป: แสดงเฉพาะของตัวเอง
      query += " WHERE issued_by = @issued_by ORDER BY created_at DESC";
      request.input('issued_by', sql.NVarChar, req.user.name);
    }

    const result = await request.query(query);
    return res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching item master data:', err);
    return res.status(500).json({ message: 'Failed to fetch item master data' });
  }
});

app.put('/api/update_item_master/:item_no', verifyToken, requireADMIN, async (req, res) => {
  try {
    const { item_no } = req.params;

    const {
      card_id,
      date,
      vendor_code,
      vendor_name,
      item_name,
      spec,
      drwg,
      account,
      unit_price,
      currency,
      safety_stock,
      on_hand,
      pur_lead_time,
      division
    } = req.body;

    if (!item_no) {
      return res.status(400).json({ message: 'Item No is required' });
    }

    const pool = await poolPromise;

    // --- 1. ตรวจสอบว่า item มีอยู่จริง ---
    const checkRequest = pool.request(); // สร้าง request ใหม่
    const checkResult = await checkRequest
      .input('item_no', sql.NVarChar, item_no)
      .query('SELECT COUNT(*) AS count FROM ItemMaster WHERE item_no = @item_no');

    if (checkResult.recordset[0].count === 0) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // --- 2. อัปเดตข้อมูล ---
    const updateRequest = pool.request(); // สร้าง request ใหม่อีกตัว
    const fields = [];
    const inputs = {
      item_no: sql.NVarChar,
      card_id: sql.NVarChar,
      date: sql.Date,
      vendor_code: sql.NVarChar,
      vendor_name: sql.NVarChar,
      item_name: sql.NVarChar,
      spec: sql.NVarChar,
      drwg: sql.NVarChar,
      account: sql.NVarChar,
      unit_price: sql.Decimal(18, 4),
      currency: sql.NVarChar,
      safety_stock: sql.Int,
      on_hand: sql.Int,
      pur_lead_time: sql.Int,
      division: sql.NVarChar
    };

    for (const [key, type] of Object.entries(inputs)) {
      if (req.body[key] !== undefined && req.body[key] !== null) {
        fields.push(`${key} = @${key}`);
        let value = req.body[key];

        if (type === sql.Date && value) value = new Date(value);
        if (type === sql.Decimal(18, 4) && value) value = parseFloat(value);
        if (type === sql.Int && value) value = parseInt(value, 10);

        updateRequest.input(key, type, value); // ใช้ updateRequest
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    fields.push('updated_at = GETDATE()');

    const query = `
      UPDATE ItemMaster
      SET ${fields.join(', ')}
      WHERE item_no = @item_no
    `;

    await updateRequest.query(query); // ใช้ updateRequest

    // --- 3. บันทึก log ---
    const logRequest = pool.request(); // อีก request สำหรับ log
    await logRequest
      .input('action', sql.NVarChar, 'UPDATE_ITEM_MASTER')
      .input('targetId', sql.NVarChar, item_no)
      .input('targetType', sql.NVarChar, 'ITEM')
      .input('comment', sql.NVarChar, `Updated item ${item_no} by ${req.user.name}`)
      .query(`
        INSERT INTO logs (action, target_id, target_type, comment, created_at)
        VALUES (@action, @targetId, @targetType, @comment, GETDATE())
      `);

    return res.json({ message: 'Item updated successfully', item_no });
  } catch (err) {
    console.error('Error updating item master:', err);
    return res.status(500).json({ message: 'Failed to update item' });
  }
});

// ========== RECIEVE ROUTES ==========
app.post('/api/update_item_balance', verifyToken, requireADMIN, async (req, res) => {
  const { itemNo, iqc, onStock, active, cabinetId_IQC, cabinetId_OnStock, cabinetId_Active } = req.body;

  // Validate
  if (![iqc, onStock, active].every(x => Number.isInteger(x) && x >= 0)) {
    return res.status(400).json({ message: 'จำนวนต้องเป็นตัวเลขและไม่น้อยกว่า 0' });
  }

  if (iqc + onStock + active === 0) {
    return res.status(400).json({ message: 'ต้องมีจำนวนอย่างน้อย 1' });
  }

  try {
    const pool = await poolPromise;

    // ตรวจสอบว่า item มีอยู่
    const itemCheck = await pool.request()
      .input('itemNo', sql.VarChar, itemNo)
      .query('SELECT item_no FROM ItemMaster WHERE item_no = @itemNo');

    if (itemCheck.recordset.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ Item' });
    }

    // อัปเดตหรือเพิ่มใน Items table (สมมติว่ามีตารางนี้)
    await pool.request()
      .input('itemNo', sql.VarChar, itemNo)
      .input('iqc', sql.Int, iqc)
      .input('onStock', sql.Int, onStock)
      .input('active', sql.Int, active)
      .input('cabinetId_IQC', sql.Int, cabinetId_IQC)
      .input('cabinetId_OnStock', sql.Int, cabinetId_OnStock)
      .input('cabinetId_Active', sql.Int, cabinetId_Active)
      .query(`
        IF EXISTS (SELECT 1 FROM Items WHERE ItemNo = @itemNo)
          UPDATE Items SET
            IQC = IQC + @iqc,
            OnStock = OnStock + @onStock,
            Active = Active + @active,
            CabinetID_IQC = ISNULL(@cabinetId_IQC, CabinetID_IQC),
            CabinetID_OnStock = ISNULL(@cabinetId_OnStock, CabinetID_OnStock),
            CabinetID_Active = ISNULL(@cabinetId_Active, CabinetID_Active)
          WHERE ItemNo = @itemNo
        ELSE
          INSERT INTO Items (ItemNo, IQC, OnStock, Active, CabinetID_IQC, CabinetID_OnStock, CabinetID_Active)
          VALUES (@itemNo, @iqc, @onStock, @active, @cabinetId_IQC, @cabinetId_OnStock, @cabinetId_Active)
      `);

    await logAction('RECEIVE_ITEM', null, 'ITEM', `รับของ: ${itemNo}, IQC=${iqc}, OnStock=${onStock}, Active=${active}`);

    res.json({ success: true, message: 'รับของสำเร็จ' });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ message: 'บันทึกไม่สำเร็จ' });
  }
});

// GET /api/item_balance/:itemNo
app.get('/api/item_balance/:itemNo', verifyToken, requireCommon, async (req, res) => {
  const { itemNo } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('itemNo', sql.VarChar, itemNo)
      .query(`
        SELECT 
          i.IQC,
          i.OnStock,
          i.Active,
          im.safety_stock,
          cab_iqc.CabinetName AS CabinetName_IQC,
          cab_iqc.CabinetLevel AS CabinetLevel_IQC,
          cab_iqc.CabinetNo AS CabinetNo_IQC,
          cab_onstock.CabinetName AS CabinetName_OnStock,
          cab_onstock.CabinetLevel AS CabinetLevel_OnStock,
          cab_onstock.CabinetNo AS CabinetNo_OnStock,
          cab_active.CabinetName AS CabinetName_Active,
          cab_active.CabinetLevel AS CabinetLevel_Active,
          cab_active.CabinetNo AS CabinetNo_Active
        FROM Items i
        JOIN ItemMaster im ON i.ItemNo = im.item_no
        LEFT JOIN Cabinets cab_iqc ON cab_iqc.CabinetID = i.CabinetID_IQC
        LEFT JOIN Cabinets cab_onstock ON cab_onstock.CabinetID = i.CabinetID_OnStock
        LEFT JOIN Cabinets cab_active ON cab_active.CabinetID = i.CabinetID_Active
        WHERE i.ItemNo = @itemNo
      `);

    if (result.recordset.length === 0) {
      return res.json({ success: true, data: null }); // ไม่มีข้อมูลก็ไม่ผิด
    }

    res.json({ success: true, data: result.recordset[0] });
  } catch (error) {
    console.error('Error fetching item balance:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ========== AUDIT LOG ROUTES ==========
app.get('/api/audit_logs/:targetType/:targetId', verifyToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const pool = await poolPromise;
    const request = pool.request();

    const result = await request
      .input('targetType', sql.NVarChar, targetType)
      .input('targetId', sql.NVarChar, targetId)
      .query(`
        SELECT 
          action,
          comment,
          created_at,
          LTRIM(RIGHT(comment, CHARINDEX(' ', REVERSE(comment)) - 1)) AS [user]
        FROM logs 
        WHERE target_type = @targetType 
          AND target_id = @targetId
        ORDER BY created_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

// ========== CABINET ROUTES ==========
// GET /api/cabinets - Fetch all cabinets
app.get('/api/cabinets', verifyToken, requireCommon, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT CabinetID, CabinetName, CabinetLevel, CabinetNo 
      FROM [MECHA_PURCHASE_TOOLING].[dbo].[Cabinets]
      ORDER BY CabinetName, CabinetLevel, CabinetNo
    `);
    await logAction('VIEW_CABINETS', null, 'CABINETS', `User ${req.user.username} viewed all cabinets`);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Error fetching cabinets:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/cabinets - Add new cabinet
app.post('/api/cabinets', verifyToken, requireADMIN, async (req, res) => {
  const { cabinetName, cabinetLevel, cabinetNo } = req.body;
  try {
    const pool = await poolPromise;

    // Check for duplicates
    const existing = await pool.request()
      .input('cabinetName', sql.NVarChar, cabinetName)
      .input('cabinetLevel', sql.NVarChar, cabinetLevel)
      .input('cabinetNo', sql.NVarChar, cabinetNo)
      .query(`
        SELECT * FROM [MECHA_PURCHASE_TOOLING].[dbo].[Cabinets]
        WHERE CabinetName = @cabinetName 
        AND CabinetLevel = @cabinetLevel 
        AND CabinetNo = @cabinetNo
      `);

    if (existing.recordset.length > 0) {
      return res.json({ success: false, message: 'Cabinet already exists' });
    }

    // Insert new cabinet
    const insertResult = await pool.request()
      .input('cabinetName', sql.NVarChar, cabinetName)
      .input('cabinetLevel', sql.NVarChar, cabinetLevel)
      .input('cabinetNo', sql.NVarChar, cabinetNo)
      .query(`
        INSERT INTO [MECHA_PURCHASE_TOOLING].[dbo].[Cabinets] 
        (CabinetName, CabinetLevel, CabinetNo)
        OUTPUT INSERTED.CabinetID
        VALUES (@cabinetName, @cabinetLevel, @cabinetNo)
      `);

    const cabinetId = insertResult.recordset[0]?.CabinetID;
    await logAction('ADD_CABINET', cabinetId, 'CABINET', `User ${req.user.username} added cabinet ${cabinetName}, Level: ${cabinetLevel}, No: ${cabinetNo}`);

    res.json({ success: true, message: 'Cabinet added successfully' });
  } catch (error) {
    console.error('Error adding cabinet:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/cabinets/:cabinetId/items - Fetch items in a cabinet
app.get('/api/cabinets/:cabinetId/items', verifyToken, requireCommon, async (req, res) => {
  const { cabinetId } = req.params;
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('cabinetId', sql.Int, cabinetId)
      .query(`
        SELECT 
          'IQC' AS LocationZone,
          i.ItemNo,
          im.item_name AS ItemName,
          i.IQC AS Quantity,
          c.CabinetName,
          c.CabinetLevel,
          c.CabinetNo
        FROM Items i
        JOIN ItemMaster im ON i.ItemNo = im.item_no
        JOIN Cabinets c ON c.CabinetID = i.CabinetID_IQC
        WHERE i.CabinetID_IQC = @cabinetId AND i.IQC > 0

        UNION ALL

        SELECT 
          'OnStock' AS LocationZone,
          i.ItemNo,
          im.item_name AS ItemName,
          i.OnStock AS Quantity,
          c.CabinetName,
          c.CabinetLevel,
          c.CabinetNo
        FROM Items i
        JOIN ItemMaster im ON i.ItemNo = im.item_no
        JOIN Cabinets c ON c.CabinetID = i.CabinetID_OnStock
        WHERE i.CabinetID_OnStock = @cabinetId AND i.OnStock > 0

        UNION ALL

        SELECT 
          'Active' AS LocationZone,
          i.ItemNo,
          im.item_name AS ItemName,
          i.Active AS Quantity,
          c.CabinetName,
          c.CabinetLevel,
          c.CabinetNo
        FROM Items i
        JOIN ItemMaster im ON i.ItemNo = im.item_no
        JOIN Cabinets c ON c.CabinetID = i.CabinetID_Active
        WHERE i.CabinetID_Active = @cabinetId AND i.Active > 0

        ORDER BY ItemNo, LocationZone
      `);

    await logAction('VIEW_CABINET_ITEMS', cabinetId, 'CABINET_ITEMS', 
      `User ${req.user.username} viewed items in cabinet ${cabinetId}`);

    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Error fetching cabinet items:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/cabinets/:id
app.delete('/api/cabinets/:id', verifyToken, requireADMIN, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolPromise;

    // ตรวจสอบว่ามี item อยู่หรือไม่
    const itemCheck = await pool.request()
      .input('cabinetId', sql.Int, id)
      .query(`
        SELECT TOP 1 * FROM Items 
        WHERE CabinetID_IQC = @cabinetId OR CabinetID_OnStock = @cabinetId OR CabinetID_Active = @cabinetId
      `);

    if (itemCheck.recordset.length > 0) {
      return res.json({ success: false, message: 'Cannot delete cabinet with items inside' });
    }

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM [MECHA_PURCHASE_TOOLING].[dbo].[Cabinets] WHERE CabinetID = @id`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Cabinet not found' });
    }

    await logAction('DELETE_CABINET', id, 'CABINET', `User ${req.user.username} deleted cabinet ID: ${id}`);
    res.json({ success: true, message: 'Cabinet deleted successfully' });
  } catch (error) {
    console.error('Error deleting cabinet:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/cabinets/:id
app.put('/api/cabinets/:id', verifyToken, requireADMIN, async (req, res) => {
  const { id } = req.params;
  const { cabinetName, cabinetLevel, cabinetNo } = req.body;

  try {
    const pool = await poolPromise;

    // ตรวจสอบว่ามีซ้ำหรือไม่ (ยกเว้นตัวเอง)
    const existing = await pool.request()
      .input('cabinetName', sql.NVarChar, cabinetName)
      .input('cabinetLevel', sql.NVarChar, cabinetLevel)
      .input('cabinetNo', sql.NVarChar, cabinetNo)
      .input('id', sql.Int, id)
      .query(`
        SELECT * FROM [MECHA_PURCHASE_TOOLING].[dbo].[Cabinets]
        WHERE CabinetName = @cabinetName 
          AND CabinetLevel = @cabinetLevel 
          AND CabinetNo = @cabinetNo
          AND CabinetID != @id
      `);

    if (existing.recordset.length > 0) {
      return res.json({ success: false, message: 'Duplicate cabinet configuration' });
    }

    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('cabinetName', sql.NVarChar, cabinetName)
      .input('cabinetLevel', sql.NVarChar, cabinetLevel)
      .input('cabinetNo', sql.NVarChar, cabinetNo)
      .query(`
        UPDATE [MECHA_PURCHASE_TOOLING].[dbo].[Cabinets]
        SET CabinetName = @cabinetName, CabinetLevel = @cabinetLevel, CabinetNo = @cabinetNo
        WHERE CabinetID = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Cabinet not found' });
    }

    await logAction('EDIT_CABINET', id, 'CABINET', 
      `User ${req.user.username} edited cabinet ID: ${id} to ${cabinetName}, Level: ${cabinetLevel}, No: ${cabinetNo}`);

    res.json({ success: true, message: 'Cabinet updated successfully' });
  } catch (error) {
    console.error('Error updating cabinet:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// ========== REACT ROUTER FALLBACK ==========
app.get('/MECHATOOLINGPS/*', (req, res) => {
  console.log('Serving React app for:', req.path);
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.get('/MECHATOOLINGPS', (req, res) => {
  console.log('Serving React app for root MECHATOOLINGPS');
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});