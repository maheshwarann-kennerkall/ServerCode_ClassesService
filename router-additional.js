// Additional timetable management endpoints
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
      'SELECT id, semester FROM classes WHERE id = $1 AND branch_id = $2',
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
      'SELECT id FROM users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
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
      SELECT id FROM timetables 
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
      'SELECT academic_year FROM classes WHERE id = $1',
      [classId]
    );

    const academicYear = currentYear.rows[0]?.academic_year || '2024-25';

    // Insert timetable slot
    const insertQuery = `
      INSERT INTO timetables (
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
      'SELECT name, email FROM users WHERE id = $1',
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
      FROM timetables t
      JOIN classes c ON t.class_id = c.id
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
      'SELECT id FROM users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
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
      SELECT id FROM timetables 
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
      UPDATE timetables SET 
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
      'SELECT name, email FROM users WHERE id = $1',
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
router.delete('/timetable/:id', authenticateToken, async (req, res) => {
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
      FROM timetables t
      JOIN classes c ON t.class_id = c.id
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
      'DELETE FROM timetables WHERE id = $1 AND branch_id = $2',
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
router.post('/bulk-create', authenticateToken, requireRole('superadmin', 'branchlevel_manager', 'access_manager'), async (req, res) => {
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
      'SELECT year_name FROM academic_years WHERE status = $1 ORDER BY start_date DESC LIMIT 1',
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
      `SELECT * FROM classes 
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
      'SELECT COUNT(*) as count FROM classes WHERE branch_id = $1 AND academic_year = $2',
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
          INSERT INTO classes (
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

// GET /api/teachers/available - Get available teachers (not assigned as class teachers)
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
      FROM users u
      WHERE u.branch_id = $1
      AND u.role = 'teacher'
      AND u.status = 'Active'
      AND u.id NOT IN (
        SELECT DISTINCT teacher_id
        FROM classes
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
      FROM users u
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

// ========== TEACHER NOTIFICATION SYSTEM ENDPOINTS ==========
// POST /api/classes/teachers/notify - Send notification to teacher's class students
// router.post('/teachers/notify', authenticateToken, requireRole('teacher'), async (req, res) => {
//   console.log('🔥 POST /api/classes/teachers/notify - Incoming request:', {
//     headers: req.headers,
//     body: req.body,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     const { title, content, priority = 'Medium' } = req.body;
//     const teacherUUID = req.user.userId; // UUID
//     const branchId = req.user.branchId;

//     console.log('📋 POST /api/classes/teachers/notify - Sending notification:', {
//       title,
//       priority,
//       teacherUUID
//     });

//     // Validate required fields
//     if (!title || !title.trim()) {
//       return res.status(400).json({
//         success: false,
//         error: 'Title is required'
//       });
//     }

//     if (!content || !content.trim()) {
//       return res.status(400).json({
//         success: false,
//         error: 'Content is required'
//       });
//     }

//     // Validate priority
//     const validPriorities = ['Low', 'Medium', 'High', 'Critical'];
//     if (!validPriorities.includes(priority)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Invalid priority level'
//       });
//     }

//     // Check if teacher exists and has access
//     const teacherCheck = await pool.query(
//       `SELECT id, userid, name, email 
//        FROM public.users 
//        WHERE id = $1 AND role = 'teacher' AND status = 'Active' AND branch_id = $2`,
//       [teacherUUID, branchId]
//     );

//     if (teacherCheck.rows.length === 0) {
//       console.log('⚠️ POST /api/classes/teachers/notify - Teacher not found:', teacherUUID);
//       return res.status(404).json({
//         success: false,
//         error: 'Teacher not found or not active'
//       });
//     }

//     const teacher = teacherCheck.rows[0];

//     // Check if teacher is eligible to send notifications (class teacher OR teaching any subject)
//     const eligibilityCheck = await pool.query(`
//       SELECT 
//         c.id as class_id,
//         c.class_name,
//         CASE 
//           WHEN c.teacher_id = $1 THEN 'class_teacher'
//           ELSE 'subject_teacher'
//         END as eligibility_type
//       FROM branch.classes c
//       WHERE c.branch_id = $2 
//         AND c.status = 'Active'
//         AND (
//           -- Teacher is class teacher
//           c.teacher_id = $1
//           OR
//           -- Teacher teaches any subject to this class
//           EXISTS (
//             SELECT 1 FROM branch.timetables t 
//             WHERE t.class_id = c.id 
//               AND t.teacher_id = $1 
//               AND t.branch_id = $2
//           )
//         )
//     `, [teacherUUID, branchId]);

//     if (eligibilityCheck.rows.length === 0) {
//       console.log('⚠️ POST /api/classes/teachers/notify - Teacher not eligible:', teacherUUID);
//       return res.status(403).json({
//         success: false,
//         error: 'You are not eligible to send notifications. You must be a class teacher or teaching at least one subject.'
//       });
//     }

//     console.log('✅ POST /api/classes/teachers/notify - Teacher eligible for classes:', eligibilityCheck.rows.length);

//     // Get all students from eligible classes
//     const eligibleClassIds = eligibilityCheck.rows.map(row => row.class_id);
//     // const classIdPlaceholders = eligibleClassIds.map((_, index) => `$${index + 3}`).join(',');
//     const classIdPlaceholders = eligibleClassIds.map((_, index) => `$${index + 2}`).join(',');

//     // const studentsQuery = `
//     //   SELECT DISTINCT s.id as student_id, s.user_id, s.student_id as student_number, s.name
//     //   FROM branch.students s
//     //   WHERE s.class_id IN (${classIdPlaceholders})
//     //     AND s.status = 'Active'
//     //     AND s.branch_id = $2
//     // `;
//     const studentsQuery = `
//       SELECT DISTINCT
//         s.id AS student_id,
//         s.user_id,
//         s.student_id AS student_number,
//         u.name AS student_name
//       FROM branch.students s
//       JOIN public.users u ON s.user_id = u.id
//       WHERE s.class_id IN (${classIdPlaceholders})
//         AND s.status = 'Active'
//         AND s.branch_id = $2
//     `;


//     const studentsResult = await pool.query(studentsQuery, [branchId, ...eligibleClassIds]);

//     if (studentsResult.rows.length === 0) {
//       console.log('⚠️ POST /api/classes/teachers/notify - No students found');
//       return res.status(404).json({
//         success: false,
//         error: 'No students found in your classes'
//       });
//     }

//     // Start transaction to create notice and delivery records
//     const client = await pool.connect();
//     try {
//       await client.query('BEGIN');

//       // Create notice
//       const noticeQuery = `
//         INSERT INTO notices (
//           title, content, priority, audience_type, status, publish_date, 
//           created_by, branch_id, enable_in_app
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
//         RETURNING id
//       `;

//       const noticeResult = await client.query(noticeQuery, [
//         title.trim(),
//         content.trim(),
//         priority,
//         'students',
//         'published',
//         new Date(),
//         teacherUUID,
//         branchId,
//         true
//       ]);

//       const noticeId = noticeResult.rows[0].id;

//       // Create delivery records for all students
//       let deliveryCount = 0;
//       for (const student of studentsResult.rows) {
//         await client.query(`
//           INSERT INTO notice_deliveries (
//             notice_id, user_id, delivery_method, status
//           ) VALUES ($1, $2, $3, $4)
//         `, [noticeId, student.user_id, 'in_app', 'pending']);
//         deliveryCount++;
//       }

//       await client.query('COMMIT');

//       const response = {
//         success: true,
//         data: {
//           notice_id: noticeId,
//           title,
//           content,
//           priority,
//           delivered_to: deliveryCount,
//           eligible_classes: eligibilityCheck.rows,
//           teacher: {
//             id: teacher.id,
//             name: teacher.name,
//             email: teacher.email
//           }
//         },
//         message: `Notification sent successfully to ${deliveryCount} students`
//       };

//       console.log('✅ POST /api/classes/teachers/notify - Success:', {
//         noticeId,
//         title,
//         deliveredTo: deliveryCount,
//         teacherId: teacherUUID
//       });

//       res.status(201).json(response);
//     } catch (dbError) {
//       await client.query('ROLLBACK');
//       console.log('🔴 POST /api/classes/teachers/notify - Transaction error:', dbError);
//       throw dbError;
//     } finally {
//       client.release();
//     }
//   } catch (error) {
//     console.error('❌ POST /api/classes/teachers/notify - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to send notification'
//     });
//   }
// });
// POST /api/classes/teachers/notify
router.post('/teachers/notify', authenticateToken, requireRole('teacher'), async (req, res) => {
  console.log('🔥 POST /api/classes/teachers/notify - Incoming request:', {
    headers: req.headers,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  const client = await pool.connect();
  try {
    const { title, content, priority = 'Medium' } = req.body;
    const teacherUUID = req.user.userId; // uuid from token
    const branchId = req.user.branchId;

    // Input validation
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Content is required' });
    }
    const validPriorities = ['Low', 'Medium', 'High', 'Critical'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ success: false, error: 'Invalid priority level' });
    }

    console.log('📋 POST /api/classes/teachers/notify - Sending notification:', { title, priority, teacherUUID });

    // 1) Validate teacher exists and belongs to branch
    const teacherQ = `
      SELECT id, userid, name, email
      FROM public.users
      WHERE id = $1 AND role = 'teacher' AND status = 'Active' AND branch_id = $2
    `;
    const teacherRes = await pool.query(teacherQ, [teacherUUID, branchId]);
    if (teacherRes.rows.length === 0) {
      console.log('⚠️ Teacher not found or inactive:', teacherUUID);
      return res.status(404).json({ success: false, error: 'Teacher not found or not active' });
    }
    const teacher = teacherRes.rows[0];

    // 2) Get eligible classes (class teacher OR assigned in timetable)
    const eligibilityQ = `
      SELECT c.id as class_id, c.class_name,
        CASE WHEN c.teacher_id = $1 THEN 'class_teacher' ELSE 'subject_teacher' END as eligibility_type
      FROM branch.classes c
      WHERE c.branch_id = $2
        AND c.status = 'Active'
        AND (
          c.teacher_id = $1
          OR EXISTS (
            SELECT 1 FROM branch.timetables t
            WHERE t.class_id = c.id AND t.teacher_id = $1 AND t.branch_id = $2
          )
        )
    `;
    const eligibilityRes = await pool.query(eligibilityQ, [teacherUUID, branchId]);
    if (eligibilityRes.rows.length === 0) {
      console.log('⚠️ Teacher not eligible for any classes:', teacherUUID);
      return res.status(403).json({
        success: false,
        error: 'You are not eligible to send notifications. You must be a class teacher or teaching at least one subject.'
      });
    }

    const eligibleClassIds = eligibilityRes.rows.map(r => r.class_id);
    console.log('✅ Teacher eligible for classes:', eligibleClassIds.length, eligibleClassIds);

    // 3) Load students for those classes (single query, avoid duplicates)
    // We'll pass branchId as $1 then class ids as $2..$n
    const placeholders = eligibleClassIds.map((_, i) => `$${i + 2}`).join(',');
    const studentsQ = `
      SELECT DISTINCT s.id as student_id, s.user_id, s.student_id as student_number, u.name as student_name
      FROM branch.students s
      JOIN public.users u ON s.user_id = u.id
      WHERE s.branch_id = $1
        AND s.status = 'Active'
        AND s.class_id IN (${placeholders})
    `;
    const studentsParams = [branchId, ...eligibleClassIds];
    const studentsRes = await pool.query(studentsQ, studentsParams);

    if (studentsRes.rows.length === 0) {
      console.log('⚠️ No active students found in eligible classes');
      return res.status(404).json({ success: false, error: 'No students found in your classes' });
    }
    const students = studentsRes.rows;
    console.log(`📥 Found ${students.length} students to notify`);

    // 4) Start transaction and create notice + bulk deliveries
    await client.query('BEGIN');

    // 4a) Insert notice (adjust columns as per your notices table)
    const noticeInsertQ = `
      INSERT INTO notices (
        title, content, priority, audience_type, status, publish_date,
        created_by, branch_id, enable_in_app, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
      RETURNING id
    `;
    const noticeVals = [
      title.trim(),
      content.trim(),
      priority,
      'students', // audience_type
      'published', // status
      new Date(),
      teacherUUID,
      branchId,
      true
    ];
    const noticeInsertRes = await client.query(noticeInsertQ, noticeVals);
    const noticeId = noticeInsertRes.rows[0].id;

    // 4b) Bulk insert notice_deliveries in batches
    // We will create values like: ($1,$2,$3),($4,$5,$6),...
    const BATCH_SIZE = 500; // safe batch size for parameterized queries
    let totalInserted = 0;

    // for (let i = 0; i < students.length; i += BATCH_SIZE) {
    //   const batch = students.slice(i, i + BATCH_SIZE);

    //   // build parameterized values
    //   const valueClauses = [];
    //   const params = [];
    //   let paramIndex = 1;

    //   for (const s of batch) {
    //     // notice_id, user_id, delivery_method, status, created_at, updated_at
    //     valueClauses.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW(), NOW())`);
    //     params.push(noticeId, s.user_id, 'in_app', 'pending');
    //   }

    //   const bulkInsertQ = `
    //     INSERT INTO notice_deliveries (
    //       notice_id, user_id, delivery_method, status, created_at, updated_at
    //     ) VALUES ${valueClauses.join(',')}
    //   `;

    //   await client.query(bulkInsertQ, params);
    //   totalInserted += batch.length;
    // }
    for (let i = 0; i < students.length; i += BATCH_SIZE) {
      const batch = students.slice(i, i + BATCH_SIZE);

      const valueClauses = [];
      const params = [];
      let paramIndex = 1;

      for (const s of batch) {
        // notice_id, user_id, delivery_method, status, created_at
        valueClauses.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW())`);
        params.push(noticeId, s.user_id, 'in_app', 'pending');
      }

      const bulkInsertQ = `
        INSERT INTO notice_deliveries (
          notice_id, user_id, delivery_method, status, created_at
        ) VALUES ${valueClauses.join(',')}
      `;

      await client.query(bulkInsertQ, params);
      totalInserted += batch.length;
    }

    await client.query('COMMIT');

    // ===== WEBSOCKET BROADCAST =====
    // Broadcast notification to connected students in real-time
    const notificationData = {
      id: noticeId,
      title: title.trim(),
      content: content.trim(),
      priority,
      teacher_name: teacher.name,
      publish_date: new Date().toISOString(),
      audience_type: 'students'
    };

    // Get WebSocket broadcast function from app
    const broadcastNotificationToStudents = req.app.get('broadcastNotificationToStudents');
    if (broadcastNotificationToStudents) {
      const studentIds = students.map(s => s.user_id);
      const broadcastCount = broadcastNotificationToStudents(studentIds, notificationData);
      console.log('📨 WebSocket broadcast:', {
        noticeId,
        connectedStudents: broadcastCount,
        totalStudents: studentIds.length
      });
    }

    console.log('✅ Notification created and broadcast:', {
      noticeId,
      deliveredTo: totalInserted,
      title,
      priority
    });

    res.status(201).json({
      success: true,
      data: {
        notice_id: noticeId,
        title,
        content,
        priority,
        delivered_to: totalInserted,
        eligible_classes: eligibilityRes.rows,
        teacher: {
          id: teacher.id,
          name: teacher.name,
          email: teacher.email
        },
        realtime_broadcast: {
          websocket_enabled: true,
          connected_students_notified: broadcastNotificationToStudents ? 'via_websocket' : 'not_available'
        }
      },
      message: `Notification sent successfully to ${totalInserted} students`
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('❌ POST /api/classes/teachers/notify - Server error:', err);
    // If it's a PG error complaining about parameter types, log the details
    if (err && err.code) {
      console.error('PG ERROR CODE:', err.code, 'DETAIL:', err.detail || err.message);
    }
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  } finally {
    client.release();
  }
});


// GET /api/classes/teachers/my-notifications - Get notifications sent by the teacher
router.get('/teachers/my-notifications', authenticateToken, requireRole('teacher'), async (req, res) => {
  console.log('🔥 GET /api/classes/teachers/my-notifications - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const teacherUUID = req.user.userId; // UUID
    const { limit = 20, offset = 0 } = req.query;

    console.log('📋 GET /api/classes/teachers/my-notifications - Fetching notifications for:', teacherUUID);

    const result = await pool.query(`
      SELECT 
        n.id,
        n.title,
        n.content,
        n.priority,
        n.publish_date,
        n.status,
        COUNT(nd.id) as total_deliveries,
        COUNT(CASE WHEN nd.status = 'read' THEN 1 END) as read_count,
        COUNT(CASE WHEN nd.status = 'sent' THEN 1 END) as sent_count
      FROM notices n
      LEFT JOIN notice_deliveries nd ON n.id = nd.notice_id
      WHERE n.created_by = $1
        AND n.audience_type = 'students'
        AND n.branch_id = $2
      GROUP BY n.id
      ORDER BY n.publish_date DESC
      LIMIT $3 OFFSET $4
    `, [teacherUUID, req.user.branchId, parseInt(limit), parseInt(offset)]);

    const response = {
      success: true,
      data: result.rows.map(notification => ({
        id: notification.id,
        title: notification.title,
        content: notification.content,
        priority: notification.priority,
        publish_date: notification.publish_date,
        status: notification.status,
        statistics: {
          total_deliveries: parseInt(notification.total_deliveries),
          read_count: parseInt(notification.read_count),
          sent_count: parseInt(notification.sent_count),
          read_rate: notification.total_deliveries > 0 ? 
            Math.round((parseInt(notification.read_count) / parseInt(notification.total_deliveries)) * 100) : 0
        }
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    };

    console.log('✅ GET /api/classes/teachers/my-notifications - Success:', {
      teacherId: teacherUUID,
      notificationsCount: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/teachers/my-notifications - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications'
    });
  }
});

// GET /api/classes/teachers/notification-status/:noticeId - Get delivery status for a notification
router.get('/teachers/notification-status/:noticeId', authenticateToken, requireRole('teacher'), async (req, res) => {
  console.log('🔥 GET /api/classes/teachers/notification-status/:noticeId - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { noticeId } = req.params;
    const teacherUUID = req.user.userId; // UUID

    console.log('📋 GET /api/classes/teachers/notification-status/:noticeId - Fetching status for:', noticeId);

    // Verify the notification belongs to this teacher
    const noticeCheck = await pool.query(
      `SELECT id, title, content, priority, publish_date 
       FROM notices 
       WHERE id = $1 AND created_by = $2 AND branch_id = $3 AND audience_type = 'students'`,
      [noticeId, teacherUUID, req.user.branchId]
    );

    if (noticeCheck.rows.length === 0) {
      console.log('⚠️ GET /api/classes/teachers/notification-status/:noticeId - Notification not found:', noticeId);
      return res.status(404).json({
        success: false,
        error: 'Notification not found or access denied'
      });
    }

    const notice = noticeCheck.rows[0];

    // Get delivery status breakdown
    const deliveryStatusQuery = `
      SELECT 
        nd.status,
        COUNT(*) as count,
        STRING_AGG(DISTINCT u.name, ', ' ORDER BY u.name) as student_names
      FROM notice_deliveries nd
      JOIN public.users u ON nd.user_id = u.id
      WHERE nd.notice_id = $1
      GROUP BY nd.status
      ORDER BY 
        CASE nd.status
          WHEN 'pending' THEN 1
          WHEN 'sent' THEN 2
          WHEN 'delivered' THEN 3
          WHEN 'read' THEN 4
          WHEN 'failed' THEN 5
          ELSE 6
        END
    `;

    const deliveryStatusResult = await pool.query(deliveryStatusQuery, [noticeId]);

    // Get total students count
    const totalStudentsResult = await pool.query(
      'SELECT COUNT(*) as total FROM notice_deliveries WHERE notice_id = $1',
      [noticeId]
    );

    const response = {
      success: true,
      data: {
        notice: {
          id: notice.id,
          title: notice.title,
          content: notice.content,
          priority: notice.priority,
          publish_date: notice.publish_date
        },
        delivery_status: deliveryStatusResult.rows.map(row => ({
          status: row.status,
          count: parseInt(row.count),
          student_names: row.student_names ? row.student_names.split(', ') : []
        })),
        total_students: parseInt(totalStudentsResult.rows[0].total),
        summary: {
          pending: deliveryStatusResult.rows.find(r => r.status === 'pending')?.count || 0,
          sent: deliveryStatusResult.rows.find(r => r.status === 'sent')?.count || 0,
          delivered: deliveryStatusResult.rows.find(r => r.status === 'delivered')?.count || 0,
          read: deliveryStatusResult.rows.find(r => r.status === 'read')?.count || 0,
          failed: deliveryStatusResult.rows.find(r => r.status === 'failed')?.count || 0
        }
      }
    };

    console.log('✅ GET /api/classes/teachers/notification-status/:noticeId - Success:', {
      noticeId,
      totalStudents: parseInt(totalStudentsResult.rows[0].total)
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/teachers/notification-status/:noticeId - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification status'
    });
  }
});

// GET /api/classes/teachers/eligibility - Check teacher eligibility for sending notifications
router.get('/teachers/eligibility', authenticateToken, requireRole('teacher'), async (req, res) => {
  console.log('🔥 GET /api/classes/teachers/eligibility - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const teacherUUID = req.user.userId; // UUID
    const branchId = req.user.branchId;

    console.log('📋 GET /api/classes/teachers/eligibility - Checking eligibility for:', teacherUUID);

    // Check teacher eligibility
    const eligibilityQuery = `
      SELECT 
        c.id as class_id,
        c.class_name,
        c.standard,
        c.grade,
        CASE 
          WHEN c.teacher_id = $1 THEN 'class_teacher'
          ELSE 'subject_teacher'
        END as eligibility_type,
        COUNT(s.id) as student_count
      FROM branch.classes c
      LEFT JOIN branch.students s ON c.id = s.class_id AND s.status = 'Active'
      WHERE c.branch_id = $2 
        AND c.status = 'Active'
        AND (
          -- Teacher is class teacher
          c.teacher_id = $1
          OR
          -- Teacher teaches any subject to this class
          EXISTS (
            SELECT 1 FROM branch.timetables t 
            WHERE t.class_id = c.id 
              AND t.teacher_id = $1 
              AND t.branch_id = $2
          )
        )
      GROUP BY c.id, c.class_name, c.standard, c.grade, c.teacher_id
      ORDER BY c.class_name
    `;

    const eligibilityResult = await pool.query(eligibilityQuery, [teacherUUID, branchId]);

    const isEligible = eligibilityResult.rows.length > 0;
    const totalStudents = eligibilityResult.rows.reduce((sum, row) => sum + parseInt(row.student_count), 0);

    const response = {
      success: true,
      data: {
        is_eligible: isEligible,
        eligibility_message: isEligible 
          ? 'You are eligible to send notifications to your students'
          : 'You are not eligible to send notifications. You must be a class teacher or teaching at least one subject.',
        eligible_classes: eligibilityResult.rows.map(row => ({
          class_id: row.class_id,
          class_name: row.class_name,
          standard: row.standard,
          grade: row.grade,
          eligibility_type: row.eligibility_type,
          student_count: parseInt(row.student_count)
        })),
        summary: {
          total_eligible_classes: eligibilityResult.rows.length,
          total_students: totalStudents,
          class_teacher_classes: eligibilityResult.rows.filter(r => r.eligibility_type === 'class_teacher').length,
          subject_teacher_classes: eligibilityResult.rows.filter(r => r.eligibility_type === 'subject_teacher').length
        }
      }
    };

    console.log('✅ GET /api/classes/teachers/eligibility - Success:', {
      teacherId: teacherUUID,
      isEligible,
      eligibleClasses: eligibilityResult.rows.length,
      totalStudents
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/teachers/eligibility - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to check teacher eligibility'
    });
  }
});

module.exports = router;


module.exports = router;