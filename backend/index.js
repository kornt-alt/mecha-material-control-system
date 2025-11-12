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
app.use('/MECHA-MATERIAL-SYSTEM', express.static(path.join(__dirname, 'build')));
app.use('/MECHA-MATERIAL-SYSTEM/static', express.static(path.join(__dirname, 'build/static')));

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
  const userRoles = (req.user.role || '').split(',').map(role => role.trim());
  
  if (!userRoles.includes('ADMIN')) {
    return res.status(403).json({ message: 'ADMIN role required' });
  }
  next();
};

const requireCommon = (req, res, next) => {
  const userRoles = (req.user.role || '').split(',').map(role => role.trim());
  
  const hasRequiredRole = userRoles.some(role => 
    ['ADMIN', 'Common', 'RECEIVE', 'ISSUE'].includes(role)
  );

  if (!hasRequiredRole) {
    // (แก้ไข Error message ให้ตรงกับ Role ที่เช็ค)
    return res.status(403).json({ message: 'ADMIN, Common, RECEIVE or ISSUE role required' });
  }
  next();
};

// ========== NEW MIDDLEWARE FOR RECEIVE ROLE ========== //
const requireReceiveRole = (req, res, next) => {
  const userRoles = (req.user.role || '').split(',').map(role => role.trim());
  
  const hasRequiredRole = userRoles.some(role => 
    ['ADMIN', 'RECEIVE'].includes(role)
  );

  if (!hasRequiredRole) {
    return res.status(403).json({ message: 'ADMIN or RECEIVE role required' });
  }
  next();
};
// =================================================== //

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
      .query('SELECT * FROM Users WHERE userid = @userid'); // <-- SELECT * เอามาหมดอยู่แล้ว

    if (result.recordset.length === 0) {
      await logAction('LOGIN_ATTEMPT', userid, 'USER', `Failed login for userid: ${userid}`);
      return res.status(401).json({ message: 'User not found' });
    }

    const user = result.recordset[0];

    const token = jwt.sign(
      { 
        userid: user.userid, 
        role: user.role, 
        name: user.name, 
        division: user.division // <-- ✅ เพิ่ม division ตรงนี้
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction('LOGIN_SUCCESS', userid, 'USER', `User ${userid} logged in successfully`);

    res.json({
      token,
      user: { 
        userid: user.userid, 
        name: user.name, 
        role: user.role,
        division: user.division // (เพิ่มตรงนี้ด้วยก็ได้ client จะได้เห็น)
      },
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


// ========== NEW API ROUTES FOR RECEIVE & INVENTORY ========== //

app.post('/api/inventory/direct-receive', verifyToken, requireReceiveRole, async (req, res) => {
  // 1. รับค่าใหม่
  const { itemNo, locationName, subLocation, actualQty } = req.body;
  const userId = req.user.userid;

  // 2. Validate
  if (!itemNo || !locationName || !actualQty || actualQty <= 0) {
    return res.status(400).json({ message: 'Item No, Location, Sub Location, and a valid Qty are required' });
  }

  const pool = await poolPromise;
  
  // --- VALIDATION (เช็ค Item Master) ---
  try {
    const itemCheckRequest = pool.request();
    itemCheckRequest.input('itemNo', sql.NVarChar, itemNo);
    const itemResult = await itemCheckRequest.query('SELECT ITEM_NO FROM MC_ITEM_MASTER WHERE ITEM_NO = @itemNo');
    
    if (itemResult.recordset.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ item no นี้ใน Master กรุณาตรวจสอบใหม่อีกครั้ง' });
    }

    // --- เริ่ม Transaction ---
    const transaction = pool.transaction();
    await transaction.begin();
    
    const stockRequest = transaction.request();
    stockRequest.input('itemNo', sql.NVarChar, itemNo);
    stockRequest.input('locationName', sql.NVarChar, locationName);
    stockRequest.input('subLocation', sql.NVarChar, subLocation); // <-- 3. เพิ่ม
    stockRequest.input('receivedQty', sql.Decimal(18, 4), parseFloat(actualQty));

    // 4. อัปเกรด MERGE Query
    const mergeStockQuery = `
      MERGE INTO MC_INVENTORY_STOCK AS target
      USING (
        SELECT @itemNo AS ITEM_NO, @locationName AS LOCATION_NAME, @subLocation AS SUB_LOCATION
      ) AS source
      ON (
        target.ITEM_NO = source.ITEM_NO AND 
        target.LOCATION_NAME = source.LOCATION_NAME AND
        ISNULL(target.SUB_LOCATION, '') = ISNULL(source.SUB_LOCATION, '')
      )
      
      WHEN MATCHED THEN
        UPDATE SET 
          QTY = target.QTY + @receivedQty,
          LAST_UPDATE = GETDATE()
          
      WHEN NOT MATCHED THEN
        INSERT (ITEM_NO, LOCATION_NAME, SUB_LOCATION, QTY, LAST_UPDATE) -- <-- 5. เพิ่ม
        VALUES (@itemNo, @locationName, @subLocation, @receivedQty, GETDATE()); -- <-- 5. เพิ่ม
    `;

    await stockRequest.query(mergeStockQuery);
    
    await transaction.commit();
    await logAction('DIRECT_RECEIVE', itemNo, 'INVENTORY', `Direct received ${actualQty} of ${itemNo} to ${locationName}/${subLocation} by ${userId}`);
    res.json({ message: 'Stock updated successfully (Direct Receive)' });

  } catch (err) {
    // (ถ้า transaction ถูกสร้างแล้ว ให้ rollback)
    // await transaction.rollback(); 
    console.error('Error during direct receive:', err);
    res.status(500).json({ message: err.message || 'Failed to update stock' });
  }
});

// 1. API สำหรับสร้างแผนการรับของ (Receive Schedule)
app.post('/api/receive/schedule', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const { itemNo, location, scheduledQty, scheduledDateTime } = req.body;

    // 1. ตรวจสอบข้อมูลเบื้องต้น
    if (!itemNo || !location || !scheduledQty || !scheduledDateTime) {
      return res.status(400).json({ message: 'Missing required fields: itemNo, location, scheduledQty, scheduledDateTime' });
    }

    const pool = await poolPromise;

    // 2. ดึง DIVISION_SCRIPT จากตาราง Master เพื่อใช้ในการกรองสิทธิ์
    const itemRequest = pool.request();
    itemRequest.input('itemNo', sql.NVarChar, itemNo);
    const itemResult = await itemRequest.query('SELECT DIVISION_SCRIPT FROM MC_ITEM_MASTER WHERE ITEM_NO = @itemNo');

    if (itemResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Item Not Found in Master' });
    }
    const divisionScript = itemResult.recordset[0].DIVISION_SCRIPT;
    
    // (Optional) ตรวจสอบสิทธิ์ Division ตรงนี้
    if (req.user.role !== 'ADMIN' && req.user.division !== divisionScript) {
      return res.status(403).json({ message: 'คุณเป็นคนไม่มีสิทธิ์ - Hugo' });
    }

    // 3. บันทึกแผนลงในตาราง MC_SCHEDULED_RECEIVES
    const scheduleRequest = pool.request();
    scheduleRequest.input('itemNo', sql.NVarChar, itemNo);
    scheduleRequest.input('scheduledDateTime', sql.DateTime, new Date(scheduledDateTime));
    scheduleRequest.input('scheduledQty', sql.Decimal(18, 4), parseFloat(scheduledQty));
    scheduleRequest.input('locationName', sql.NVarChar, location); // เช่น 'FACTORY_6'
    scheduleRequest.input('status', sql.NVarChar, 'PENDING');
    scheduleRequest.input('divisionScript', sql.NVarChar, divisionScript);
    
    const insertQuery = `
      INSERT INTO MC_SCHEDULED_RECEIVES 
        (ITEM_NO, SCHEDULED_DATETIME, SCHEDULED_QTY, LOCATION_NAME, STATUS, DIVISION_SCRIPT)
      VALUES 
        (@itemNo, @scheduledDateTime, @scheduledQty, @locationName, @status, @divisionScript);
      
      SELECT SCOPE_IDENTITY() AS scheduleId; -- ส่ง ID ของแถวที่สร้างใหม่กลับไป
    `;
    
    const result = await scheduleRequest.query(insertQuery);
    const newScheduleId = result.recordset[0].scheduleId;

    res.status(201).json({ 
      message: 'Receive schedule created successfully', 
      scheduleId: newScheduleId 
    });

  } catch (err) {
    console.error('Error creating receive schedule:', err);
    res.status(500).json({ message: 'Failed to create schedule' });
  }
});

// ตารางสำหรับ Schedule

app.get('/api/receive/schedules', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      sortKey = 'SCHEDULED_DATETIME',
      sortDir = 'desc'
    } = req.query;

    const pool = await poolPromise;
    const request = pool.request();

    const pageInt = parseInt(page, 10);
    const limitInt = parseInt(limit, 10);
    const offset = (pageInt - 1) * limitInt;

    const allowedSortKeys = [
      'SCHEDULE_ID', 'ITEM_NO', 'ITEM_NAME', 'SCHEDULED_DATETIME', 
      'CONFIRM_DATETIME', 'STATUS', 'LOCATION_NAME', 'SCHEDULED_QTY', 'ACTUAL_QTY',
      'RECEIVED_BY_NAME'
    ];
    const safeSortKey = allowedSortKeys.includes(sortKey) ? sortKey : 'SCHEDULED_DATETIME';
    const safeSortDir = ['asc', 'desc'].includes(sortDir.toLowerCase()) ? sortDir.toLowerCase() : 'desc';

    const whereConditions = [];

    if (req.user.role !== 'ADMIN') {
      whereConditions.push(`s.DIVISION_SCRIPT = @userDivision`);
      request.input('userDivision', sql.NVarChar, req.user.division);
    }

    const searchTerm = (search || '').trim();
    if (searchTerm !== '') {
      request.input('searchTerm', sql.NVarChar, `%${searchTerm}%`);
      whereConditions.push(`
        (
          s.ITEM_NO LIKE @searchTerm OR
          i.ITEM_NAME LIKE @searchTerm OR
          s.LOCATION_NAME LIKE @searchTerm OR
          s.STATUS LIKE @searchTerm OR
          u.name LIKE @searchTerm OR
          u.name IS NULL
        )
        
      `);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        s.SCHEDULE_ID,
        s.ITEM_NO,
        i.ITEM_NAME,
        s.LOCATION_NAME,
        s.STATUS,
        s.SCHEDULED_QTY,
        s.ACTUAL_QTY,
        s.SCHEDULED_DATETIME,
        s.CONFIRM_DATETIME,
        u.name AS RECEIVED_BY_NAME,
        COUNT(*) OVER() AS TotalCount 
      FROM MC_SCHEDULED_RECEIVES s
      LEFT JOIN MC_ITEM_MASTER i ON s.ITEM_NO = i.ITEM_NO
      LEFT JOIN Users u ON s.RECEIVED_BY_USERID = u.userid
      ${whereClause}
      ORDER BY ${safeSortKey} ${safeSortDir}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY;
    `;

    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, limitInt);

    const result = await request.query(query);
    const totalCount = result.recordset.length > 0 ? result.recordset[0].TotalCount : 0;

    res.json({
      data: result.recordset,
      totalCount: totalCount
    });

  } catch (err) {
    console.error('Error fetching receive schedules:', err);
    res.status(500).json({ message: 'Failed to fetch receive schedules' });
  }
});

// 2. API สำหรับดึงรายการที่ต้องยืนยัน (สำหรับ Popup)
app.get('/api/receive/pending', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    
    // สร้างเงื่อนไข WHERE ตามสิทธิ์
    const whereConditions = [
      "s.STATUS = 'PENDING'",
      "s.SCHEDULED_DATETIME <= GETDATE()"
    ];

    // กรองสิทธิ์ตาม Division ที่ User ถืออยู่
    if (req.user.role !== 'ADMIN') {
      // ตรงกับ `s.DIVISION_SCRIPT` ใน MC_SCHEDULED_RECEIVES
      whereConditions.push(`s.DIVISION_SCRIPT = @userDivision`);
      request.input('userDivision', sql.NVarChar, req.user.division);
      
      // (ถ้าต้องกรองตาม org ด้วย ก็เพิ่ม logic ที่นี่)
    }
    
    const query = `
      SELECT 
        s.SCHEDULE_ID, 
        s.ITEM_NO, 
        i.ITEM_NAME, 
        s.SCHEDULED_QTY, 
        s.SCHEDULED_DATETIME, 
        s.LOCATION_NAME
      FROM MC_SCHEDULED_RECEIVES s
      LEFT JOIN MC_ITEM_MASTER i ON s.ITEM_NO = i.ITEM_NO
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY s.SCHEDULED_DATETIME ASC;
    `;
    
    const result = await request.query(query);
    res.json(result.recordset);

  } catch (err) {
    console.error('Error fetching pending receives:', err);
    res.status(500).json({ message: 'Failed to fetch pending receives' });
  }
});

app.post('/api/locations', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    // 1. กำหนดค่า default ให้ subLocation (ถ้าไม่ส่งมา = '')
    const { locationName, subLocation = '', division, description } = req.body;

    // 2. แก้ไข Validation (เอา subLocation ออก)
    if (!locationName || !division) {
      return res.status(400).json({ message: 'Location Name and Division are required' });
    }

    const pool = await poolPromise;
    const request = pool.request();
    
    request.input('locationName', sql.NVarChar, locationName);
    request.input('subLocation', sql.NVarChar, subLocation); // <-- จะเป็น '' (ค่าว่าง) ถ้าไม่กรอก
    request.input('division', sql.NVarChar, division);
    request.input('description', sql.NVarChar, description || null);

    // 3. ตรวจสอบข้อมูลซ้ำ
    const checkQuery = `
      SELECT 1 FROM MC_LOCATION_REF 
      WHERE LOCATION_NAME = @locationName AND ISNULL(SUB_LOCATION, '') = ISNULL(@subLocation, '')
    `;
    const checkResult = await request.query(checkQuery);

    if (checkResult.recordset.length > 0) {
      return res.status(409).json({ message: 'This Location / Sub Location combination already exists.' });
    }

    // 4. Insert (Logic นี้ถูกต้องแล้ว)
    const insertQuery = `
      INSERT INTO MC_LOCATION_REF 
        (LOCATION_NAME, SUB_LOCATION, DIVISION, DESCRIPTION, CREATE_ON)
      VALUES 
        (@locationName, @subLocation, @division, @description, GETDATE())
    `;
    
    await request.query(insertQuery);
    
    await logAction('LOCATION_ADD', subLocation || 'DEFAULT', 'LOCATION', `Location ${locationName}/${subLocation || 'DEFAULT'} added by ${req.user.userid}`);
    res.status(201).json({ message: 'Location added successfully' });

  } catch (err) {
    console.error('Error adding location:', err);
    // (เพิ่ม Error handling สำหรับ PK ซ้ำ)
    if (err.number === 2627 || err.number === 2601) { // Unique constraint violation
        return res.status(409).json({ message: 'This Location / Sub Location combination already exists.' });
    }
    res.status(500).json({ message: 'Failed to add location' });
  }
});

//  API: Get Locations based on User's Division
app.get('/api/locations', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    
    const whereConditions = [];
    // กรองตาม Division ถ้าไม่ใช่ Admin
    if (req.user.role !== 'ADMIN') {
      whereConditions.push(`DIVISION = @userDivision`);
      request.input('userDivision', sql.NVarChar, req.user.division);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT LOCATION_NAME, SUB_LOCATION
      FROM MC_LOCATION_REF
      ${whereClause}
      ORDER BY LOCATION_NAME, SUB_LOCATION;
    `;
    
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching locations:', err);
    res.status(500).json({ message: 'Failed to fetch locations' });
  }
});

// 3. API สำหรับยืนยันการรับของ (Confirm Receive)
app.post('/api/receive/confirm/:scheduleId', verifyToken, requireReceiveRole, async (req, res) => {
  const { scheduleId } = req.params;
  
  // 1. กำหนดค่า default ให้ subLocation (ถ้าไม่ส่งมา = '')
  const { actualQty, locationName, subLocation = '' } = req.body; 
  const userId = req.user.userid;

  // 2. เอา !subLocation ออกจาก Validation
  if (actualQty === undefined || actualQty === null || !locationName) {
    return res.status(400).json({ message: 'Actual Qty and Location are required' });
  }

  const pool = await poolPromise;
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    const scheduleRequest = transaction.request();
    scheduleRequest.input('scheduleId', sql.Int, scheduleId);
    scheduleRequest.input('actualQty', sql.Decimal(18, 4), parseFloat(actualQty));
    scheduleRequest.input('userId', sql.NVarChar, userId);
    scheduleRequest.input('finalLocationName', sql.NVarChar, locationName);
    scheduleRequest.input('finalSubLocation', sql.NVarChar, subLocation); // <-- ส่ง '' (ค่าว่าง) เข้า DB ถ้าไม่มี

    const updateScheduleQuery = `
      UPDATE MC_SCHEDULED_RECEIVES
      SET 
        STATUS = 'CONFIRMED',
        ACTUAL_QTY = @actualQty,
        RECEIVED_BY_USERID = @userId,
        CONFIRM_DATETIME = GETDATE(),
        LOCATION_NAME = @finalLocationName,
        SUB_LOCATION_NAME = @finalSubLocation -- <-- อัปเดต (อาจจะเป็นค่าว่าง)
      OUTPUT 
        inserted.ITEM_NO, 
        inserted.ACTUAL_QTY
      WHERE 
        SCHEDULE_ID = @scheduleId AND STATUS = 'PENDING';
    `;
    
    const scheduleResult = await scheduleRequest.query(updateScheduleQuery);
    
    if (scheduleResult.recordset.length === 0) {
      throw new Error('Schedule not found or already confirmed');
    }
    const { ITEM_NO, ACTUAL_QTY } = scheduleResult.recordset[0];
    const stockRequest = transaction.request();
    stockRequest.input('itemNo', sql.NVarChar, ITEM_NO);
    stockRequest.input('locationName', sql.NVarChar, locationName);
    stockRequest.input('subLocation', sql.NVarChar, subLocation); // <-- ส่ง '' (ค่าว่าง)
    stockRequest.input('receivedQty', sql.Decimal(18, 4), ACTUAL_QTY);

    const mergeStockQuery = `
      MERGE INTO MC_INVENTORY_STOCK AS target
      USING (
        SELECT @itemNo AS ITEM_NO, @locationName AS LOCATION_NAME, @subLocation AS SUB_LOCATION
      ) AS source
      ON (
        target.ITEM_NO = source.ITEM_NO AND 
        target.LOCATION_NAME = source.LOCATION_NAME AND
        ISNULL(target.SUB_LOCATION, '') = ISNULL(source.SUB_LOCATION, '') -- <-- Logic นี้รองรับค่าว่างอยู่แล้ว
      )
      WHEN MATCHED THEN
        UPDATE SET 
          QTY = target.QTY + @receivedQty,
          LAST_UPDATE = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (ITEM_NO, LOCATION_NAME, SUB_LOCATION, QTY, LAST_UPDATE)
        VALUES (@itemNo, @locationName, @subLocation, @receivedQty, GETDATE());
    `;
    await stockRequest.query(mergeStockQuery);
    await transaction.commit();
    await logAction(
      'RECEIVE_CONFIRM', 
      scheduleId, 
      'RECEIVE', 
      `Confirmed ${ACTUAL_QTY} of ${ITEM_NO} to ${locationName}/${subLocation || 'DEFAULT'} by ${userId} (ScheduleID: ${scheduleId})`
    );
    res.json({ message: 'Receive confirmed and stock updated successfully' });

  } catch (err) {
    await transaction.rollback();
    console.error('Error confirming receive:', err);
    res.status(500).json({ message: err.message || 'Failed to confirm receive' });
  }
});

// Canle Shchedul
app.post('/api/receive/cancel/:scheduleId', verifyToken, requireReceiveRole, async (req, res) => {
  const { scheduleId } = req.params;
  const userId = req.user.userid; // User ที่กดยกเลิก

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('scheduleId', sql.Int, scheduleId);
    request.input('userId', sql.NVarChar, userId);

    const updateQuery = `
      UPDATE MC_SCHEDULED_RECEIVES
      SET 
        STATUS = 'CANCELLED', -- << เปลี่ยนสถานะ
        RECEIVED_BY_USERID = @userId, -- เก็บว่าใครเป็นคนยกเลิก
        CONFIRM_DATETIME = GETDATE() -- ใช้วันที่ยกเลิก
      WHERE 
        SCHEDULE_ID = @scheduleId AND STATUS = 'PENDING'; -- ยกเลิกได้เฉพาะ PENDING
    `;
    
    const result = await request.query(updateQuery);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Schedule not found or not in PENDING status' });
    }
    
    await logAction('RECEIVE_CANCEL', scheduleId, 'RECEIVE', `Cancelled schedule ${scheduleId} by ${userId}`);
    res.json({ message: 'Schedule cancelled successfully' });

  } catch (err) {
    console.error('Error cancelling schedule:', err);
    res.status(500).json({ message: 'Failed to cancel schedule' });
  }
});

// 4. API สำหรับย้ายของ (Transfer Stock)
app.post('/api/inventory/transfer', verifyToken, requireReceiveRole, async (req, res) => {
  // 1. กำหนดค่า default
  const { itemNo, locationFrom, subLocationFrom = '', locationTo, subLocationTo = '', transferQty } = req.body;
  const userId = req.user.userid;

  // 2. เอา !subLocation ออก
  if (!itemNo || !locationFrom || !locationTo || !transferQty || transferQty <= 0) {
    return res.status(400).json({ message: 'Item No, From Location, To Location, and Qty are required' });
  }
  
  // (แก้ validation กันย้ายที่เดิม)
  if (locationFrom === locationTo && subLocationFrom === subLocationTo) { 
    return res.status(400).json({ message: 'From and To locations cannot be the same' });
  }
  
  const pool = await poolPromise;
  const transaction = pool.transaction();
  try {
    await transaction.begin();
    const qty = parseFloat(transferQty);
    
    // Step 1: FROM
    const fromRequest = transaction.request();
    fromRequest.input('itemNo', sql.NVarChar, itemNo);
    fromRequest.input('locationFrom', sql.NVarChar, locationFrom);
    fromRequest.input('subLocationFrom', sql.NVarChar, subLocationFrom); // <-- ส่ง '' (ค่าว่าง)
    fromRequest.input('transferQty', sql.Decimal(18, 4), qty);
    
    const mergeFromQuery = `
      MERGE INTO MC_INVENTORY_STOCK AS target
      USING (
        SELECT @itemNo AS ITEM_NO, @locationFrom AS LOCATION_NAME, @subLocationFrom AS SUB_LOCATION
      ) AS source
      ON (
        target.ITEM_NO = source.ITEM_NO AND 
        target.LOCATION_NAME = source.LOCATION_NAME AND
        ISNULL(target.SUB_LOCATION, '') = ISNULL(source.SUB_LOCATION, '')
      )
      WHEN MATCHED THEN
          UPDATE SET 
            QTY = target.QTY - @transferQty, 
            LAST_UPDATE = GETDATE()
      WHEN NOT MATCHED THEN
          INSERT (ITEM_NO, LOCATION_NAME, SUB_LOCATION, QTY, LAST_UPDATE)
          VALUES (@itemNo, @locationFrom, @subLocationFrom, -@transferQty, GETDATE());
    `;
    await fromRequest.query(mergeFromQuery);

    // Step 2: TO
    const toRequest = transaction.request();
    toRequest.input('itemNo', sql.NVarChar, itemNo);
    toRequest.input('locationTo', sql.NVarChar, locationTo);
    toRequest.input('subLocationTo', sql.NVarChar, subLocationTo); // <-- ส่ง '' (ค่าว่าง)
    toRequest.input('transferQty', sql.Decimal(18, 4), qty);

    const mergeToQuery = `
      MERGE INTO MC_INVENTORY_STOCK AS target
      USING (
        SELECT @itemNo AS ITEM_NO, @locationTo AS LOCATION_NAME, @subLocationTo AS SUB_LOCATION
      ) AS source
      ON (
        target.ITEM_NO = source.ITEM_NO AND 
        target.LOCATION_NAME = source.LOCATION_NAME AND
        ISNULL(target.SUB_LOCATION, '') = ISNULL(source.SUB_LOCATION, '')
      )
      WHEN MATCHED THEN
          UPDATE SET 
            QTY = target.QTY + @transferQty, 
            LAST_UPDATE = GETDATE()
      WHEN NOT MATCHED THEN
          INSERT (ITEM_NO, LOCATION_NAME, SUB_LOCATION, QTY, LAST_UPDATE)
          VALUES (@itemNo, @locationTo, @subLocationTo, @transferQty, GETDATE());
    `;
    await toRequest.query(mergeToQuery);

    await transaction.commit();
    await logAction(
      'TRANSFER', 
      itemNo, 
      'INVENTORY', 
      `Transferred ${qty} of ${itemNo} from ${locationFrom}/${subLocationFrom || 'DEFAULT'} to ${locationTo}/${subLocationTo || 'DEFAULT'} by ${userId}`
    );
    res.json({ message: 'Stock transferred successfully' });

  } catch (err) {
    await transaction.rollback();
    console.error('Error transferring stock:', err);
    res.status(500).json({ message: err.message || 'Failed to transfer stock' });
  }
});

// Check if Item No exists in Master
app.get('/api/item-master/check/:itemNo', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const { itemNo } = req.params;
    const pool = await poolPromise;
    const request = pool.request();
    request.input('itemNo', sql.NVarChar, itemNo);
    
    const result = await request.query('SELECT ITEM_NO, ITEM_NAME, SPEC FROM MC_ITEM_MASTER WHERE ITEM_NO = @itemNo');
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ item no นี้ กรุณาตรวจสอบใหม่อีกครั้ง' });
    }
    
    // ส่งชื่อ Item กลับไปด้วย
    res.json(result.recordset[0]);
    
  } catch (err) {
    console.error('Error checking item master:', err);
    res.status(500).json({ message: 'Server error while checking item' });
  }
});

// Get stock levels for a specific item
app.get('/api/inventory/stock/:itemNo', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const { itemNo } = req.params;
    const pool = await poolPromise;
    const request = pool.request();
    request.input('itemNo', sql.NVarChar, itemNo);

    // 1. อัปเกรด Query: เพิ่ม SUB_LOCATION และ ORDER BY
    const result = await request.query(`
      SELECT LOCATION_NAME, SUB_LOCATION, QTY 
      FROM MC_INVENTORY_STOCK 
      WHERE ITEM_NO = @itemNo AND QTY > 0
      ORDER BY LOCATION_NAME, SUB_LOCATION
    `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ Item นี้ในสต็อก (หรือ QTY เป็น 0)' });
    }
    
    res.json(result.recordset); 
    
  } catch (err) {
    console.error('Error checking item stock:', err);
    res.status(500).json({ message: 'Server error while checking stock' });
  }
});

// 5. API สำหรับหน้า Stock View (แสดง Card)
app.get('/api/inventory/stock', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const { search = '', location = 'ALL' } = req.query; 

    const pool = await poolPromise;
    const request = pool.request();

    const whereConditions = [];
    
    if (req.user.role !== 'ADMIN') {
      whereConditions.push(`i.DIVISION_SCRIPT = @userDivision`); 
      request.input('userDivision', sql.NVarChar, req.user.division);
    }
    
    if (location !== 'ALL') {
      whereConditions.push(`s.LOCATION_NAME = @location`);
      request.input('location', sql.NVarChar, location);
    }
    
    if (search) {
      // เพิ่ม SUB_LOCATION ในการค้นหา
      whereConditions.push(`(
        s.ITEM_NO LIKE @searchTerm OR 
        i.ITEM_NAME LIKE @searchTerm OR 
        s.SUB_LOCATION LIKE @searchTerm
      )`);
      request.input('searchTerm', sql.NVarChar, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const query = `
      SELECT 
        s.ITEM_NO, 
        i.ITEM_NAME, 
        s.LOCATION_NAME, 
        s.SUB_LOCATION, -- 1. เอา SUB_LOCATION มาด้วย
        s.QTY
      FROM MC_INVENTORY_STOCK s
      LEFT JOIN MC_ITEM_MASTER i ON s.ITEM_NO = i.ITEM_NO
      ${whereClause}
      AND s.QTY > 0 -- ซ่อนสต็อก 0
      ORDER BY s.ITEM_NO, s.LOCATION_NAME, s.SUB_LOCATION; -- 2. Sort
    `;
    
    const result = await request.query(query);
    res.json(result.recordset);

  } catch (err) {
    console.error('Error fetching inventory stock:', err);
    res.status(500).json({ message: 'Failed to fetch inventory stock' });
  }
});

app.get('/api/receive/pending-count', verifyToken, requireReceiveRole, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    
    const whereConditions = ["STATUS = 'PENDING'"];

    if (req.user.role !== 'ADMIN') {
      whereConditions.push(`DIVISION_SCRIPT = @userDivision`);
      request.input('userDivision', sql.NVarChar, req.user.division);
    }
    
    const query = `
      SELECT COUNT(*) AS pendingCount
      FROM MC_SCHEDULED_RECEIVES
      WHERE ${whereConditions.join(' AND ')};
    `;
    
    const result = await request.query(query);
    res.json(result.recordset[0]); // { pendingCount: 5 }

  } catch (err) {
    console.error('Error fetching pending count:', err);
    res.status(500).json({ message: 'Failed to fetch pending count' });
  }
});

// ========================================================= //


// Fetch itemmaster data
app.get('/api/item-master', verifyToken, async (req, res) => {
  try {
    // --- 1. รับค่า Parameter จาก Query String (ฝั่ง Client) ---
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      sortKey = 'ITEM_NO', // ค่าเริ่มต้น
      sortDir = 'asc'      // ค่าเริ่มต้น
    } = req.query;

    const pool = await poolPromise;
    const request = pool.request();

    // --- 2. การตั้งค่าตัวแปรสำหรับ SQL ---
    const pageInt = parseInt(page, 10);
    const limitInt = parseInt(limit, 10);
    const offset = (pageInt - 1) * limitInt;

    const allowedSortKeys = [
      'ITEM_NO', 'ITEM_NAME', 'SPEC', 'DRWG', 'ACCOUNT', 
      'VENDOR_CODE', 'VENDOR_NAME', 'PUR_LEAD_TIME', 'MAKER_NAME', 'REMARK', 'DIVISION_SCRIPT'
    ];
    
    // ถ้า sortKey ที่ส่งมาไม่อยู่ใน list, ให้ใช้ค่า default
    const safeSortKey = allowedSortKeys.includes(sortKey) ? sortKey : 'ITEM_NO';
    const safeSortDir = ['asc', 'desc'].includes(sortDir.toLowerCase()) ? sortDir.toLowerCase() : 'asc';
    
    // --- 3. สร้าง WHERE Clause แบบไดนามิก ---
    const whereConditions = [];
    
    // 3.1: เงื่อนไขการค้นหา (Search)
    if (search) {
      whereConditions.push(`
        (
          r.ITEM_NO LIKE @searchTerm OR
          r.ITEM_NAME LIKE @searchTerm OR
          r.SPEC LIKE @searchTerm OR
          r.DRWG LIKE @searchTerm OR
          r.ACCOUNT LIKE @searchTerm OR
          r.VENDOR_CODE LIKE @searchTerm OR
          r.VENDOR_NAME LIKE @searchTerm OR
          r.MAKER_NAME LIKE @searchTerm
        )
      `);
      request.input('searchTerm', sql.NVarChar, `%${search}%`);
    }

    // 3.2: เงื่อนไขตามสิทธิ์ (Role/Division/Org)
    // (แก้ไข Logic ที่พังในโค้ดเดิมของคุณ)
    if (req.user.role !== 'ADMIN') {
      
      // 1. กรองด้วย Division (ใช้ DIVISION_SCRIPT ให้ตรงกับ API อื่น)
      whereConditions.push(`r.DIVISION_SCRIPT = @userDivision`);
      request.input('userDivision', sql.NVarChar, req.user.division);

      // 2. กรองด้วย Org (ถ้า User คนนั้นมี Org)
      // (ดึง org ของ user มา, ถ้าไม่มีให้เป็น string ว่าง)
      const userOrgs = (req.user.org || '').split(',').map(org => org.trim()).filter(Boolean);
      
      if (userOrgs.length > 0) {
        // ถ้า user มี org, ให้กรองเฉพาะ org ที่เขามีสิทธิ์
        const orgParams = userOrgs.map((org, index) => `@org${index}`);
        whereConditions.push(`r.ORGN_CODE IN (${orgParams.join(',')})`);
        userOrgs.forEach((org, index) => {
          request.input(`org${index}`, sql.VarChar, org);
        });
      }
    }

    // รวม WHERE ทั้งหมด
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // --- 4. สร้าง Final Query ---
    const query = `
      SELECT 
        r.ITEM_NO, 
        r.ITEM_NAME, 
        r.SPEC, 
        r.DRWG, 
        r.ACCOUNT, 
        r.VENDOR_CODE, 
        r.VENDOR_NAME,
        r.PUR_LEAD_TIME,
        r.MAKER_NAME,
        r.REMARK,
        r.DIVISION_SCRIPT,
        COUNT(*) OVER() AS TotalCount 
      FROM MC_ITEM_MASTER r
      ${whereClause}
      ORDER BY ${safeSortKey} ${safeSortDir}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY;
    `;

    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, limitInt);
    
    // --- 5. สั่ง Query และส่งผลลัพธ์ ---
    const result = await request.query(query);
    
    // ดึง TotalCount จากแถวแรก (ถ้ามี)
    const totalCount = result.recordset.length > 0 ? result.recordset[0].TotalCount : 0;
    
    res.json({
      data: result.recordset,
      totalCount: totalCount
    });

  } catch (err) {
    console.error('Error fetching item master data:', err);
    res.status(500).json({ message: 'Failed to fetch item master data' });
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


// ========== REACT ROUTER FALLBACK ==========
app.get('/MECHA-MATERIAL-SYSTEM/*', (req, res) => {
  console.log('Serving React app for:', req.path);
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.get('/MECHA-MATERIAL-SYSTEM', (req, res) => {
  console.log('Serving React app for root DMI');
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});