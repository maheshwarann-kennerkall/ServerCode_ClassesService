// Additional timetable management endpoints

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

module.exports = router;