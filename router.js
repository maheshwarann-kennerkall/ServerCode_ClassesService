const express = require('express');
const pool = require('./config/database');
const jwt = require('jsonwebtoken');

const router = express.Router();

// JWT verification middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT verification error:', err);
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

// Role-based authorization middleware
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
};

// Validation middleware
const validateClassData = (req, res, next) => {
  const { class_name, grade, standard, teacher_id, semester, capacity, room_number, schedule, academic_year } = req.body;
  
  if (!class_name || !class_name.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Class name is required'
    });
  }

  if (!standard || !standard.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Standard is required'
    });
  }

  if (!academic_year || !academic_year.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Academic year is required'
    });
  }

  if (capacity && (capacity < 1 || capacity > 100)) {
    return res.status(400).json({
      success: false,
      error: 'Capacity must be between 1 and 100'
    });
  }

  next();
};

// GET /api/classes - List all classes for a branch
router.get('/', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { branchId, academic_year, limit = 50, offset = 0 } = req.query;
    
    console.log('📋 GET /api/classes - Query params:', { branchId, academic_year, limit, offset });

    // Build dynamic query based on filters
    let query = `
      SELECT 
        c.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE 1=1
    `;
    const queryParams = [];
    let paramIndex = 1;

    // Add branch filter if provided
    if (branchId) {
      query += ` AND c.branch_id = $${paramIndex}`;
      queryParams.push(branchId);
      paramIndex++;
    }

    // Add academic year filter if provided
    if (academic_year) {
      query += ` AND c.academic_year = $${paramIndex}`;
      queryParams.push(academic_year);
      paramIndex++;
    } else {
      // Default to current year if no specific year requested
      query += ` AND c.academic_year IN (
        SELECT year_name FROM public.academic_years WHERE status = 'active'
      )`;
    }

    // Add ordering
    query += ` ORDER BY c.class_name`;

    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    console.log('🔍 GET /api/classes - Executing query:', query);
    console.log('📊 GET /api/classes - Query params:', queryParams);

    const result = await pool.query(query, queryParams);

    const response = {
      success: true,
      data: result.rows,
      total: result.rows.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    console.log('✅ GET /api/classes - Success:', {
      totalClasses: result.rows.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch classes'
    });
  }
});

// POST /api/classes - Create new class
router.post('/', authenticateToken, validateClassData, async (req, res) => {
  console.log('🔥 POST /api/classes - Incoming request:', {
    headers: req.headers,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { 
      class_name, 
      grade, 
      standard, 
      teacher_id, 
      semester, 
      capacity, 
      room_number, 
      schedule, 
      academic_year 
    } = req.body;

    console.log('✅ POST /api/classes - Creating class:', {
      class_name,
      standard,
      academic_year,
      teacher_id
    });

    // Check if class with same name already exists in this academic year
    const existingClass = await pool.query(
      'SELECT id FROM branch.classes WHERE class_name = $1 AND academic_year = $2 AND branch_id = $3',
      [class_name, academic_year, req.user.branchId]
    );

    if (existingClass.rows.length > 0) {
      console.log('⚠️ POST /api/classes - Class already exists:', class_name);
      return res.status(409).json({
        success: false,
        error: 'Class with this name already exists in the specified academic year'
      });
    }

    // Validate teacher assignment if provided
    if (teacher_id) {
      const teacherCheck = await pool.query(
        'SELECT id FROM public.users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
        [teacher_id, 'teacher', 'Active', req.user.branchId]
      );

      if (teacherCheck.rows.length === 0) {
        console.log('⚠️ POST /api/classes - Invalid teacher:', teacher_id);
        return res.status(400).json({
          success: false,
          error: 'Invalid teacher assignment'
        });
      }

      // Check if teacher is already assigned to another class
      const teacherAssignmentCheck = await pool.query(
        'SELECT id FROM branch.classes WHERE teacher_id = $1 AND academic_year = $2',
        [teacher_id, academic_year]
      );

      if (teacherAssignmentCheck.rows.length > 0) {
        console.log('⚠️ POST /api/classes - Teacher already assigned:', teacher_id);
        return res.status(409).json({
          success: false,
          error: 'Teacher is already assigned to another class in this academic year'
        });
      }
    }

    // Insert new class
    const insertQuery = `
      INSERT INTO branch.classes (
        branch_id, class_name, grade, standard, teacher_id, 
        semester, capacity, room_number, schedule, academic_year
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      req.user.branchId,
      class_name,
      grade || null,
      standard,
      teacher_id || null,
      semester || 'First Semester',
      capacity || 30,
      room_number || null,
      schedule || null,
      academic_year
    ]);

    const newClass = result.rows[0];

    // Fetch teacher details if assigned
    if (newClass.teacher_id) {
      const teacherResult = await pool.query(
        'SELECT name, email FROM public.users WHERE id = $1',
        [newClass.teacher_id]
      );
      
      if (teacherResult.rows.length > 0) {
        newClass.teacher = teacherResult.rows[0];
      }
    }

    const response = {
      success: true,
      data: newClass,
      message: 'Class created successfully'
    };

    console.log('✅ POST /api/classes - Class created successfully:', {
      classId: newClass.id,
      className: newClass.class_name,
      teacher: newClass.teacher_name || 'Not assigned'
    });

    res.status(201).json(response);
  } catch (error) {
    console.error('❌ POST /api/classes - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create class'
    });
  }
});

// GET /api/academic-years - Get active academic years (no role restrictions)
router.get('/academic-years', async (req, res) => {
  console.log('🔥 GET /api/academic-years - Incoming request:', {
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  try {
    console.log('📋 GET /api/academic-years - Fetching academic years');

    // Get all academic years, prioritizing active ones
    const result = await pool.query(`
      SELECT
        year_name as id,
        year_name,
        status,
        start_date,
        end_date,
        CASE WHEN status = 'active' THEN 1 ELSE 0 END as is_active_order
      FROM public.academic_years
      ORDER BY is_active_order DESC, start_date DESC
    `);

    const response = {
      success: true,
      data: result.rows
    };

    console.log('✅ GET /api/academic-years - Academic years retrieved:', {
      totalYears: result.rows.length,
      activeYears: result.rows.filter(year => year.status === 'active').length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/academic-years - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch academic years'
    });
  }
});

// GET /api/classes/:id - Get class details
router.get('/:id', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 GET /api/classes/:id - Class ID:', id);

    const result = await pool.query(`
      SELECT 
        c.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE c.id = $1 AND c.branch_id = $2
    `, [id, req.user.branchId]);

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/classes/:id - Class not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const response = {
      success: true,
      data: result.rows[0]
    };

    console.log('✅ GET /api/classes/:id - Class found:', {
      classId: id,
      className: result.rows[0].class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch class details'
    });
  }
});

// PUT /api/classes/:id - Update class
router.put('/:id', authenticateToken, validateClassData, async (req, res) => {
  console.log('🔥 PUT /api/classes/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { 
      class_name, 
      grade, 
      standard, 
      teacher_id, 
      semester, 
      capacity, 
      room_number, 
      schedule, 
      academic_year 
    } = req.body;

    console.log('📋 PUT /api/classes/:id - Updating class:', { id, class_name, standard });

    // Check if class exists and belongs to user's branch
    const existingClass = await pool.query(
      'SELECT * FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [id, req.user.branchId]
    );

    if (existingClass.rows.length === 0) {
      console.log('⚠️ PUT /api/classes/:id - Class not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = existingClass.rows[0];

    // Check for duplicate class name in same academic year (excluding current class)
    const duplicateCheck = await pool.query(
      'SELECT id FROM branch.classes WHERE class_name = $1 AND academic_year = $2 AND branch_id = $3 AND id != $4',
      [class_name, academic_year, req.user.branchId, id]
    );

    if (duplicateCheck.rows.length > 0) {
      console.log('⚠️ PUT /api/classes/:id - Duplicate class name:', class_name);
      return res.status(409).json({
        success: false,
        error: 'Class with this name already exists in the specified academic year'
      });
    }

    // Validate teacher assignment if changed
    if (teacher_id && teacher_id !== classData.teacher_id) {
      const teacherCheck = await pool.query(
        'SELECT id FROM public.users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
        [teacher_id, 'teacher', 'Active', req.user.branchId]
      );

      if (teacherCheck.rows.length === 0) {
        console.log('⚠️ PUT /api/classes/:id - Invalid teacher:', teacher_id);
        return res.status(400).json({
          success: false,
          error: 'Invalid teacher assignment'
        });
      }

      // Check if new teacher is already assigned to another class
      const teacherAssignmentCheck = await pool.query(
        'SELECT id FROM branch.classes WHERE teacher_id = $1 AND academic_year = $2 AND id != $3',
        [teacher_id, academic_year, id]
      );

      if (teacherAssignmentCheck.rows.length > 0) {
        console.log('⚠️ PUT /api/classes/:id - Teacher already assigned:', teacher_id);
        return res.status(409).json({
          success: false,
          error: 'Teacher is already assigned to another class in this academic year'
        });
      }
    }

    // Update class
    const updateQuery = `
      UPDATE branch.classes SET 
        class_name = $1,
        grade = $2,
        standard = $3,
        teacher_id = $4,
        semester = $5,
        capacity = $6,
        room_number = $7,
        schedule = $8,
        academic_year = $9,
        updated_at = NOW()
      WHERE id = $10 AND branch_id = $11
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      class_name,
      grade || null,
      standard,
      teacher_id || null,
      semester || 'First Semester',
      capacity || 30,
      room_number || null,
      schedule || null,
      academic_year,
      id,
      req.user.branchId
    ]);

    const updatedClass = result.rows[0];

    // Fetch teacher details if assigned
    if (updatedClass.teacher_id) {
      const teacherResult = await pool.query(
        'SELECT name, email FROM public.users WHERE id = $1',
        [updatedClass.teacher_id]
      );
      
      if (teacherResult.rows.length > 0) {
        updatedClass.teacher = teacherResult.rows[0];
      }
    }

    const response = {
      success: true,
      data: updatedClass,
      message: 'Class updated successfully'
    };

    console.log('✅ PUT /api/classes/:id - Class updated successfully:', {
      classId: id,
      className: updatedClass.class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ PUT /api/classes/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update class'
    });
  }
});

// DELETE /api/classes/:id - Delete class
router.delete('/:id', authenticateToken,  async (req, res) => {
  console.log('🔥 DELETE /api/classes/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 DELETE /api/classes/:id - Deleting class:', id);

    // Check if class exists and belongs to user's branch
    const existingClass = await pool.query(
      'SELECT * FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [id, req.user.branchId]
    );

    if (existingClass.rows.length === 0) {
      console.log('⚠️ DELETE /api/classes/:id - Class not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = existingClass.rows[0];

    // Check if class has students enrolled
    const studentsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM public.students WHERE class_id = $1 AND status = $2',
      [id, 'Active']
    );

    if (parseInt(studentsCheck.rows[0].count) > 0) {
      console.log('⚠️ DELETE /api/classes/:id - Class has students:', id);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete class with enrolled students. Please move students to another class first.'
      });
    }

    // Check if class has timetable entries
    const timetableCheck = await pool.query(
      'SELECT COUNT(*) as count FROM branch.timetables WHERE class_id = $1',
      [id]
    );

    if (parseInt(timetableCheck.rows[0].count) > 0) {
      console.log('⚠️ DELETE /api/classes/:id - Class has timetable entries:', id);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete class with timetable entries. Please delete timetable entries first.'
      });
    }

    // Delete class
    const deleteResult = await pool.query(
      'DELETE FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [id, req.user.branchId]
    );

    if (deleteResult.rowCount === 0) {
      console.log('⚠️ DELETE /api/classes/:id - No rows affected:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const response = {
      success: true,
      message: 'Class deleted successfully'
    };

    console.log('✅ DELETE /api/classes/:id - Class deleted successfully:', {
      classId: id,
      className: classData.class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ DELETE /api/classes/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete class'
    });
  }
});

// GET /api/classes/:id/timetable - Get class timetable
router.get('/:id/timetable', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes/:id/timetable - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 GET /api/classes/:id/timetable - Class ID:', id);

    // Verify class belongs to user's branch
    const classCheck = await pool.query(
      'SELECT id FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [id, req.user.branchId]
    );

    if (classCheck.rows.length === 0) {
      console.log('⚠️ GET /api/classes/:id/timetable - Class not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const result = await pool.query(`
      SELECT
        t.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.timetables t
      LEFT JOIN public.users u ON t.teacher_id = u.id
      WHERE t.class_id = $1
      ORDER BY t.day_of_week, t.start_time
    `, [id]);

    const response = {
      success: true,
      data: result.rows
    };

    console.log('✅ GET /api/classes/:id/timetable - Timetable retrieved:', {
      classId: id,
      totalSlots: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/:id/timetable - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch timetable'
    });
  }
});

// POST /api/classes/:id/timetable - Add timetable slot
router.post('/:id/timetable', authenticateToken, async (req, res) => {
  console.log('🔥 POST /api/classes/:id/timetable - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id: classId } = req.params;
    const { subject, teacher_id, day_of_week, start_time, end_time, room_number } = req.body;

    console.log('📋 POST /api/classes/:id/timetable - Adding slot:', {
      classId, subject, day_of_week, start_time, end_time, teacher_id
    });

    // Verify class belongs to user's branch
    const classCheck = await pool.query(
      'SELECT id, semester FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [classId, req.user.branchId]
    );

    if (classCheck.rows.length === 0) {
      console.log('⚠️ POST /api/classes/:id/timetable - Class not found:', classId);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = classCheck.rows[0];

    // Validate required fields
    if (!subject || !subject.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Subject is required'
      });
    }

    if (!teacher_id) {
      return res.status(400).json({
        success: false,
        error: 'Teacher is required'
      });
    }

    if (!day_of_week || day_of_week < 1 || day_of_week > 7) {
      return res.status(400).json({
        success: false,
        error: 'Valid day of week (1-7) is required'
      });
    }

    if (!start_time || !end_time) {
      return res.status(400).json({
        success: false,
        error: 'Start time and end time are required'
      });
    }

    // Validate time format and logic
    if (start_time >= end_time) {
      return res.status(400).json({
        success: false,
        error: 'End time must be after start time'
      });
    }

    // Validate teacher exists and is active
    const teacherCheck = await pool.query(
      'SELECT id FROM public.users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
      [teacher_id, 'teacher', 'Active', req.user.branchId]
    );

    if (teacherCheck.rows.length === 0) {
      console.log('⚠️ POST /api/classes/:id/timetable - Invalid teacher:', teacher_id);
      return res.status(400).json({
        success: false,
        error: 'Invalid teacher assignment'
      });
    }

    // Check for time conflicts in the same class
    const conflictCheck = await pool.query(`
      SELECT id FROM branch.timetables 
      WHERE class_id = $1 
      AND day_of_week = $2 
      AND (
        (start_time <= $3 AND end_time > $3) OR
        (start_time < $4 AND end_time >= $4) OR
        (start_time >= $3 AND end_time <= $4)
      )
    `, [classId, day_of_week, start_time, end_time]);

    if (conflictCheck.rows.length > 0) {
      console.log('⚠️ POST /api/classes/:id/timetable - Time conflict detected');
      return res.status(409).json({
        success: false,
        error: 'Time conflict detected! This slot overlaps with an existing class.'
      });
    }

    // Get current academic year from class
    const currentYear = await pool.query(
      'SELECT academic_year FROM branch.classes WHERE id = $1',
      [classId]
    );

    const academicYear = currentYear.rows[0]?.academic_year || '2024-25';

    // Insert timetable slot
    const insertQuery = `
      INSERT INTO branch.timetables (
        branch_id, class_id, subject, teacher_id, 
        day_of_week, start_time, end_time, room_number, 
        academic_year, semester
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      req.user.branchId,
      classId,
      subject,
      teacher_id,
      day_of_week,
      start_time,
      end_time,
      room_number || null,
      academicYear,
      classData.semester
    ]);

    const newSlot = result.rows[0];

    // Fetch teacher details
    const teacherResult = await pool.query(
      'SELECT name, email FROM public.users WHERE id = $1',
      [teacher_id]
    );

    if (teacherResult.rows.length > 0) {
      newSlot.teacher = teacherResult.rows[0];
    }

    const response = {
      success: true,
      data: newSlot,
      message: 'Timetable slot added successfully'
    };

    console.log('✅ POST /api/classes/:id/timetable - Slot added:', {
      slotId: newSlot.id,
      classId,
      subject,
      teacher: teacherResult.rows[0]?.name || 'Unknown'
    });

    res.status(201).json(response);
  } catch (error) {
    console.error('❌ POST /api/classes/:id/timetable - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add timetable slot'
    });
  }
});

// PUT /api/timetable/:id - Update timetable slot
router.put('/timetable/:id', authenticateToken, async (req, res) => {
  console.log('🔥 PUT /api/timetable/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { subject, teacher_id, day_of_week, start_time, end_time, room_number } = req.body;

    console.log('📋 PUT /api/timetable/:id - Updating slot:', { id, subject, day_of_week });

    // Check if timetable slot exists and belongs to user's branch
    const existingSlot = await pool.query(`
      SELECT t.*, c.branch_id, c.academic_year 
      FROM branch.timetables t
      JOIN branch.classes c ON t.class_id = c.id
      WHERE t.id = $1 AND c.branch_id = $2
    `, [id, req.user.branchId]);

    if (existingSlot.rows.length === 0) {
      console.log('⚠️ PUT /api/timetable/:id - Slot not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable slot not found'
      });
    }

    const slotData = existingSlot.rows[0];

    // Validate required fields
    if (!subject || !subject.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Subject is required'
      });
    }

    if (!teacher_id) {
      return res.status(400).json({
        success: false,
        error: 'Teacher is required'
      });
    }

    if (!day_of_week || day_of_week < 1 || day_of_week > 7) {
      return res.status(400).json({
        success: false,
        error: 'Valid day of week (1-7) is required'
      });
    }

    if (!start_time || !end_time) {
      return res.status(400).json({
        success: false,
        error: 'Start time and end time are required'
      });
    }

    if (start_time >= end_time) {
      return res.status(400).json({
        success: false,
        error: 'End time must be after start time'
      });
    }

    // Validate teacher exists and is active
    const teacherCheck = await pool.query(
      'SELECT id FROM public.users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
      [teacher_id, 'teacher', 'Active', req.user.branchId]
    );

    if (teacherCheck.rows.length === 0) {
      console.log('⚠️ PUT /api/timetable/:id - Invalid teacher:', teacher_id);
      return res.status(400).json({
        success: false,
        error: 'Invalid teacher assignment'
      });
    }

    // Check for time conflicts (excluding current slot)
    const conflictCheck = await pool.query(`
      SELECT id FROM branch.timetables 
      WHERE class_id = $1 
      AND day_of_week = $2 
      AND id != $3
      AND (
        (start_time <= $4 AND end_time > $4) OR
        (start_time < $5 AND end_time >= $5) OR
        (start_time >= $4 AND end_time <= $5)
      )
    `, [slotData.class_id, day_of_week, id, start_time, end_time]);

    if (conflictCheck.rows.length > 0) {
      console.log('⚠️ PUT /api/timetable/:id - Time conflict detected');
      return res.status(409).json({
        success: false,
        error: 'Time conflict detected! This slot overlaps with an existing class.'
      });
    }

    // Update timetable slot
    const updateQuery = `
      UPDATE branch.timetables SET 
        subject = $1,
        teacher_id = $2,
        day_of_week = $3,
        start_time = $4,
        end_time = $5,
        room_number = $6,
        updated_at = NOW()
      WHERE id = $7 AND branch_id = $8
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      subject,
      teacher_id,
      day_of_week,
      start_time,
      end_time,
      room_number || null,
      id,
      req.user.branchId
    ]);

    const updatedSlot = result.rows[0];

    // Fetch teacher details
    const teacherResult = await pool.query(
      'SELECT name, email FROM public.users WHERE id = $1',
      [teacher_id]
    );

    if (teacherResult.rows.length > 0) {
      updatedSlot.teacher = teacherResult.rows[0];
    }

    const response = {
      success: true,
      data: updatedSlot,
      message: 'Timetable slot updated successfully'
    };

    console.log('✅ PUT /api/timetable/:id - Slot updated:', {
      slotId: id,
      subject,
      teacher: teacherResult.rows[0]?.name || 'Unknown'
    });

    res.json(response);
  } catch (error) {
    console.error('❌ PUT /api/timetable/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update timetable slot'
    });
  }
});

// DELETE /api/timetable/:id - Delete timetable slot
router.delete('/timetable/:id', authenticateToken,  async (req, res) => {
  console.log('🔥 DELETE /api/timetable/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 DELETE /api/timetable/:id - Deleting slot:', id);

    // Check if timetable slot exists and belongs to user's branch
    const existingSlot = await pool.query(`
      SELECT t.*, c.branch_id, c.class_name 
      FROM branch.timetables t
      JOIN branch.classes c ON t.class_id = c.id
      WHERE t.id = $1 AND c.branch_id = $2
    `, [id, req.user.branchId]);

    if (existingSlot.rows.length === 0) {
      console.log('⚠️ DELETE /api/timetable/:id - Slot not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable slot not found'
      });
    }

    const slotData = existingSlot.rows[0];

    // Delete timetable slot
    const deleteResult = await pool.query(
      'DELETE FROM branch.timetables WHERE id = $1 AND branch_id = $2',
      [id, req.user.branchId]
    );

    if (deleteResult.rowCount === 0) {
      console.log('⚠️ DELETE /api/timetable/:id - No rows affected:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable slot not found'
      });
    }

    const response = {
      success: true,
      message: 'Timetable slot deleted successfully'
    };

    console.log('✅ DELETE /api/timetable/:id - Slot deleted:', {
      slotId: id,
      className: slotData.class_name,
      subject: slotData.subject
    });

    res.json(response);
  } catch (error) {
    console.error('❌ DELETE /api/timetable/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete timetable slot'
    });
  }
});

// POST /api/classes/bulk-create - Bulk create classes for new academic year
router.post('/bulk-create', authenticateToken, async (req, res) => {
  console.log('🔥 POST /api/classes/bulk-create - Incoming request:', {
    headers: req.headers,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { newAcademicYear } = req.body;

    if (!newAcademicYear || !newAcademicYear.trim()) {
      return res.status(400).json({
        success: false,
        error: 'New academic year is required'
      });
    }

    console.log('📋 POST /api/classes/bulk-create - Creating classes for:', newAcademicYear);

    // Get current active academic year
    const activeYearResult = await pool.query(
      'SELECT year_name FROM public.academic_years WHERE status = $1 ORDER BY start_date DESC LIMIT 1',
      ['active']
    );

    if (activeYearResult.rows.length === 0) {
      console.log('⚠️ POST /api/classes/bulk-create - No active academic year found');
      return res.status(400).json({
        success: false,
        error: 'No active academic year found'
      });
    }

    const currentAcademicYear = activeYearResult.rows[0].year_name;

    // Get existing classes from current academic year
    const existingClasses = await pool.query(
      `SELECT * FROM branch.classes 
       WHERE branch_id = $1 AND academic_year = $2 AND status = $3
       ORDER BY class_name`,
      [req.user.branchId, currentAcademicYear, 'Active']
    );

    if (existingClasses.rows.length === 0) {
      console.log('⚠️ POST /api/classes/bulk-create - No classes found in current year');
      return res.status(404).json({
        success: false,
        error: 'No classes found in the current academic year to duplicate'
      });
    }

    console.log('📊 POST /api/classes/bulk-create - Found classes to duplicate:', existingClasses.rows.length);

    // Check if new academic year already has classes
    const existingNewYearClasses = await pool.query(
      'SELECT COUNT(*) as count FROM branch.classes WHERE branch_id = $1 AND academic_year = $2',
      [req.user.branchId, newAcademicYear]
    );

    if (parseInt(existingNewYearClasses.rows[0].count) > 0) {
      console.log('⚠️ POST /api/classes/bulk-create - Classes already exist for new year');
      return res.status(409).json({
        success: false,
        error: 'Classes already exist for the specified academic year'
      });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create new classes for the new academic year
      const newClassesData = existingClasses.rows.map(cls => ({
        branch_id: cls.branch_id,
        class_name: cls.class_name,
        grade: cls.grade,
        standard: cls.standard,
        teacher_id: cls.teacher_id,
        semester: cls.semester,
        capacity: cls.capacity,
        room_number: cls.room_number,
        schedule: cls.schedule,
        academic_year: newAcademicYear,
        status: 'Active'
      }));

      let createdCount = 0;
      for (const classData of newClassesData) {
        await client.query(`
          INSERT INTO branch.classes (
            branch_id, class_name, grade, standard, teacher_id, 
            semester, capacity, room_number, schedule, academic_year, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          classData.branch_id, classData.class_name, classData.grade, classData.standard,
          classData.teacher_id, classData.semester, classData.capacity, classData.room_number,
          classData.schedule, classData.academic_year, classData.status
        ]);
        createdCount++;
      }

      await client.query('COMMIT');

      const response = {
        success: true,
        message: `Successfully created ${createdCount} classes for ${newAcademicYear}`,
        data: {
          createdCount,
          sourceYear: currentAcademicYear,
          targetYear: newAcademicYear,
          totalClasses: createdCount
        }
      };

      console.log('✅ POST /api/classes/bulk-create - Classes created successfully:', {
        createdCount,
        sourceYear: currentAcademicYear,
        targetYear: newAcademicYear
      });

      res.status(201).json(response);
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.log('🔴 POST /api/classes/bulk-create - Transaction error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ POST /api/classes/bulk-create - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk create classes'
    });
  }
});

router.get('/teachers/available', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/teachers/available - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { academic_year } = req.query;
    
    console.log('📋 GET /api/teachers/available - Fetching available teachers');

    // Build query for available teachers
    let query = `
      SELECT DISTINCT u.id, u.name, u.email
      FROM public.users u
      WHERE u.branch_id = $1
      AND u.role = 'teacher'
      AND u.status = 'Active'
      AND u.id NOT IN (
        SELECT DISTINCT teacher_id
        FROM branch.classes
        WHERE branch_id = $1
        AND academic_year = $2
        AND teacher_id IS NOT NULL
      )
      ORDER BY u.name
    `;

    const targetYear = academic_year || '2024-25';
    const result = await pool.query(query, [req.user.branchId, targetYear]);

    const response = {
      success: true,
      data: result.rows,
      academicYear: targetYear
    };

    console.log('✅ GET /api/teachers/available - Teachers retrieved:', {
      availableCount: result.rows.length,
      academicYear: targetYear
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/teachers/available - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available teachers'
    });
  }
});

// GET /api/teachers/all - Get all active teachers from the branch (for timetable creation)
router.get('/teachers/all', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/teachers/all - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    console.log('📋 GET /api/teachers/all - Fetching all active teachers for branch');

    // Build query for all active teachers in the branch
    const query = `
      SELECT DISTINCT u.id, u.name, u.email
      FROM public.users u
      WHERE u.branch_id = $1
      AND u.role = 'teacher'
      AND u.status = 'Active'
      ORDER BY u.name
    `;

    const result = await pool.query(query, [req.user.branchId]);

    const response = {
      success: true,
      data: result.rows,
      branchId: req.user.branchId
    };

    console.log('✅ GET /api/teachers/all - All teachers retrieved:', {
      totalTeachers: result.rows.length,
      branchId: req.user.branchId
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/teachers/all - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch teachers'
    });
  }
});



// GET /api/classes/teachers/:teacherId/timetable - Get teacher's complete timetable
router.get('/teachers/:teacherId/timetable', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes/teachers/:teacherId/timetable - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { teacherId } = req.params;
    console.log('📋 GET /api/classes/teachers/:teacherId/timetable - Teacher ID:', teacherId);

    // Check access permissions:
    // 1. Teacher can see their own timetable
    // 2. Admin/Superadmin can see any teacher's timetable
    // 3. Students/Parents cannot access teacher timetables
    
    if (req.user.role === 'teacher' && req.user.userid !== teacherId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only view your own timetable.'
      });
    }

    if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Insufficient permissions.'
      });
    }

    // Verify teacher exists and belongs to the branch (for non-teachers)
    if (req.user.role !== 'teacher') {
      const teacherCheck = await pool.query(`
        SELECT id, name FROM public.users
        WHERE userid = $1 AND role = $2 AND branch_id = $3
      `, [teacherId, 'teacher', req.user.branchId]);

      if (teacherCheck.rows.length === 0) {
        console.log('⚠️ GET /api/classes/teachers/:teacherId/timetable - Teacher not found:', teacherId);
        return res.status(404).json({
          success: false,
          error: 'Teacher not found'
        });
      }
    }

    // Get teacher's complete timetable with class details
    const query = `
      SELECT
        t.*,
        c.id as class_id,
        c.class_name,
        c.standard,
        c.grade,
        c.room_number,
        u.name as teacher_name,
        u.email as teacher_email,
        -- Day names for better readability
        CASE t.day_of_week
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday'
          WHEN 5 THEN 'Friday'
          WHEN 6 THEN 'Saturday'
          WHEN 7 THEN 'Sunday'
        END as day_name
      FROM branch.timetables t
      JOIN branch.classes c ON t.class_id = c.id
      LEFT JOIN public.users u ON t.teacher_id = u.id
      WHERE u.userid = $1
        AND t.branch_id = $2
        AND c.status = 'active'
      ORDER BY t.day_of_week, t.start_time
    `;

    const result = await pool.query(query, [teacherId, req.user.branchId]);

    // Group timetable by day for better organization
    const timetableByDay = {};
    result.rows.forEach(slot => {
      const dayKey = slot.day_of_week;
      if (!timetableByDay[dayKey]) {
        timetableByDay[dayKey] = {
          day_name: slot.day_name,
          day_of_week: slot.day_of_week,
          slots: []
        };
      }
      timetableByDay[dayKey].slots.push({
        id: slot.id,
        subject: slot.subject,
        start_time: slot.start_time,
        end_time: slot.end_time,
        room_number: slot.room_number,
        class: {
          id: slot.class_id,
          class_name: slot.class_name,
          standard: slot.standard,
          grade: slot.grade
        }
      });
    });

    // Convert to array and sort by day
    const organizedTimetable = Object.values(timetableByDay)
      .sort((a, b) => a.day_of_week - b.day_of_week);

    // Get teacher's basic info
    const teacherInfo = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        t.department,
        t.subjects
      FROM public.users u
      LEFT JOIN branch.teachers t ON u.id = t.user_id
      WHERE u.userid = $1 AND u.role = 'teacher'
    `, [teacherId]);

    const response = {
      success: true,
      data: {
        teacher: teacherInfo.rows[0] || null,
        timetable: organizedTimetable,
        total_slots: result.rows.length,
        teaching_days: organizedTimetable.length
      }
    };

    console.log('✅ GET /api/classes/teachers/:teacherId/timetable - Success:', {
      teacherId,
      totalSlots: result.rows.length,
      teachingDays: organizedTimetable.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/teachers/:teacherId/timetable - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch teacher timetable'
    });
  }
});

// GET /api/classes/:id/students - Get students in a class (for class teachers)
// router.get('/:id/students', authenticateToken, async (req, res) => {
//   console.log('🔥 GET /api/classes/:id/students - Incoming request:', {
//     headers: req.headers,
//     params: req.params,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     const { id } = req.params;
//     console.log('📋 GET /api/classes/:id/students - Class ID:', id);

//     // Verify class belongs to user's branch and user is the class teacher
//     const classCheck = await pool.query(`
//       SELECT
//         c.*,
//         u.name as teacher_name,
//         u.email as teacher_email
//       FROM branch.classes c
//       LEFT JOIN public.users u ON c.teacher_id = u.id
//       WHERE c.id = $1 AND c.branch_id = $2
//     `, [id, req.user.branchId]);

//     if (classCheck.rows.length === 0) {
//       console.log('⚠️ GET /api/classes/:id/students - Class not found:', id);
//       return res.status(404).json({
//         success: false,
//         error: 'Class not found'
//       });
//     }

//     const classData = classCheck.rows[0];

//     // Verify user is the class teacher (for teacher role)
//     if (req.user.role === 'teacher' && classData.teacher_id !== req.user.userid && classData.teacher_id !== req.user.id) {
//       console.log('⚠️ GET /api/classes/:id/students - Access denied for teacher:', {
//         teacherId: req.user.userid,
//         classTeacherId: classData.teacher_id,
//         classId: id
//       });
//       return res.status(403).json({
//         success: false,
//         error: 'Access denied. You are not the class teacher.'
//       });
//     }

//     // Get students enrolled in this class
//     const result = await pool.query(`
//       SELECT
//         s.id,
//         s.student_id,
//         s.roll_number,
//         s.name,
//         s.gender,
//         s.phone,
//         s.address,
//         s.date_of_birth,
//         s.admission_date,
//         s.status,
//         s.academic_year,
//         s.blood_group,
//         s.medical_info,
//         s.transport_required,
//         s.hostel_required,
//         u.email,
//         u.phone as user_phone,
//         u.name as user_name,
//         -- Parent information
//         p.father_name,
//         p.mother_name,
//         p.primary_contact_name,
//         pu.name as parent_name,
//         pu.email as parent_email,
//         pu.phone as parent_phone
//       FROM branch.students s
//       LEFT JOIN public.users u ON s.user_id = u.id
//       LEFT JOIN branch.parent_student_relations psr ON s.id = psr.student_id AND psr.is_primary_contact = true
//       LEFT JOIN branch.parents p ON psr.parent_id = p.id
//       LEFT JOIN public.users pu ON psr.parent_id = pu.id
//       WHERE s.class_id = $1 AND s.status = $2
//       ORDER BY
//         CASE
//           WHEN s.roll_number IS NULL THEN 1
//           ELSE 0
//         END,
//         s.roll_number ASC,
//         s.name ASC
//     `, [id, 'Active']);

//     // Calculate gender distribution
//     const genderStats = {
//       male: result.rows.filter(s => s.gender === 'Male').length,
//       female: result.rows.filter(s => s.gender === 'Female').length,
//       other: result.rows.filter(s => s.gender && !['Male', 'Female'].includes(s.gender)).length
//     };

//     const response = {
//       success: true,
//       data: {
//         class: {
//           id: classData.id,
//           class_name: classData.class_name,
//           grade: classData.grade,
//           standard: classData.standard,
//           capacity: classData.capacity,
//           room_number: classData.room_number,
//           semester: classData.semester,
//           academic_year: classData.academic_year,
//           teacher: {
//             id: classData.teacher_id,
//             name: classData.teacher_name,
//             email: classData.teacher_email
//           }
//         },
//         students: result.rows.map(student => ({
//           id: student.id,
//           student_id: student.student_id,
//           roll_number: student.roll_number,
//           name: student.user_name || student.name,
//           gender: student.gender,
//           phone: student.user_phone || student.phone,
//           email: student.email,
//           address: student.address,
//           date_of_birth: student.date_of_birth,
//           admission_date: student.admission_date,
//           status: student.status,
//           academic_year: student.academic_year,
//           blood_group: student.blood_group,
//           medical_info: student.medical_info,
//           transport_required: student.transport_required,
//           hostel_required: student.hostel_required,
//           parent: {
//             name: student.parent_name || student.primary_contact_name,
//             father_name: student.father_name,
//             mother_name: student.mother_name,
//             email: student.parent_email,
//             phone: student.parent_phone
//           }
//         })),
//         statistics: {
//           total_students: result.rows.length,
//           active_students: result.rows.filter(s => s.status === 'Active').length,
//           gender_distribution: genderStats,
//           with_transport: result.rows.filter(s => s.transport_required === true).length,
//           with_hostel: result.rows.filter(s => s.hostel_required === true).length
//         }
//       }
//     };

//     console.log('✅ GET /api/classes/:id/students - Success:', {
//       classId: id,
//       className: classData.class_name,
//       totalStudents: result.rows.length,
//       teacherId: classData.teacher_id
//     });

//     res.json(response);
//   } catch (error) {
//     console.error('❌ GET /api/classes/:id/students - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch class students'
//     });
//   }
// });
router.get('/teachers/students', authenticateToken, async (req, res) => {
  try {
    const teacherUUID = req.user.userId;  // UUID
    const branchId = req.user.branchId;

    // 1. Verify teacher exists
    const teacher = await pool.query(
      `SELECT id, userid, name, email 
       FROM public.users 
       WHERE id = $1 AND role = 'teacher' AND is_active = true`,
      [teacherUUID]
    );

    if (teacher.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Teacher not found"
      });
    }

    // 2. Find class assigned to this teacher
    const classResult = await pool.query(
      `SELECT * FROM branch.classes 
       WHERE teacher_id = $1 AND branch_id = $2 AND status = 'Active'`,
      [teacherUUID, branchId]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No class assigned to this teacher"
      });
    }

    const classData = classResult.rows[0];

    // 3. Fetch students of that class
    const students = await pool.query(
      `SELECT s.*, u.name AS student_name, u.email AS student_email
       FROM branch.students s
       LEFT JOIN public.users u ON u.id = s.user_id
       WHERE s.class_id = $1 AND s.status = 'Active'
       ORDER BY s.roll_number ASC`,
      [classData.id]
    );

    return res.json({
      success: true,
      data: {
        class: classData,
        students: students.rows
      }
    });

  } catch (err) {
    console.error("Teacher students fetch error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


// GET /api/teachers/my-class - Get class details for the current teacher
router.get('/teachers/my-class', authenticateToken, requireRole('teacher'), async (req, res) => {
  console.log('🔥 GET /api/teachers/my-class - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    console.log('📋 GET /api/teachers/my-class - Fetching class for teacher:', req.user.userid);

    // Get the class where this teacher is assigned
    const result = await pool.query(`
      SELECT
        c.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE c.teacher_id = $1
        AND c.branch_id = $2
        AND c.status = 'active'
    `, [req.user.userid, req.user.branchId]);

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/teachers/my-class - No class found for teacher:', req.user.userid);
      return res.status(404).json({
        success: false,
        error: 'No class assigned to you as a class teacher'
      });
    }

    const classData = result.rows[0];

    // Get student count for this class
    const studentCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM branch.students WHERE class_id = $1 AND status = $2',
      [classData.id, 'Active']
    );

    const response = {
      success: true,
      data: {
        class: {
          id: classData.id,
          class_name: classData.class_name,
          grade: classData.grade,
          standard: classData.standard,
          capacity: classData.capacity,
          room_number: classData.room_number,
          semester: classData.semester,
          academic_year: classData.academic_year,
          schedule: classData.schedule,
          teacher: {
            id: classData.teacher_id,
            name: classData.teacher_name,
            email: classData.teacher_email
          }
        },
        student_count: parseInt(studentCountResult.rows[0].count)
      }
    };

    console.log('✅ GET /api/teachers/my-class - Success:', {
      teacherId: req.user.userid,
      classId: classData.id,
      className: classData.class_name,
      studentCount: parseInt(studentCountResult.rows[0].count)
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/teachers/my-class - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch your class details'
    });
  }
});

// GET /api/teachers/my-students - Get all students in the teacher's assigned class
router.get('/teachers/my-students', authenticateToken, requireRole('teacher'), async (req, res) => {
  console.log('🔥 GET /api/teachers/my-students - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    console.log('📋 GET /api/teachers/my-students - Fetching students for teacher:', req.user.userid);

    // First get the class where this teacher is assigned
    const classResult = await pool.query(`
      SELECT
        c.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE c.teacher_id = $1
        AND c.branch_id = $2
        AND c.status = 'active'
    `, [req.user.userid, req.user.branchId]);

    if (classResult.rows.length === 0) {
      console.log('⚠️ GET /api/teachers/my-students - No class found for teacher:', req.user.userid);
      return res.status(404).json({
        success: false,
        error: 'No class assigned to you as a class teacher'
      });
    }

    const classData = classResult.rows[0];
    const classId = classData.id;

    // Get all students in this class
    const result = await pool.query(`
      SELECT
        s.id,
        s.student_id,
        s.roll_number,
        s.name,
        s.gender,
        s.phone,
        s.address,
        s.date_of_birth,
        s.admission_date,
        s.status,
        s.academic_year,
        s.blood_group,
        s.medical_info,
        s.transport_required,
        s.hostel_required,
        u.email,
        u.phone as user_phone,
        u.name as user_name,
        -- Parent information
        p.father_name,
        p.mother_name,
        p.primary_contact_name,
        pu.name as parent_name,
        pu.email as parent_email,
        pu.phone as parent_phone
      FROM branch.students s
      LEFT JOIN public.users u ON s.user_id = u.id
      LEFT JOIN branch.parent_student_relations psr ON s.id = psr.student_id AND psr.is_primary_contact = true
      LEFT JOIN branch.parents p ON psr.parent_id = p.id
      LEFT JOIN public.users pu ON psr.parent_id = pu.id
      WHERE s.class_id = $1 AND s.status = $2
      ORDER BY
        CASE
          WHEN s.roll_number IS NULL THEN 1
          ELSE 0
        END,
        s.roll_number ASC,
        s.name ASC
    `, [classId, 'Active']);

    // Calculate statistics
    const genderStats = {
      male: result.rows.filter(s => s.gender === 'Male').length,
      female: result.rows.filter(s => s.gender === 'Female').length,
      other: result.rows.filter(s => s.gender && !['Male', 'Female'].includes(s.gender)).length
    };

    const response = {
      success: true,
      data: {
        class: {
          id: classData.id,
          class_name: classData.class_name,
          grade: classData.grade,
          standard: classData.standard,
          capacity: classData.capacity,
          room_number: classData.room_number,
          semester: classData.semester,
          academic_year: classData.academic_year,
          teacher: {
            id: classData.teacher_id,
            name: classData.teacher_name,
            email: classData.teacher_email
          }
        },
        students: result.rows.map(student => ({
          id: student.id,
          student_id: student.student_id,
          roll_number: student.roll_number,
          name: student.user_name || student.name,
          gender: student.gender,
          phone: student.user_phone || student.phone,
          email: student.email,
          address: student.address,
          date_of_birth: student.date_of_birth,
          admission_date: student.admission_date,
          status: student.status,
          academic_year: student.academic_year,
          blood_group: student.blood_group,
          medical_info: student.medical_info,
          transport_required: student.transport_required,
          hostel_required: student.hostel_required,
          parent: {
            name: student.parent_name || student.primary_contact_name,
            father_name: student.father_name,
            mother_name: student.mother_name,
            email: student.parent_email,
            phone: student.parent_phone
          }
        })),
        statistics: {
          total_students: result.rows.length,
          active_students: result.rows.filter(s => s.status === 'Active').length,
          gender_distribution: genderStats,
          with_transport: result.rows.filter(s => s.transport_required === true).length,
          with_hostel: result.rows.filter(s => s.hostel_required === true).length
        }
      }
    };

    console.log('✅ GET /api/teachers/my-students - Success:', {
      teacherId: req.user.userid,
      classId: classData.id,
      className: classData.class_name,
      totalStudents: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/teachers/my-students - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch your students'
    });
  }
});

// GET /api/teachers/:teacherId/class - Get class details for a specific teacher by userid
router.get('/teachers/:teacherId/class', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/teachers/:teacherId/class - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { teacherId } = req.params;
    console.log('📋 GET /api/teachers/:teacherId/class - Teacher ID:', teacherId);

    // First verify the teacher exists and has 'teacher' role
    const teacherCheck = await pool.query(`
      SELECT u.id, u.userid, u.name, u.email, u.role, u.branch_id
      FROM public.users u
      WHERE u.userid = $1 AND u.role = $2
    `, [teacherId, 'teacher']);

    if (teacherCheck.rows.length === 0) {
      console.log('⚠️ GET /api/teachers/:teacherId/class - Teacher not found:', teacherId);
      return res.status(404).json({
        success: false,
        error: 'Teacher not found with the specified user ID'
      });
    }

    const teacher = teacherCheck.rows[0];

    // Get the class where this teacher is assigned
    const result = await pool.query(`
      SELECT
        c.*,
        tu.name as teacher_name,
        tu.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users tu ON c.teacher_id = tu.userid
      WHERE c.teacher_id = $1
        AND c.branch_id = $2
        AND c.status = 'active'
    `, [teacher.userid, teacher.branch_id]);

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/teachers/:teacherId/class - No class found for teacher:', teacherId);
      return res.json({
        success: true,
        data: {
          teacher: {
            id: teacher.id,
            userid: teacher.userid,
            name: teacher.name,
            email: teacher.email
          },
          class_assigned: false,
          message: 'This teacher is not assigned as a class teacher to any active class'
        }
      });
    }

    const classData = result.rows[0];

    // Get student count for this class
    const studentCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM branch.students WHERE class_id = $1 AND status = $2',
      [classData.id, 'Active']
    );

    const response = {
      success: true,
      data: {
        teacher: {
          id: teacher.id,
          userid: teacher.userid,
          name: teacher.name,
          email: teacher.email,
          branch_id: teacher.branch_id
        },
        class_assigned: true,
        class: {
          id: classData.id,
          class_name: classData.class_name,
          grade: classData.grade,
          standard: classData.standard,
          capacity: classData.capacity,
          room_number: classData.room_number,
          semester: classData.semester,
          academic_year: classData.academic_year,
          schedule: classData.schedule,
          teacher: {
            id: classData.teacher_id,
            name: classData.teacher_name,
            email: classData.teacher_email
          }
        },
        student_count: parseInt(studentCountResult.rows[0].count)
      }
    };

    console.log('✅ GET /api/teachers/:teacherId/class - Success:', {
      teacherId: teacher.userid,
      classId: classData.id,
      className: classData.class_name,
      studentCount: parseInt(studentCountResult.rows[0].count)
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/teachers/:teacherId/class - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch teacher class information'
    });
  }
});

// GET /api/teachers/:teacherId/students - Get all students in the specified teacher's class
router.get('/teachers/:teacherId/students', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/teachers/:teacherId/students - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { teacherId } = req.params;
    console.log('📋 GET /api/teachers/:teacherId/students - Teacher ID:', teacherId);

    // First verify the teacher exists and has 'teacher' role
    const teacherCheck = await pool.query(`
      SELECT u.id, u.userid, u.name, u.email, u.role, u.branch_id
      FROM public.users u
      WHERE u.userid = $1 AND u.role = $2
    `, [teacherId, 'teacher']);

    if (teacherCheck.rows.length === 0) {
      console.log('⚠️ GET /api/teachers/:teacherId/students - Teacher not found:', teacherId);
      return res.status(404).json({
        success: false,
        error: 'Teacher not found with the specified user ID'
      });
    }

    const teacher = teacherCheck.rows[0];

    // Get the class where this teacher is assigned
    const classResult = await pool.query(`
      SELECT
        c.*,
        tu.name as teacher_name,
        tu.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users tu ON c.teacher_id = tu.userid
      WHERE c.teacher_id = $1
        AND c.branch_id = $2
        AND c.status = 'active'
    `, [teacher.userid, teacher.branch_id]);

    if (classResult.rows.length === 0) {
      console.log('⚠️ GET /api/teachers/:teacherId/students - No class found for teacher:', teacherId);
      return res.json({
        success: true,
        data: {
          teacher: {
            id: teacher.id,
            userid: teacher.userid,
            name: teacher.name,
            email: teacher.email,
            branch_id: teacher.branch_id
          },
          class_assigned: false,
          students: [],
          message: 'This teacher is not assigned as a class teacher to any active class'
        }
      });
    }

    const classData = classResult.rows[0];
    const classId = classData.id;

    // Get all students in this class
    const result = await pool.query(`
      SELECT
        s.id,
        s.student_id,
        s.roll_number,
        s.name,
        s.gender,
        s.phone,
        s.address,
        s.date_of_birth,
        s.admission_date,
        s.status,
        s.academic_year,
        s.blood_group,
        s.medical_info,
        s.transport_required,
        s.hostel_required,
        u.email,
        u.phone as user_phone,
        u.name as user_name,
        -- Parent information
        p.father_name,
        p.mother_name,
        p.primary_contact_name,
        pu.name as parent_name,
        pu.email as parent_email,
        pu.phone as parent_phone
      FROM branch.students s
      LEFT JOIN public.users u ON s.user_id = u.id
      LEFT JOIN branch.parent_student_relations psr ON s.id = psr.student_id AND psr.is_primary_contact = true
      LEFT JOIN branch.parents p ON psr.parent_id = p.id
      LEFT JOIN public.users pu ON psr.parent_id = pu.id
      WHERE s.class_id = $1 AND s.status = $2
      ORDER BY
        CASE
          WHEN s.roll_number IS NULL THEN 1
          ELSE 0
        END,
        s.roll_number ASC,
        s.name ASC
    `, [classId, 'Active']);

    // Calculate statistics
    const genderStats = {
      male: result.rows.filter(s => s.gender === 'Male').length,
      female: result.rows.filter(s => s.gender === 'Female').length,
      other: result.rows.filter(s => s.gender && !['Male', 'Female'].includes(s.gender)).length
    };

    const response = {
      success: true,
      data: {
        teacher: {
          id: teacher.id,
          userid: teacher.userid,
          name: teacher.name,
          email: teacher.email,
          branch_id: teacher.branch_id
        },
        class_assigned: true,
        class: {
          id: classData.id,
          class_name: classData.class_name,
          grade: classData.grade,
          standard: classData.standard,
          capacity: classData.capacity,
          room_number: classData.room_number,
          semester: classData.semester,
          academic_year: classData.academic_year,
          teacher: {
            id: classData.teacher_id,
            name: classData.teacher_name,
            email: classData.teacher_email
          }
        },
        students: result.rows.map(student => ({
          id: student.id,
          student_id: student.student_id,
          roll_number: student.roll_number,
          name: student.user_name || student.name,
          gender: student.gender,
          phone: student.user_phone || student.phone,
          email: student.email,
          address: student.address,
          date_of_birth: student.date_of_birth,
          admission_date: student.admission_date,
          status: student.status,
          academic_year: student.academic_year,
          blood_group: student.blood_group,
          medical_info: student.medical_info,
          transport_required: student.transport_required,
          hostel_required: student.hostel_required,
          parent: {
            name: student.parent_name || student.primary_contact_name,
            father_name: student.father_name,
            mother_name: student.mother_name,
            email: student.parent_email,
            phone: student.parent_phone
          }
        })),
        statistics: {
          total_students: result.rows.length,
          active_students: result.rows.filter(s => s.status === 'Active').length,
          gender_distribution: genderStats,
          with_transport: result.rows.filter(s => s.transport_required === true).length,
          with_hostel: result.rows.filter(s => s.hostel_required === true).length
        }
      }
    };

    console.log('✅ GET /api/teachers/:teacherId/students - Success:', {
      teacherId: teacher.userid,
      classId: classData.id,
      className: classData.class_name,
      totalStudents: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/teachers/:teacherId/students - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch teacher students'
    });
  }
});

// ========== ATTENDANCE MANAGEMENT ENDPOINTS ==========

// POST /api/classes/:id/attendance - Mark daily attendance for entire class
router.post('/:id/attendance', authenticateToken, async (req, res) => {
  console.log('🔥 POST /api/classes/:id/attendance - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id: classId } = req.params;
    const { attendance_date, students, subject } = req.body;

    console.log('📋 POST /api/classes/:id/attendance - Marking attendance:', {
      classId,
      attendance_date,
      subject,
      studentCount: students?.length || 0
    });

    // Verify class belongs to user's branch
    const classCheck = await pool.query(
      'SELECT id, class_name, teacher_id, academic_year FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [classId, req.user.branchId]
    );

    if (classCheck.rows.length === 0) {
      console.log('⚠️ POST /api/classes/:id/attendance - Class not found:', classId);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = classCheck.rows[0];

    // Verify user is the class teacher or has admin privileges
    if (req.user.role === 'teacher' && classData.teacher_id !== req.user.userId) {
      console.log('⚠️ POST /api/classes/:id/attendance - Access denied for teacher:', {
        teacherId: req.user.userid,
        classTeacherId: classData.teacher_id
      });
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not the class teacher.'
      });
    }

    // Validate required fields
    if (!attendance_date) {
      return res.status(400).json({
        success: false,
        error: 'Attendance date is required'
      });
    }

    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Students array is required'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(attendance_date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Validate student statuses
    const validStatuses = ['Present', 'Absent', 'Late'];
    for (const student of students) {
      if (!student.student_id || !validStatuses.includes(student.status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid student data or status for student ${student.student_id}`
        });
      }
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let createdCount = 0;
      let updatedCount = 0;

      for (const student of students) {
        // Check if attendance record already exists
        const existingRecord = await client.query(
          'SELECT id FROM branch.attendance WHERE student_id = $1 AND attendance_date = $2 AND class_id = $3',
          [student.student_id, attendance_date, classId]
        );

        if (existingRecord.rows.length > 0) {
          // Update existing record
          await client.query(
            `UPDATE branch.attendance SET
              status = $1,
              subject = $2,
              remarks = $3,
              marked_at = NOW(),
              updated_at = NOW()
             WHERE id = $4`,
            [student.status, subject || null, student.remarks || null, existingRecord.rows[0].id]
          );
          updatedCount++;
        } else {
          // Create new record
          await client.query(
            `INSERT INTO branch.attendance (
              branch_id, student_id, class_id, teacher_id,
              attendance_date, status, subject, remarks, academic_year
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              req.user.branchId,
              student.student_id,
              classId,
              req.user.userId,
              attendance_date,
              student.status,
              subject || null,
              student.remarks || null,
              classData.academic_year
            ]
          );
          createdCount++;
        }
      }

      await client.query('COMMIT');

      const response = {
        success: true,
        message: 'Attendance marked successfully',
        data: {
          classId,
          className: classData.class_name,
          attendance_date,
          subject: subject || null,
          created: createdCount,
          updated: updatedCount,
          total_processed: students.length
        }
      };

      console.log('✅ POST /api/classes/:id/attendance - Success:', {
        classId,
        className: classData.class_name,
        created: createdCount,
        updated: updatedCount,
        total: students.length
      });

      res.status(201).json(response);
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.log('🔴 POST /api/classes/:id/attendance - Transaction error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ POST /api/classes/:id/attendance - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to mark attendance'
    });
  }
});

// GET /api/classes/:id/attendance - View class attendance records
router.get('/:id/attendance', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes/:id/attendance - Incoming request:', {
    headers: req.headers,
    params: req.params,
    query: req.query,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id: classId } = req.params;
    const { start_date, end_date, status, limit = 50, offset = 0 } = req.query;

    console.log('📋 GET /api/classes/:id/attendance - Fetching attendance:', {
      classId,
      start_date,
      end_date,
      status,
      limit,
      offset
    });

    // Verify class belongs to user's branch
    const classCheck = await pool.query(
      'SELECT id, class_name, teacher_id FROM branch.classes WHERE id = $1 AND branch_id = $2',
      [classId, req.user.branchId]
    );

    if (classCheck.rows.length === 0) {
      console.log('⚠️ GET /api/classes/:id/attendance - Class not found:', classId);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = classCheck.rows[0];

    // Verify access permissions
    if (req.user.role === 'teacher' && classData.teacher_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not the class teacher.'
      });
    }

    // Build query with filters
    let query = `
      SELECT
        a.*,
        s.student_id,
        s.roll_number,
        COALESCE(u.name, 'Unknown Student') as student_name,
        teacher.name as teacher_name
      FROM branch.attendance a
      JOIN branch.students s ON a.student_id = s.id
      LEFT JOIN public.users u ON s.user_id = u.id
      LEFT JOIN public.users teacher ON a.teacher_id = teacher.id
      WHERE a.class_id = $1
    `;

    const queryParams = [classId];
    let paramIndex = 2;

    // Add date range filters
    if (start_date) {
      query += ` AND a.attendance_date >= $${paramIndex}`;
      queryParams.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND a.attendance_date <= $${paramIndex}`;
      queryParams.push(end_date);
      paramIndex++;
    }

    // Add status filter
    if (status && ['Present', 'Absent', 'Late'].includes(status)) {
      query += ` AND a.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Add ordering and pagination
    query += ` ORDER BY a.attendance_date DESC, s.roll_number ASC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM branch.attendance a
      WHERE a.class_id = $1
    `;
    const countParams = [classId];
    let countParamIndex = 2;

    if (start_date) {
      countQuery += ` AND a.attendance_date >= $${countParamIndex}`;
      countParams.push(start_date);
      countParamIndex++;
    }

    if (end_date) {
      countQuery += ` AND a.attendance_date <= $${countParamIndex}`;
      countParams.push(end_date);
      countParamIndex++;
    }

    if (status && ['Present', 'Absent', 'Late'].includes(status)) {
      countQuery += ` AND a.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    const response = {
      success: true,
      data: {
        class: {
          id: classData.id,
          class_name: classData.class_name
        },
        attendance_records: result.rows.map(record => ({
          id: record.id,
          attendance_date: record.attendance_date,
          status: record.status,
          subject: record.subject,
          remarks: record.remarks,
          marked_at: record.marked_at,
          student: {
            id: record.student_id,
            student_id: record.student_id,
            roll_number: record.roll_number,
            name: record.student_name
          },
          teacher: {
            id: record.teacher_id,
            name: record.teacher_name
          }
        })),
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: total > (parseInt(offset) + parseInt(limit))
        }
      }
    };

    console.log('✅ GET /api/classes/:id/attendance - Success:', {
      classId,
      className: classData.class_name,
      totalRecords: total,
      returnedRecords: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/:id/attendance - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance records'
    });
  }
});

// PUT /api/attendance/:id - Update individual attendance record
router.put('/attendance/:id', authenticateToken, async (req, res) => {
  console.log('🔥 PUT /api/attendance/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { status, remarks, subject } = req.body;

    console.log('📋 PUT /api/attendance/:id - Updating attendance:', {
      id,
      status,
      subject
    });

    // Check if attendance record exists and belongs to user's branch
    const existingRecord = await pool.query(`
      SELECT a.*, c.teacher_id, c.class_name
      FROM branch.attendance a
      JOIN branch.classes c ON a.class_id = c.id
      WHERE a.id = $1 AND a.branch_id = $2
    `, [id, req.user.branchId]);

    if (existingRecord.rows.length === 0) {
      console.log('⚠️ PUT /api/attendance/:id - Attendance record not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    const recordData = existingRecord.rows[0];

    // Verify access permissions
    if (req.user.role === 'teacher' && recordData.teacher_id !== req.user.userId) {
      console.log('⚠️ PUT /api/attendance/:id - Access denied for teacher:', {
        teacherId: req.user.userid,
        recordTeacherId: recordData.teacher_id
      });
      return res.status(403).json({
        success: false,
        error: 'Access denied. You did not mark this attendance record.'
      });
    }

    // Validate required fields
    if (!status || !['Present', 'Absent', 'Late'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Valid status (Present, Absent, Late) is required'
      });
    }

    // Update attendance record
    const updateQuery = `
      UPDATE branch.attendance SET
        status = $1,
        remarks = $2,
        subject = $3,
        updated_at = NOW()
      WHERE id = $4 AND branch_id = $5
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      status,
      remarks || null,
      subject || null,
      id,
      req.user.branchId
    ]);

    const updatedRecord = result.rows[0];

    const response = {
      success: true,
      data: {
        id: updatedRecord.id,
        attendance_date: updatedRecord.attendance_date,
        status: updatedRecord.status,
        subject: updatedRecord.subject,
        remarks: updatedRecord.remarks,
        marked_at: updatedRecord.marked_at,
        updated_at: updatedRecord.updated_at
      },
      message: 'Attendance record updated successfully'
    };

    console.log('✅ PUT /api/attendance/:id - Success:', {
      attendanceId: id,
      className: recordData.class_name,
      newStatus: status
    });

    res.json(response);
  } catch (error) {
    console.error('❌ PUT /api/attendance/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update attendance record'
    });
  }
});

// GET /api/attendance/date/:date - Get attendance for specific date across classes
router.get('/attendance/date/:date', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/attendance/date/:date - Incoming request:', {
    headers: req.headers,
    params: req.params,
    query: req.query,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { date } = req.params;
    const { class_id, status, limit = 100, offset = 0 } = req.query;

    console.log('📋 GET /api/attendance/date/:date - Fetching attendance:', {
      date,
      class_id,
      status,
      limit,
      offset
    });

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Build query with filters
    let query = `
      SELECT
        a.*,
        s.student_id,
        s.roll_number,
        su.name AS student_name,
        c.class_name,
        c.standard,
        c.grade,
        u.name AS teacher_name
      FROM branch.attendance a
      JOIN branch.students s ON a.student_id = s.id
      JOIN public.users su ON s.user_id = su.id
      JOIN branch.classes c ON a.class_id = c.id
      LEFT JOIN public.users u ON a.teacher_id = u.id
      WHERE a.attendance_date = $1 AND a.branch_id = $2
    `;

    const queryParams = [date, req.user.branchId];
    let paramIndex = 3;

    // Add class filter if provided
    if (class_id) {
      query += ` AND a.class_id = $${paramIndex}`;
      queryParams.push(class_id);
      paramIndex++;
    }

    // Add status filter if provided
    if (status && ['Present', 'Absent', 'Late'].includes(status)) {
      query += ` AND a.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Add ordering and pagination
    query += ` ORDER BY c.class_name, s.roll_number ASC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM branch.attendance a
      WHERE a.attendance_date = $1 AND a.branch_id = $2
    `;
    const countParams = [date, req.user.branchId];
    let countParamIndex = 3;

    if (class_id) {
      countQuery += ` AND a.class_id = $${countParamIndex}`;
      countParams.push(class_id);
      countParamIndex++;
    }

    if (status && ['Present', 'Absent', 'Late'].includes(status)) {
      countQuery += ` AND a.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    const response = {
      success: true,
      data: {
        attendance_date: date,
        attendance_records: result.rows.map(record => ({
          id: record.id,
          status: record.status,
          subject: record.subject,
          remarks: record.remarks,
          marked_at: record.marked_at,
          student: {
            id: record.student_id,
            student_id: record.student_id,
            roll_number: record.roll_number,
            name: record.student_name
          },
          class: {
            id: record.class_id,
            class_name: record.class_name,
            standard: record.standard,
            grade: record.grade
          },
          teacher: {
            id: record.teacher_id,
            name: record.teacher_name
          }
        })),
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: total > (parseInt(offset) + parseInt(limit))
        },
        summary: {
          total_present: result.rows.filter(r => r.status === 'Present').length,
          total_absent: result.rows.filter(r => r.status === 'Absent').length,
          total_late: result.rows.filter(r => r.status === 'Late').length
        }
      }
    };

    console.log('✅ GET /api/attendance/date/:date - Success:', {
      date,
      totalRecords: total,
      present: result.rows.filter(r => r.status === 'Present').length,
      absent: result.rows.filter(r => r.status === 'Absent').length,
      late: result.rows.filter(r => r.status === 'Late').length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/attendance/date/:date - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance for date'
    });
  }
});

module.exports = router;