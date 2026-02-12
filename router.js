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

// ========== SUBJECTS MANAGEMENT ENDPOINTS ==========

// GET /api/subjects - Fetch subjects for user's branch
router.get('/subjects', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/subjects - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const result = await pool.query(`
      SELECT * FROM branch.subjects
      WHERE branch_id = $1
      ORDER BY created_at DESC
    `, [req.user.branchId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/subjects - Create new subject with duplicate name check
router.post('/subjects', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
  console.log('🔥 POST /api/subjects - Incoming request:', {
    headers: req.headers,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { name, department, subject_type } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        error: 'Missing required field: name'
      });
    }

    // Check if subject name already exists for this branch
    const existingSubject = await pool.query(`
      SELECT id FROM branch.subjects
      WHERE name = $1 AND branch_id = $2::uuid
    `, [name, req.user.branchId]);

    if (existingSubject.rows.length > 0) {
      return res.status(400).json({ error: 'Subject name already exists for this branch' });
    }

    const result = await pool.query(`
      INSERT INTO branch.subjects (name, department, subject_type, branch_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `, [name, department, subject_type, req.user.branchId]);

    res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// PUT /api/subjects/:id - Update subject (only name field)
router.put('/subjects/:id', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
  console.log('🔥 PUT /api/subjects/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { name } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        error: 'Missing required field: name'
      });
    }

    // Check if subject exists and belongs to user's branch
    const existingSubject = await pool.query(`
      SELECT id FROM branch.subjects
      WHERE id = $1 AND branch_id = $2::uuid
    `, [id, req.user.branchId]);

    if (existingSubject.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Check if new name conflicts with existing subject (excluding current one)
    const duplicateSubject = await pool.query(`
      SELECT id FROM branch.subjects
      WHERE name = $1 AND branch_id = $2::uuid AND id != $3
    `, [name, req.user.branchId, id]);

    if (duplicateSubject.rows.length > 0) {
      return res.status(400).json({ error: 'Subject name already exists for this branch' });
    }

    const result = await pool.query(`
      UPDATE branch.subjects SET
        name = $1, updated_at = NOW()
      WHERE id = $2 AND branch_id = $3
      RETURNING *
    `, [name, id, req.user.branchId]);

    res.json({
      success: true,
      message: 'Subject updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// DELETE /api/subjects/:id - Delete subject
router.delete('/subjects/:id', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
  console.log('🔥 DELETE /api/subjects/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;

    // Check if subject exists and belongs to user's branch
    const existingSubject = await pool.query(`
      SELECT id FROM branch.subjects
      WHERE id = $1 AND branch_id = $2::uuid
    `, [id, req.user.branchId]);

    if (existingSubject.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    await pool.query(`
      DELETE FROM branch.subjects
      WHERE id = $1 AND branch_id = $2::uuid
    `, [id, req.user.branchId]);

    res.json({
      success: true,
      message: 'Subject deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    if (academic_year && academic_year !== 'all') {
      query += ` AND c.academic_year = $${paramIndex}`;
      queryParams.push(academic_year);
      paramIndex++;
      console.log('🔍 DEBUG: Filtering classes by specific academic year:', academic_year);
    } else if (academic_year !== 'all') {
      // Default to current year if no specific year requested
      query += ` AND c.academic_year IN (
        SELECT year_name FROM public.academic_years WHERE status = 'active'
      )`;
      console.log('🔍 DEBUG: Defaulting to active academic years');
    } else {
      console.log('🔍 DEBUG: Showing classes for all academic years');
    }
    // If academic_year === 'all', no filter applied

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

// GET /api/academic-years/active - Get active academic year (no role restrictions)
router.get('/academic-years/active', async (req, res) => {
  console.log('🔥 GET /api/academic-years/active - Incoming request:', {
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  try {
    console.log('📋 GET /api/academic-years/active - Fetching active academic year');

    // Get the active academic year
    const result = await pool.query(`
      SELECT
        id,
        year_name,
        status,
        start_date,
        end_date
      FROM public.academic_years
      WHERE status = 'active'
      ORDER BY start_date DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/academic-years/active - No active academic year found');
      return res.status(404).json({
        success: false,
        error: 'No active academic year found'
      });
    }

    const response = {
      success: true,
      data: result.rows[0]
    };

    console.log('✅ GET /api/academic-years/active - Active academic year retrieved:', {
      yearName: result.rows[0].year_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/academic-years/active - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active academic year'
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

    // Get all academic years with status 'active' and 'upcoming', prioritizing active ones
    const result = await pool.query(`
      SELECT
        id,
        year_name,
        status,
        start_date,
        end_date,
        CASE WHEN status = 'active' THEN 1 ELSE 0 END as is_active_order
      FROM public.academic_years
      WHERE status IN ('active', 'upcoming')
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

// GET /api/academic-years/all - Get ALL academic years from database (no status filtering)
// router.get('/academic-years/all', async (req, res) => {
//   console.log('🔥 GET /api/academic-years/all - Incoming request:', {
//     headers: req.headers,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     console.log('📋 GET /api/academic-years/all - Fetching ALL academic years from database');

//     // Get ALL academic years regardless of status
//     const result = await pool.query(`
//       SELECT
//         id,
//         year_name,
//         status,
//         start_date,
//         end_date,
//         branch_id,
//         semester_config,
//         created_at,
//         updated_at
//       FROM public.academic_years
//       ORDER BY start_date DESC
//     `);

//     const response = {
//       success: true,
//       data: result.rows,
//       total_count: result.rows.length
//     };

//     console.log('✅ GET /api/academic-years/all - All academic years retrieved:', {
//       totalYears: result.rows.length,
//       statusBreakdown: {
//         active: result.rows.filter(year => year.status === 'active').length,
//         upcoming: result.rows.filter(year => year.status === 'upcoming').length,
//         completed: result.rows.filter(year => year.status === 'completed').length
//       }
//     });

//     res.json(response);
//   } catch (error) {
//     console.error('❌ GET /api/academic-years/all - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch all academic years'
//     });
//   }
// });
router.get('/academic-years/all', authenticateToken, async (req, res) => {
  try {
    const branchId = req.user.branchId; // ✅ from token

    const result = await pool.query(`
      SELECT
        id,
        year_name,
        status,
        start_date,
        end_date,
        branch_id,
        semester_config,
        created_at,
        updated_at
      FROM public.academic_years
      WHERE branch_id = $1
      ORDER BY start_date DESC
    `, [branchId]);

    res.json({
      success: true,
      data: result.rows,
      total_count: result.rows.length
    });

  } catch (error) {
    console.error('❌ Academic years fetch failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch academic years'
    });
  }
});


// POST /api/academic-years - Create new academic year
// router.post('/academic-years', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
//   console.log('🔥 POST /api/academic-years - Incoming request:', {
//     headers: req.headers,
//     body: req.body,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     const { year_name, start_date, end_date, status } = req.body;

//     console.log('📋 POST /api/academic-years - Creating academic year:', {
//       year_name,
//       start_date,
//       end_date,
//       status
//     });

//     // Validate required fields
//     if (!year_name || !start_date || !end_date || !status) {
//       return res.status(400).json({
//         success: false,
//         error: 'year_name, start_date, end_date, and status are required'
//       });
//     }

//     // Validate status values
//     if (!['upcoming', 'active', 'completed'].includes(status)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Status must be one of: upcoming, active, completed'
//       });
//     }

//     // Validate date format and logic
//     if (new Date(start_date) >= new Date(end_date)) {
//       return res.status(400).json({
//         success: false,
//         error: 'End date must be after start date'
//       });
//     }

//     // Check for existing academic year with same name
//     const existingYear = await pool.query(
//       'SELECT id FROM public.academic_years WHERE year_name = $1',
//       [year_name]
//     );

//     if (existingYear.rows.length > 0) {
//       console.log('⚠️ POST /api/academic-years - Academic year already exists:', year_name);
//       return res.status(409).json({
//         success: false,
//         error: 'Academic year with this name already exists'
//       });
//     }

//     // Check for existing years with same status (only one active/upcoming allowed)
//     if (status === 'active' || status === 'upcoming') {
//       const existingStatusYear = await pool.query(
//         'SELECT id FROM public.academic_years WHERE status = $1',
//         [status]
//       );

//       if (existingStatusYear.rows.length > 0) {
//         console.log('⚠️ POST /api/academic-years - Academic year with status already exists:', status);
//         return res.status(409).json({
//           success: false,
//           error: `An academic year with status '${status}' already exists. Only one ${status} academic year is allowed.`
//         });
//       }
//     }

//     // Create the academic year
//     const result = await pool.query(`
//       INSERT INTO public.academic_years (year_name, start_date, end_date, status, semester_config, branch_id)
//       VALUES ($1, $2, $3, $4, $5, $6)
//       RETURNING *
//     `, [
//       year_name,
//       start_date,
//       end_date,
//       status,
//       JSON.stringify({ year_start: start_date, year_end: end_date }),
//       status === 'active' ? req.user.branchId : null
//     ]);

//     const newAcademicYear = result.rows[0];

//     const response = {
//       success: true,
//       data: {
//         id: newAcademicYear.year_name,
//         year_name: newAcademicYear.year_name,
//         start_date: newAcademicYear.start_date,
//         end_date: newAcademicYear.end_date,
//         status: newAcademicYear.status
//       },
//       message: 'Academic year created successfully'
//     };

//     console.log('✅ POST /api/academic-years - Academic year created:', {
//       yearName: year_name,
//       status: status,
//       id: newAcademicYear.year_name
//     });

//     res.status(201).json(response);
//   } catch (error) {
//     console.error('❌ POST /api/academic-years - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to create academic year'
//     });
//   }
// });

router.post(
  '/academic-years',
  authenticateToken,
  requireRole('admin', 'superadmin'),
  async (req, res) => {
    console.log('🔥 POST /api/academic-years', {
      body: req.body,
      user: req.user,
      time: new Date().toISOString()
    });

    try {
      const { year_name, start_date, end_date, status } = req.body;
      const branchId = req.user.branchId;

      /* -------------------- Basic validations -------------------- */
      if (!year_name || !start_date || !end_date || !status) {
        return res.status(400).json({
          success: false,
          error: 'year_name, start_date, end_date, and status are required'
        });
      }

      if (!['upcoming', 'active', 'completed'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Status must be upcoming, active, or completed'
        });
      }

      if (new Date(start_date) >= new Date(end_date)) {
        return res.status(400).json({
          success: false,
          error: 'End date must be after start date'
        });
      }

      /* -------------------- Per-branch duplicate check -------------------- */
      const duplicateYear = await pool.query(
        `
        SELECT 1
        FROM public.academic_years
        WHERE year_name = $1
          AND branch_id = $2
        `,
        [year_name, branchId]
      );

      if (duplicateYear.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Academic year already exists for this branch'
        });
      }

      /* -------------------- One active year per branch -------------------- */
      if (status === 'active') {
        const activeYear = await pool.query(
          `
          SELECT 1
          FROM public.academic_years
          WHERE status = 'active'
            AND branch_id = $1
          `,
          [branchId]
        );

        if (activeYear.rows.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'An active academic year already exists for this branch'
          });
        }
      }

      /* -------------------- Insert academic year -------------------- */
      const insertResult = await pool.query(
        `
        INSERT INTO public.academic_years
          (year_name, start_date, end_date, status, semester_config, branch_id)
        VALUES
          ($1, $2, $3, $4, $5, $6)
        RETURNING
          id, year_name, start_date, end_date, status, branch_id, created_at
        `,
        [
          year_name,
          start_date,
          end_date,
          status,
          {
            year_start: start_date,
            year_end: end_date
          },
          branchId
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Academic year created successfully',
        data: insertResult.rows[0]
      });

    } catch (error) {
      console.error('❌ Create academic year failed:', error);

      /* ---------- Handle DB constraint errors gracefully ---------- */
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Academic year conflict for this branch'
        });
      }

      if (error.code === '23514') {
        return res.status(400).json({
          success: false,
          error: 'Invalid academic year data'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to create academic year'
      });
    }
  }
);


// PUT /api/academic-years/:id - Update academic year
// router.put('/academic-years/:id', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { year_name, start_date, end_date, status } = req.body;

//     // Check if academic year exists
//     const existingYear = await pool.query(
//       'SELECT * FROM public.academic_years WHERE year_name = $1',
//       [id]
//     );

//     if (existingYear.rows.length === 0) {
//       console.log('⚠️ PUT /api/academic-years/:id - Academic year not found:', id);
//       return res.status(404).json({
//         success: false,
//         error: 'Academic year not found'
//       });
//     }

//     const currentYear = existingYear.rows[0];

//     // Validate status if provided
//     if (status && !['upcoming', 'active', 'completed'].includes(status)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Status must be one of: upcoming, active, completed'
//       });
//     }

//     // Validate date logic if dates are provided
//     if (start_date && end_date && new Date(start_date) >= new Date(end_date)) {
//       return res.status(400).json({
//         success: false,
//         error: 'End date must be after start date'
//       });
//     }

//     // Check for unique year name if changing
//     if (year_name && year_name !== id) {
//       const duplicateCheck = await pool.query(
//         'SELECT id FROM public.academic_years WHERE year_name = $1 AND year_name != $2',
//         [year_name, id]
//       );

//       if (duplicateCheck.rows.length > 0) {
//         console.log('⚠️ PUT /api/academic-years/:id - Duplicate year name:', year_name);
//         return res.status(409).json({
//           success: false,
//           error: 'Academic year with this name already exists'
//         });
//       }
//     }

//     // Check for existing years with same status if status is being changed
//     if (status && status !== currentYear.status) {
//       if (status === 'active' || status === 'upcoming') {
//         const existingStatusYear = await pool.query(
//           'SELECT id FROM public.academic_years WHERE status = $1 AND year_name != $2',
//           [status, id]
//         );

//         if (existingStatusYear.rows.length > 0) {
//           console.log('⚠️ PUT /api/academic-years/:id - Academic year with status already exists:', status);
//           return res.status(409).json({
//             success: false,
//             error: `An academic year with status '${status}' already exists. Only one ${status} academic year is allowed.`
//           });
//         }
//       }
//     }

//     // Build update query dynamically
//     const updateFields = [];
//     const updateValues = [];
//     let paramIndex = 1;

//     if (year_name) {
//       updateFields.push(`year_name = $${paramIndex}`);
//       updateValues.push(year_name);
//       paramIndex++;
//     }
//     if (start_date) {
//       updateFields.push(`start_date = $${paramIndex}`);
//       updateValues.push(start_date);
//       paramIndex++;
//     }
//     if (end_date) {
//       updateFields.push(`end_date = $${paramIndex}`);
//       updateValues.push(end_date);
//       paramIndex++;
//     }
//     if (status) {
//       updateFields.push(`status = $${paramIndex}`);
//       updateValues.push(status);
//       paramIndex++;
//     }

//     // If status is being set to 'active' and branch_id is not set, set it
//     const finalStatus = status || currentYear.status;
//     if (finalStatus === 'active' && !currentYear.branch_id) {
//       updateFields.push(`branch_id = $${paramIndex}`);
//       updateValues.push(req.user.branchId);
//       paramIndex++;
//       console.log('📋 PUT /api/academic-years/:id - Setting branch_id for active status:', req.user.branchId);
//     }

//     // Always update semester_config if dates are being changed
//     if (start_date || end_date) {
//       const configStart = start_date || currentYear.start_date;
//       const configEnd = end_date || currentYear.end_date;
//       updateFields.push(`semester_config = $${paramIndex}`);
//       updateValues.push(JSON.stringify({ year_start: configStart, year_end: configEnd }));
//       paramIndex++;
//     }

//     updateFields.push(`updated_at = NOW()`);
//     updateValues.push(id);

//     // Perform the update
//     const updateQuery = `
//       UPDATE public.academic_years 
//       SET ${updateFields.join(', ')}
//       WHERE year_name = $${paramIndex}
//       RETURNING *
//     `;

//     const result = await pool.query(updateQuery, updateValues);
//     const updatedYear = result.rows[0];

//     console.log('✅ PUT /api/academic-years/:id - Update result:', {
//       id,
//       updatedYearName: updatedYear.year_name,
//       updatedStatus: updatedYear.status,
//       updatedBranchId: updatedYear.branch_id,
//       updateFields: updateFields.join(', '),
//       updateValues: updateValues.slice(0, -1) // exclude the WHERE id
//     });

//     const response = {
//       success: true,
//       data: {
//         id: updatedYear.year_name,
//         year_name: updatedYear.year_name,
//         start_date: updatedYear.start_date,
//         end_date: updatedYear.end_date,
//         status: updatedYear.status
//       },
//       message: 'Academic year updated successfully'
//     };

//     console.log('✅ PUT /api/academic-years/:id - Academic year updated:', {
//       id,
//       yearName: updatedYear.year_name,
//       status: updatedYear.status
//     });

//     res.json(response);
//   } catch (error) {
//     console.error('❌ PUT /api/academic-years/:id - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to update academic year'
//     });
//   }
// });
router.put(
  '/academic-years/:id',
  authenticateToken,
  requireRole('admin', 'superadmin'),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { id } = req.params;
      const { year_name, start_date, end_date, status } = req.body;
      const branchId = req.user.branchId;

      await client.query('BEGIN');

      /* 1️⃣ Fetch existing academic year */
      const existingRes = await client.query(
        `SELECT * FROM public.academic_years WHERE year_name = $1`,
        [id]
      );

      if (existingRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Academic year not found'
        });
      }

      const currentYear = existingRes.rows[0];

      /* 2️⃣ Validate status */
      if (status && !['upcoming', 'active', 'completed'].includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Status must be one of: upcoming, active, completed'
        });
      }

      /* 3️⃣ Validate date logic */
      if (start_date && end_date && new Date(start_date) >= new Date(end_date)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'End date must be after start date'
        });
      }

      /* 4️⃣ Ensure year_name uniqueness */
      if (year_name && year_name !== id) {
        const dupCheck = await client.query(
          `
          SELECT 1
          FROM public.academic_years
          WHERE year_name = $1 AND year_name <> $2
          `,
          [year_name, id]
        );

        if (dupCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            error: 'Academic year with this name already exists'
          });
        }
      }

      /* 5️⃣ If activating → deactivate existing active year FIRST */
      if (status === 'active') {
        await client.query(
          `
          UPDATE public.academic_years
          SET status = 'completed'
          WHERE branch_id = $1
            AND status = 'active'
          `,
          [branchId]
        );
      }

      /* 6️⃣ Build UPDATE dynamically */
      const fields = [];
      const values = [];
      let i = 1;

      if (year_name) {
        fields.push(`year_name = $${i}`);
        values.push(year_name);
        i++;
      }

      if (start_date) {
        fields.push(`start_date = $${i}`);
        values.push(start_date);
        i++;
      }

      if (end_date) {
        fields.push(`end_date = $${i}`);
        values.push(end_date);
        i++;
      }

      if (status) {
        fields.push(`status = $${i}`);
        values.push(status);
        i++;
      }

      /* Ensure branch_id is set when active */
      const finalStatus = status || currentYear.status;
      if (finalStatus === 'active') {
        fields.push(`branch_id = $${i}`);
        values.push(branchId);
        i++;
      }

      /* Update semester_config if dates changed */
      if (start_date || end_date) {
        const yearStart = start_date || currentYear.start_date;
        const yearEnd = end_date || currentYear.end_date;

        fields.push(`semester_config = $${i}`);
        values.push(
          JSON.stringify({
            year_start: yearStart,
            year_end: yearEnd
          })
        );
        i++;
      }

      fields.push(`updated_at = NOW()`);

      /* 7️⃣ Execute UPDATE */
      const updateQuery = `
        UPDATE public.academic_years
        SET ${fields.join(', ')}
        WHERE year_name = $${i}
        RETURNING *
      `;

      values.push(id);

      const updateRes = await client.query(updateQuery, values);
      const updated = updateRes.rows[0];

      await client.query('COMMIT');

      /* 8️⃣ Response */
      res.json({
        success: true,
        message: 'Academic year updated successfully',
        data: {
          year_name: updated.year_name,
          start_date: updated.start_date,
          end_date: updated.end_date,
          status: updated.status,
          branch_id: updated.branch_id
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ PUT /api/academic-years/:id error:', error.message);

      res.status(500).json({
        success: false,
        error: 'Failed to update academic year',
        details: error.message
      });
    } finally {
      client.release();
    }
  }
);

// DELETE /api/academic-years/:id - Delete academic year
router.delete('/academic-years/:id', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
  console.log('🔥 DELETE /api/academic-years/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 DELETE /api/academic-years/:id - Deleting academic year:', id);

    // Check if academic year exists
    const existingYear = await pool.query(
      'SELECT * FROM public.academic_years WHERE year_name = $1',
      [id]
    );

    if (existingYear.rows.length === 0) {
      console.log('⚠️ DELETE /api/academic-years/:id - Academic year not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Academic year not found'
      });
    }

    const yearData = existingYear.rows[0];

    // Check if academic year is being used in classes
    const classesCheck = await pool.query(
      'SELECT COUNT(*) as count FROM branch.classes WHERE academic_year = $1',
      [id]
    );

    if (parseInt(classesCheck.rows[0].count) > 0) {
      console.log('⚠️ DELETE /api/academic-years/:id - Academic year has classes:', id);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete academic year that has classes assigned to it. Please delete or reassign classes first.'
      });
    }

    // Check if academic year is being used in students
    const studentsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM branch.students WHERE academic_year = $1',
      [id]
    );

    if (parseInt(studentsCheck.rows[0].count) > 0) {
      console.log('⚠️ DELETE /api/academic-years/:id - Academic year has students:', id);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete academic year that has students assigned to it. Please delete or reassign students first.'
      });
    }

    // Delete the academic year
    const deleteResult = await pool.query(
      'DELETE FROM public.academic_years WHERE year_name = $1',
      [id]
    );

    if (deleteResult.rowCount === 0) {
      console.log('⚠️ DELETE /api/academic-years/:id - No rows affected:', id);
      return res.status(404).json({
        success: false,
        error: 'Academic year not found or not deleted'
      });
    }

    const response = {
      success: true,
      message: 'Academic year deleted successfully'
    };

    console.log('✅ DELETE /api/academic-years/:id - Academic year deleted:', {
      id,
      yearName: yearData.year_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ DELETE /api/academic-years/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete academic year'
    });
  }
});

// ========== SYLLABUS MANAGEMENT ENDPOINTS ==========

// GET /api/syllabus - Get all syllabi for the branch
router.get('/syllabus', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/syllabus - Incoming request:', {
    headers: req.headers,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { class_id, subject_id, limit = 100, offset = 0 } = req.query;

    console.log('📋 GET /api/syllabus - Query params:', { class_id, subject_id, limit, offset });

    // Build query to get syllabi with chapters and subtopics
    let query = `
      SELECT
        s.id as syllabus_id,
        s.class_id,
        s.subject_id,
        s.created_at as syllabus_created_at,
        s.updated_at as syllabus_updated_at,
        c.class_name,
        sub.name as subject_name,
        sc.id as chapter_id,
        sc.chapter_name,
        sc.start_date,
        sc.end_date,
        sc.created_at as chapter_created_at,
        sc.updated_at as chapter_updated_at,
        st.id as subtopic_id,
        st.subtopic_name,
        st.created_at as subtopic_created_at,
        st.updated_at as subtopic_updated_at
      FROM branch.syllabi s
      JOIN branch.classes c ON s.class_id = c.id
      JOIN branch.subjects sub ON s.subject_id = sub.id
      LEFT JOIN branch.syllabus_chapters sc ON s.id = sc.syllabus_id
      LEFT JOIN branch.syllabus_subtopics st ON sc.id = st.chapter_id
      WHERE s.class_id IN (
        SELECT id FROM branch.classes WHERE branch_id = $1
      )
      AND sub.branch_id = $1
    `;

    const queryParams = [req.user.branchId];
    let paramIndex = 2;

    // Add class filter if provided
    if (class_id) {
      query += ` AND s.class_id = $${paramIndex}`;
      queryParams.push(class_id);
      paramIndex++;
    }

    // Add subject filter if provided
    if (subject_id) {
      query += ` AND s.subject_id = $${paramIndex}`;
      queryParams.push(subject_id);
      paramIndex++;
    }

    query += ` ORDER BY c.class_name, sub.name, sc.start_date, st.subtopic_name`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, queryParams);

    // Transform flat results into nested structure
    const syllabusMap = new Map();

    result.rows.forEach(row => {
      const classKey = row.class_name;
      const subjectKey = row.subject_name;

      if (!syllabusMap.has(classKey)) {
        syllabusMap.set(classKey, {
          class: row.class_name,
          subjects: new Map()
        });
      }

      const classEntry = syllabusMap.get(classKey);

      if (!classEntry.subjects.has(subjectKey)) {
        classEntry.subjects.set(subjectKey, {
          subject: row.subject_name,
          chapters: []
        });
      }

      const subjectEntry = classEntry.subjects.get(subjectKey);

      if (row.chapter_id) {
        let chapter = subjectEntry.chapters.find(ch => ch.chapter === row.chapter_name);
        if (!chapter) {
          chapter = {
            chapter: row.chapter_name,
            startDate: row.start_date.toISOString().split('T')[0],
            endDate: row.end_date.toISOString().split('T')[0],
            subtopics: []
          };
          subjectEntry.chapters.push(chapter);
        }

        if (row.subtopic_id) {
          chapter.subtopics.push(row.subtopic_name);
        }
      }
    });

    // Convert maps to arrays
    const syllabus = Array.from(syllabusMap.values()).map(classEntry => ({
      class: classEntry.class,
      subjects: Array.from(classEntry.subjects.values()).map(subjectEntry => ({
        subject: subjectEntry.subject,
        chapters: subjectEntry.chapters.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      }))
    }));

    const response = {
      success: true,
      data: syllabus,
      total: syllabus.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    console.log('✅ GET /api/syllabus - Success:', {
      totalClasses: syllabus.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/syllabus - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch syllabi'
    });
  }
});

// POST /api/syllabus - Create new syllabus
router.post('/syllabus', authenticateToken, async (req, res) => {
  console.log('🔥 POST /api/syllabus - Incoming request:', {
    headers: req.headers,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { class_id, subject_id, chapters } = req.body;

    console.log('📋 POST /api/syllabus - Creating syllabus:', {
      class_id,
      subject_id,
      chapterCount: chapters?.length || 0
    });

    // Validate required fields
    if (!class_id || !subject_id) {
      return res.status(400).json({
        success: false,
        error: 'class_id and subject_id are required'
      });
    }

    if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'chapters array is required and must not be empty'
      });
    }

    // Validate class belongs to user's branch
    const classCheck = await pool.query(
      'SELECT id, class_name FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
      [class_id, req.user.branchId]
    );

    if (classCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid class_id or class does not belong to your branch'
      });
    }

    // Validate subject belongs to user's branch
    const subjectCheck = await pool.query(
      'SELECT id, name FROM branch.subjects WHERE id = $1 AND branch_id = $2::uuid',
      [subject_id, req.user.branchId]
    );

    if (subjectCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subject_id or subject does not belong to your branch'
      });
    }

    // Check if syllabus already exists for this class and subject
    const existingSyllabus = await pool.query(
      'SELECT id FROM branch.syllabi WHERE class_id = $1 AND subject_id = $2',
      [class_id, subject_id]
    );

    if (existingSyllabus.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Syllabus already exists for this class and subject'
      });
    }

    // Validate chapters
    for (const chapter of chapters) {
      if (!chapter.chapter || !chapter.startDate || !chapter.endDate) {
        return res.status(400).json({
          success: false,
          error: 'Each chapter must have chapter name, startDate, and endDate'
        });
      }
      if (!Array.isArray(chapter.subtopics)) {
        return res.status(400).json({
          success: false,
          error: 'subtopics must be an array'
        });
      }
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert syllabus
      const syllabusResult = await client.query(
        'INSERT INTO branch.syllabi (class_id, subject_id) VALUES ($1, $2) RETURNING id',
        [class_id, subject_id]
      );
      const syllabusId = syllabusResult.rows[0].id;

      // Insert chapters and subtopics
      for (const chapter of chapters) {
        const chapterResult = await client.query(
          'INSERT INTO branch.syllabus_chapters (syllabus_id, chapter_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id',
          [syllabusId, chapter.chapter, chapter.startDate, chapter.endDate]
        );
        const chapterId = chapterResult.rows[0].id;

        // Insert subtopics
        for (const subtopic of chapter.subtopics) {
          await client.query(
            'INSERT INTO branch.syllabus_subtopics (chapter_id, subtopic_name) VALUES ($1, $2)',
            [chapterId, subtopic]
          );
        }
      }

      await client.query('COMMIT');

      const response = {
        success: true,
        data: {
          id: syllabusId,
          class_id,
          subject_id,
          chapters: chapters.length
        },
        message: 'Syllabus created successfully'
      };

      console.log('✅ POST /api/syllabus - Success:', {
        syllabusId,
        className: classCheck.rows[0].class_name,
        subjectName: subjectCheck.rows[0].name,
        chaptersCount: chapters.length
      });

      res.status(201).json(response);
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.log('🔴 POST /api/syllabus - Transaction error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ POST /api/syllabus - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create syllabus'
    });
  }
});

// GET /api/syllabus/:id - Get specific syllabus
router.get('/syllabus/:id', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/syllabus/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 GET /api/syllabus/:id - Syllabus ID:', id);

    const query = `
      SELECT
        s.id as syllabus_id,
        s.class_id,
        s.subject_id,
        s.created_at as syllabus_created_at,
        s.updated_at as syllabus_updated_at,
        c.class_name,
        sub.name as subject_name,
        sc.id as chapter_id,
        sc.chapter_name,
        sc.start_date,
        sc.end_date,
        sc.created_at as chapter_created_at,
        sc.updated_at as chapter_updated_at,
        st.id as subtopic_id,
        st.subtopic_name,
        st.created_at as subtopic_created_at,
        st.updated_at as subtopic_updated_at
      FROM branch.syllabi s
      JOIN branch.classes c ON s.class_id = c.id
      JOIN branch.subjects sub ON s.subject_id = sub.id
      LEFT JOIN branch.syllabus_chapters sc ON s.id = sc.syllabus_id
      LEFT JOIN branch.syllabus_subtopics st ON sc.id = st.chapter_id
      WHERE s.id = $1
      AND c.branch_id = $2::uuid
      AND sub.branch_id = $2::uuid
      ORDER BY sc.start_date, st.subtopic_name
    `;

    const result = await pool.query(query, [id, req.user.branchId]);

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/syllabus/:id - Syllabus not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Syllabus not found'
      });
    }

    // Transform to nested structure
    const row = result.rows[0];
    const syllabus = {
      id: row.syllabus_id,
      class: row.class_name,
      subject: row.subject_name,
      chapters: []
    };

    const chapterMap = new Map();

    result.rows.forEach(row => {
      if (row.chapter_id) {
        if (!chapterMap.has(row.chapter_id)) {
          chapterMap.set(row.chapter_id, {
            chapter: row.chapter_name,
            startDate: row.start_date.toISOString().split('T')[0],
            endDate: row.end_date.toISOString().split('T')[0],
            subtopics: []
          });
        }

        if (row.subtopic_id) {
          chapterMap.get(row.chapter_id).subtopics.push(row.subtopic_name);
        }
      }
    });

    syllabus.chapters = Array.from(chapterMap.values()).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    const response = {
      success: true,
      data: syllabus
    };

    console.log('✅ GET /api/syllabus/:id - Success:', {
      syllabusId: id,
      className: row.class_name,
      subjectName: row.subject_name,
      chaptersCount: syllabus.chapters.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/syllabus/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch syllabus'
    });
  }
});

// PUT /api/syllabus/:id - Update syllabus
router.put('/syllabus/:id', authenticateToken, async (req, res) => {
  console.log('🔥 PUT /api/syllabus/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { chapters } = req.body;

    console.log('📋 PUT /api/syllabus/:id - Updating syllabus:', { id, chapterCount: chapters?.length || 0 });

    // Check if syllabus exists and belongs to user's branch
    const syllabusCheck = await pool.query(`
      SELECT s.*, c.class_name, sub.name as subject_name
      FROM branch.syllabi s
      JOIN branch.classes c ON s.class_id = c.id
      JOIN branch.subjects sub ON s.subject_id = sub.id
      WHERE s.id = $1 AND c.branch_id = $2::uuid AND sub.branch_id = $2::uuid
    `, [id, req.user.branchId]);

    if (syllabusCheck.rows.length === 0) {
      console.log('⚠️ PUT /api/syllabus/:id - Syllabus not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Syllabus not found'
      });
    }

    const syllabusData = syllabusCheck.rows[0];

    // Validate chapters
    if (!chapters || !Array.isArray(chapters)) {
      return res.status(400).json({
        success: false,
        error: 'chapters must be an array'
      });
    }

    for (const chapter of chapters) {
      if (!chapter.chapter || !chapter.startDate || !chapter.endDate) {
        return res.status(400).json({
          success: false,
          error: 'Each chapter must have chapter name, startDate, and endDate'
        });
      }
      if (!Array.isArray(chapter.subtopics)) {
        return res.status(400).json({
          success: false,
          error: 'subtopics must be an array'
        });
      }
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing chapters and subtopics
      await client.query('DELETE FROM branch.syllabus_subtopics WHERE chapter_id IN (SELECT id FROM branch.syllabus_chapters WHERE syllabus_id = $1)', [id]);
      await client.query('DELETE FROM branch.syllabus_chapters WHERE syllabus_id = $1', [id]);

      // Insert new chapters and subtopics
      for (const chapter of chapters) {
        const chapterResult = await client.query(
          'INSERT INTO branch.syllabus_chapters (syllabus_id, chapter_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id',
          [id, chapter.chapter, chapter.startDate, chapter.endDate]
        );
        const chapterId = chapterResult.rows[0].id;

        for (const subtopic of chapter.subtopics) {
          await client.query(
            'INSERT INTO branch.syllabus_subtopics (chapter_id, subtopic_name) VALUES ($1, $2)',
            [chapterId, subtopic]
          );
        }
      }

      // Update syllabus updated_at
      await client.query('UPDATE branch.syllabi SET updated_at = NOW() WHERE id = $1', [id]);

      await client.query('COMMIT');

      const response = {
        success: true,
        data: {
          id,
          chapters: chapters.length
        },
        message: 'Syllabus updated successfully'
      };

      console.log('✅ PUT /api/syllabus/:id - Success:', {
        syllabusId: id,
        className: syllabusData.class_name,
        subjectName: syllabusData.subject_name,
        chaptersCount: chapters.length
      });

      res.json(response);
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.log('🔴 PUT /api/syllabus/:id - Transaction error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ PUT /api/syllabus/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update syllabus'
    });
  }
});

// DELETE /api/syllabus/:id - Delete syllabus
router.delete('/syllabus/:id', authenticateToken, async (req, res) => {
  console.log('🔥 DELETE /api/syllabus/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 DELETE /api/syllabus/:id - Deleting syllabus:', id);

    // Check if syllabus exists and belongs to user's branch
    const syllabusCheck = await pool.query(`
      SELECT s.*, c.class_name, sub.name as subject_name
      FROM branch.syllabi s
      JOIN branch.classes c ON s.class_id = c.id
      JOIN branch.subjects sub ON s.subject_id = sub.id
      WHERE s.id = $1 AND c.branch_id = $2::uuid AND sub.branch_id = $2::uuid
    `, [id, req.user.branchId]);

    if (syllabusCheck.rows.length === 0) {
      console.log('⚠️ DELETE /api/syllabus/:id - Syllabus not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Syllabus not found'
      });
    }

    const syllabusData = syllabusCheck.rows[0];

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete in correct order due to foreign keys
      await client.query('DELETE FROM branch.syllabus_subtopics WHERE chapter_id IN (SELECT id FROM branch.syllabus_chapters WHERE syllabus_id = $1)', [id]);
      await client.query('DELETE FROM branch.syllabus_chapters WHERE syllabus_id = $1', [id]);
      await client.query('DELETE FROM branch.syllabi WHERE id = $1', [id]);

      await client.query('COMMIT');

      const response = {
        success: true,
        message: 'Syllabus deleted successfully'
      };

      console.log('✅ DELETE /api/syllabus/:id - Success:', {
        syllabusId: id,
        className: syllabusData.class_name,
        subjectName: syllabusData.subject_name
      });

      res.json(response);
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.log('🔴 DELETE /api/syllabus/:id - Transaction error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ DELETE /api/syllabus/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete syllabus'
    });
  }
});

// ========== STUDENT TIMETABLE ENDPOINT ==========

// GET /api/my-timetable - Fetch timetable for the logged-in student's class
// GET /api/my-timetable - Fetch timetable for the logged-in student's class
// GET /api/my-timetable - Fetch timetable for the logged-in student's class
router.get('/my-timetable', authenticateToken, async (req, res) => {
  try {
    const { userId, branchId } = req.user;

    /* 1️⃣ Get student's class */
    const studentClassQuery = `
      SELECT c.id AS class_id, c.class_name
      FROM branch.students s
      JOIN branch.classes c ON c.id = s.class_id
      WHERE s.user_id = $1
        AND s.branch_id = $2::uuid
        AND s.status = 'Active'
    `;

    const studentRes = await pool.query(studentClassQuery, [
      userId,
      branchId,
    ]);

    if (!studentRes.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Student not assigned to any active class',
      });
    }

    const { class_id, class_name } = studentRes.rows[0];

    /* 2️⃣ Get timetable from master */
    const timetableQuery = `
      SELECT time_slots, days, timetable_data, academic_year
      FROM branch.timetables_master
      WHERE class_name = $1
        AND branch_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const timetableRes = await pool.query(timetableQuery, [
      class_name,
      branchId,
    ]);

    if (!timetableRes.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Timetable not created for this class',
      });
    }

    const timetable = timetableRes.rows[0];

    /* 3️⃣ Build clean day → slot response */
    const formattedTimetable = {};

    timetable.days.forEach((day) => {
      formattedTimetable[day] = {};

      timetable.time_slots.forEach((slot) => {
        formattedTimetable[day][slot] =
          timetable.timetable_data?.[day]?.[slot] || null;
      });
    });

    /* 4️⃣ Final response */
    res.json({
      success: true,
      data: {
        class_id,
        class_name,
        academic_year: timetable.academic_year,
        timetable: formattedTimetable,
      },
    });
  } catch (error) {
    console.error('❌ MY TIMETABLE ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch timetable',
    });
  }
});

// ========== COMPLETE TIMETABLE MANAGEMENT ENDPOINTS ==========

// GET /api/timetables/:id - Fetch specific timetable (must come before /:id route)
router.get('/timetables/:id', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/timetables/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 GET /api/timetables/:id - Timetable ID:', id);

    const result = await pool.query(
      'SELECT * FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/timetables/:id - Timetable not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    const timetable = result.rows[0];

    const response = {
      success: true,
      data: {
        id: timetable.id,
        class_name: timetable.class_name,
        time_slots: timetable.time_slots,
        days: timetable.days,
        timetable_data: timetable.timetable_data,
        academic_year: timetable.academic_year,
        created_at: timetable.created_at,
        updated_at: timetable.updated_at,
        created_by: timetable.created_by
      }
    };

    console.log('✅ GET /api/timetables/:id - Success:', {
      timetableId: id,
      className: timetable.class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/timetables/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch timetable'
    });
  }
});

// PUT /api/timetables/:id - Update complete timetable
router.put('/timetables/:id', authenticateToken, async (req, res) => {
  console.log('🔥 PUT /api/timetables/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { class_name, time_slots, days, timetable_data } = req.body;

    console.log('📋 PUT /api/timetables/:id - Updating timetable:', {
      id,
      class_name,
      timeSlotsCount: time_slots?.length || 0
    });

    // Check if timetable exists and belongs to user's branch
    const existingTimetable = await pool.query(
      'SELECT * FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (existingTimetable.rows.length === 0) {
      console.log('⚠️ PUT /api/timetables/:id - Timetable not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    // Validate required fields if provided
    if (class_name && !class_name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'class_name cannot be empty'
      });
    }

    if (time_slots && (!Array.isArray(time_slots) || time_slots.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'time_slots must be a non-empty array'
      });
    }

    if (days && (!Array.isArray(days) || days.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'days must be a non-empty array'
      });
    }

    if (timetable_data && typeof timetable_data !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'timetable_data must be an object'
      });
    }

    // Check for duplicate class name if changing
    if (class_name && class_name !== existingTimetable.rows[0].class_name) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM branch.timetables_master WHERE class_name = $1 AND branch_id = $2::uuid AND id != $3',
        [class_name, req.user.branchId, id]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Timetable for this class already exists'
        });
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (class_name) {
      updateFields.push(`class_name = $${paramIndex}`);
      updateValues.push(class_name);
      paramIndex++;
    }

    if (time_slots) {
      updateFields.push(`time_slots = $${paramIndex}`);
      updateValues.push(JSON.stringify(time_slots));
      paramIndex++;
    }

    if (days) {
      updateFields.push(`days = $${paramIndex}`);
      updateValues.push(JSON.stringify(days));
      paramIndex++;
    }

    if (timetable_data) {
      updateFields.push(`timetable_data = $${paramIndex}`);
      updateValues.push(JSON.stringify(timetable_data));
      paramIndex++;
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    const updateQuery = `
      UPDATE branch.timetables_master
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND branch_id = $${paramIndex + 1}
      RETURNING *
    `;

    updateValues.push(req.user.branchId);

    const result = await pool.query(updateQuery, updateValues);
    const updatedTimetable = result.rows[0];

    const response = {
      success: true,
      data: {
        id: updatedTimetable.id,
        class_name: updatedTimetable.class_name,
        time_slots: updatedTimetable.time_slots,
        days: updatedTimetable.days,
        timetable_data: updatedTimetable.timetable_data,
        academic_year: updatedTimetable.academic_year,
        updated_at: updatedTimetable.updated_at
      },
      message: 'Timetable updated successfully'
    };

    console.log('✅ PUT /api/timetables/:id - Success:', {
      timetableId: id,
      className: updatedTimetable.class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ PUT /api/timetables/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update timetable'
    });
  }
});

// DELETE /api/timetables/:id - Delete complete timetable
router.delete('/timetables/:id', authenticateToken, async (req, res) => {
  console.log('🔥 DELETE /api/timetables/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 DELETE /api/timetables/:id - Deleting timetable:', id);

    // Check if timetable exists and belongs to user's branch
    const existingTimetable = await pool.query(
      'SELECT class_name FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (existingTimetable.rows.length === 0) {
      console.log('⚠️ DELETE /api/timetables/:id - Timetable not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    const className = existingTimetable.rows[0].class_name;

    // Delete timetable
    const deleteResult = await pool.query(
      'DELETE FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (deleteResult.rowCount === 0) {
      console.log('⚠️ DELETE /api/timetables/:id - No rows affected:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    const response = {
      success: true,
      message: 'Timetable deleted successfully'
    };

    console.log('✅ DELETE /api/timetables/:id - Success:', {
      timetableId: id,
      className
    });

    res.json(response);
  } catch (error) {
    console.error('❌ DELETE /api/timetables/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete timetable'
    });
  }
});

// GET /api/timetables - Fetch all timetables for branch (with optional class filter)
router.get('/timetables', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/timetables - Incoming request:', {
    headers: req.headers,
    query: req.query,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { class_name, limit = 50, offset = 0 } = req.query;

    console.log('📋 GET /api/timetables - Query params:', { class_name, limit, offset });

    // Build query
    let query = `
      SELECT * FROM branch.timetables_master
      WHERE branch_id = $1
    `;
    const queryParams = [req.user.branchId];
    let paramIndex = 2;

    // Add class filter if provided
    if (class_name) {
      query += ` AND class_name = $${paramIndex}`;
      queryParams.push(class_name);
      paramIndex++;
    }

    // Add ordering and pagination
    query += ` ORDER BY updated_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, queryParams);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM branch.timetables_master WHERE branch_id = $1`;
    const countParams = [req.user.branchId];

    if (class_name) {
      countQuery += ` AND class_name = $2`;
      countParams.push(class_name);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    const response = {
      success: true,
      data: result.rows,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    console.log('✅ GET /api/timetables - Success:', {
      totalTimetables: total,
      returned: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/timetables - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch timetables'
    });
  }
});

// GET /api/timetables/teacher/:teacher_id - Fetch detailed timetable for a specific teacher
router.get('/timetables/teacher/:teacher_id', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/timetables/teacher/:teacher_id - Incoming request:', {
    teacherId: req.params.teacher_id,
    query: req.query,
    user: req.user
  });

  try {
    const { teacher_id } = req.params;
    let { academic_year } = req.query;

    if (!teacher_id) {
      return res.status(400).json({
        success: false,
        error: 'Teacher ID is required'
      });
    }

    // Default to current academic year if not provided
    if (!academic_year) {
      const academicYearResult = await pool.query(
        'SELECT year_name FROM public.academic_years WHERE status = $1 ORDER BY start_date DESC LIMIT 1',
        ['active']
      );
      academic_year = academicYearResult.rows.length > 0
        ? academicYearResult.rows[0].year_name
        : new Date().getFullYear() + '-' + (new Date().getFullYear() + 1);
    }

    // Fetch all timetables for the branch and academic year
    // We fetch ALL because we need to parse the JSONB data to find the teacher
    const query = `
      SELECT class_id, class_name, days, time_slots, timetable_data 
      FROM branch.timetables_master
      WHERE branch_id = $1 AND academic_year = $2
    `;

    const result = await pool.query(query, [req.user.branchId, academic_year]);
    const allTimetables = result.rows;

    console.log(`📋 Processing ${allTimetables.length} timetables for teacher ${teacher_id}`);

    // Fetch teacher details to check for name-based legacy matches
    const teacherResult = await pool.query('SELECT name FROM public.users WHERE id = $1', [teacher_id]);
    const teacherName = teacherResult.rows[0]?.name;

    const teacherSlots = [];

    // Iterate through all timetables to find slots for this teacher
    for (const timetable of allTimetables) {
      const { class_id, class_name, timetable_data } = timetable;

      if (!timetable_data) continue;

      // Check each day
      for (const day of Object.keys(timetable_data)) {
        const dayData = timetable_data[day];
        if (!dayData) continue;

        // Check each time slot
        for (const timeSlot of Object.keys(dayData)) {
          const slot = dayData[timeSlot];

          if (!slot || !slot.faculty) continue;

          // Check for match:
          // 1. Direct match with UUID (new system)
          // 2. Match with teacher Name (legacy system)
          const isMatch = (slot.faculty === teacher_id) || (teacherName && slot.faculty === teacherName);

          if (isMatch) {
            teacherSlots.push({
              class_id,
              class_name, // Include class name for display
              day,
              time_slot: timeSlot,
              subject: slot.subject,
              room_number: slot.room_number || null // Assuming room might be added later or exist
            });
          }
        }
      }
    }

    // Sort the results? Maybe by day then time? 
    // For now, returning list as is.

    const response = {
      success: true,
      data: teacherSlots,
      teacher_id,
      academic_year,
      total_slots: teacherSlots.length
    };

    console.log('✅ GET /api/timetables/teacher/:teacher_id - Success:', {
      returnedSlots: teacherSlots.length
    });

    res.json(response);

  } catch (error) {
    console.error('❌ GET /api/timetables/teacher/:teacher_id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch teacher timetable'
    });
  }
});

// POST /api/timetables - Create new complete timetable
router.post('/timetables', authenticateToken, async (req, res) => {
  console.log('🔥 POST /api/timetables - Incoming request:', {
    headers: req.headers,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { class_id, class_name, time_slots, days, timetable_data } = req.body;

    console.log('📋 POST /api/timetables - Creating timetable:', {
      class_id,
      class_name,
      timeSlotsCount: time_slots?.length || 0,
      daysCount: days?.length || 0
    });

    // Validate required fields
    // If class_id is present, we can look up class_name. If not, class_name is required.
    if (!class_id && (!class_name || !class_name.trim())) {
      return res.status(400).json({
        success: false,
        error: 'class_id or class_name is required'
      });
    }

    if (!time_slots || !Array.isArray(time_slots) || time_slots.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'time_slots must be a non-empty array'
      });
    }

    if (!days || !Array.isArray(days) || days.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'days must be a non-empty array'
      });
    }

    if (!timetable_data || typeof timetable_data !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'timetable_data must be an object'
      });
    }

    // Lookup class_name if missing but class_id provided
    let finalClassName = class_name;
    if (class_id && (!class_name || !class_name.trim())) {
      const classLookup = await pool.query(
        'SELECT class_name FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
        [class_id, req.user.branchId]
      );
      if (classLookup.rows.length > 0) {
        finalClassName = classLookup.rows[0].class_name;
      } else {
        return res.status(404).json({
          success: false,
          error: 'Invalid class_id'
        });
      }
    }

    // Check if timetable for this class already exists
    // Use class_id for check if available, otherwise check class_name
    let existingTimetable;
    if (class_id) {
      existingTimetable = await pool.query(
        'SELECT id FROM branch.timetables_master WHERE class_id = $1 AND branch_id = $2::uuid',
        [class_id, req.user.branchId]
      );
    } else {
      existingTimetable = await pool.query(
        'SELECT id FROM branch.timetables_master WHERE class_name = $1 AND branch_id = $2::uuid',
        [class_name, req.user.branchId]
      );
    }

    if (existingTimetable.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Timetable for this class already exists. Use PUT to update.'
      });
    }

    // Get current academic year
    const academicYearResult = await pool.query(
      'SELECT year_name FROM public.academic_years WHERE status = $1 ORDER BY start_date DESC LIMIT 1',
      ['active']
    );

    const academic_year = academicYearResult.rows.length > 0
      ? academicYearResult.rows[0].year_name
      : new Date().getFullYear() + '-' + (new Date().getFullYear() + 1);

    // Insert new timetable
    const insertQuery = `
      INSERT INTO branch.timetables_master (
        class_id, class_name, time_slots, days, timetable_data, branch_id, academic_year, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      class_id || null,
      finalClassName,
      JSON.stringify(time_slots),
      JSON.stringify(days),
      JSON.stringify(timetable_data),
      req.user.branchId,
      academic_year,
      req.user.userId
    ]);

    const newTimetable = result.rows[0];

    const response = {
      success: true,
      data: {
        id: newTimetable.id,
        class_id: newTimetable.class_id,
        class_name: newTimetable.class_name,
        time_slots: newTimetable.time_slots,
        days: newTimetable.days,
        timetable_data: newTimetable.timetable_data,
        academic_year: newTimetable.academic_year,
        created_at: newTimetable.created_at,
        updated_at: newTimetable.updated_at
      },
      message: 'Timetable created successfully'
    };

    console.log('✅ POST /api/timetables - Success:', {
      timetableId: newTimetable.id,
      className: class_name
    });

    res.status(201).json(response);
  } catch (error) {
    console.error('❌ POST /api/timetables - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create timetable'
    });
  }
});

// GET /api/timetables/:id - Fetch specific timetable
router.get('/timetables/:id', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/timetables/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 GET /api/timetables/:id - Timetable ID:', id);

    const result = await pool.query(
      'SELECT * FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (result.rows.length === 0) {
      console.log('⚠️ GET /api/timetables/:id - Timetable not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    const timetable = result.rows[0];

    const response = {
      success: true,
      data: {
        id: timetable.id,
        class_name: timetable.class_name,
        time_slots: timetable.time_slots,
        days: timetable.days,
        timetable_data: timetable.timetable_data,
        academic_year: timetable.academic_year,
        created_at: timetable.created_at,
        updated_at: timetable.updated_at,
        created_by: timetable.created_by
      }
    };

    console.log('✅ GET /api/timetables/:id - Success:', {
      timetableId: id,
      className: timetable.class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/timetables/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch timetable'
    });
  }
});

// PUT /api/timetables/:id - Update complete timetable
router.put('/timetables/:id', authenticateToken, async (req, res) => {
  console.log('🔥 PUT /api/timetables/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    body: req.body,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    const { class_id, class_name, time_slots, days, timetable_data } = req.body;

    console.log('📋 PUT /api/timetables/:id - Updating timetable:', {
      id,
      class_id,
      class_name,
      timeSlotsCount: time_slots?.length || 0
    });

    // Check if timetable exists and belongs to user's branch
    const existingTimetable = await pool.query(
      'SELECT * FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (existingTimetable.rows.length === 0) {
      console.log('⚠️ PUT /api/timetables/:id - Timetable not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    // Lookup class_name if missing but class_id provided (for new name if changing)
    let finalClassName = class_name;
    if (class_id && (!class_name || !class_name.trim())) {
      const classLookup = await pool.query(
        'SELECT class_name FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
        [class_id, req.user.branchId]
      );
      if (classLookup.rows.length > 0) {
        finalClassName = classLookup.rows[0].class_name;
      }
    }

    if (time_slots && (!Array.isArray(time_slots) || time_slots.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'time_slots must be a non-empty array'
      });
    }

    if (days && (!Array.isArray(days) || days.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'days must be a non-empty array'
      });
    }

    if (timetable_data && typeof timetable_data !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'timetable_data must be an object'
      });
    }

    // Checking for duplicates (excluding current one)
    if (class_id || class_name) {
      let duplicateCheck;
      if (class_id) {
        duplicateCheck = await pool.query(
          'SELECT id FROM branch.timetables_master WHERE class_id = $1 AND branch_id = $2::uuid AND id != $3',
          [class_id, req.user.branchId, id]
        );
      } else {
        duplicateCheck = await pool.query(
          'SELECT id FROM branch.timetables_master WHERE class_name = $1 AND branch_id = $2::uuid AND id != $3',
          [class_name, req.user.branchId, id]
        );
      }

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Another timetable for this class already exists'
        });
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (class_id) {
      updateFields.push(`class_id = $${paramIndex}`);
      updateValues.push(class_id);
      paramIndex++;
    }

    if (finalClassName) {
      updateFields.push(`class_name = $${paramIndex}`);
      updateValues.push(finalClassName);
      paramIndex++;
    }

    if (time_slots) {
      updateFields.push(`time_slots = $${paramIndex}`);
      updateValues.push(JSON.stringify(time_slots));
      paramIndex++;
    }

    if (days) {
      updateFields.push(`days = $${paramIndex}`);
      updateValues.push(JSON.stringify(days));
      paramIndex++;
    }

    if (timetable_data) {
      updateFields.push(`timetable_data = $${paramIndex}`);
      updateValues.push(JSON.stringify(timetable_data));
      paramIndex++;
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    const updateQuery = `
      UPDATE branch.timetables_master
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND branch_id = $${paramIndex + 1}
      RETURNING *
    `;

    updateValues.push(req.user.branchId);

    const result = await pool.query(updateQuery, updateValues);
    const updatedTimetable = result.rows[0];

    const response = {
      success: true,
      data: {
        id: updatedTimetable.id,
        class_name: updatedTimetable.class_name,
        time_slots: updatedTimetable.time_slots,
        days: updatedTimetable.days,
        timetable_data: updatedTimetable.timetable_data,
        academic_year: updatedTimetable.academic_year,
        updated_at: updatedTimetable.updated_at
      },
      message: 'Timetable updated successfully'
    };

    console.log('✅ PUT /api/timetables/:id - Success:', {
      timetableId: id,
      className: updatedTimetable.class_name
    });

    res.json(response);
  } catch (error) {
    console.error('❌ PUT /api/timetables/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update timetable'
    });
  }
});

// DELETE /api/timetables/:id - Delete complete timetable
router.delete('/timetables/:id', authenticateToken, async (req, res) => {
  console.log('🔥 DELETE /api/timetables/:id - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 DELETE /api/timetables/:id - Deleting timetable:', id);

    // Check if timetable exists and belongs to user's branch
    const existingTimetable = await pool.query(
      'SELECT class_name FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (existingTimetable.rows.length === 0) {
      console.log('⚠️ DELETE /api/timetables/:id - Timetable not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    const className = existingTimetable.rows[0].class_name;

    // Delete timetable
    const deleteResult = await pool.query(
      'DELETE FROM branch.timetables_master WHERE id = $1 AND branch_id = $2::uuid',
      [id, req.user.branchId]
    );

    if (deleteResult.rowCount === 0) {
      console.log('⚠️ DELETE /api/timetables/:id - No rows affected:', id);
      return res.status(404).json({
        success: false,
        error: 'Timetable not found'
      });
    }

    const response = {
      success: true,
      message: 'Timetable deleted successfully'
    };

    console.log('✅ DELETE /api/timetables/:id - Success:', {
      timetableId: id,
      className
    });

    res.json(response);
  } catch (error) {
    console.error('❌ DELETE /api/timetables/:id - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete timetable'
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

    // Add UUID validation to prevent "timetables" from being treated as ID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      console.log('⚠️ GET /api/classes/:id - Invalid UUID format:', id);
      return res.status(400).json({
        success: false,
        error: 'Invalid class ID format'
      });
    }

    const result = await pool.query(`
      SELECT
        c.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE c.id = $1 AND c.branch_id = $2::uuid
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
      'SELECT * FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
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
// router.delete('/:id', authenticateToken,  async (req, res) => {
//   console.log('🔥 DELETE /api/classes/:id - Incoming request:', {
//     headers: req.headers,
//     params: req.params,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     const { id } = req.params;
//     console.log('📋 DELETE /api/classes/:id - Deleting class:', id);

//     // Check if class exists and belongs to user's branch
//     const existingClass = await pool.query(
//       'SELECT * FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
//       [id, req.user.branchId]
//     );

//     if (existingClass.rows.length === 0) {
//       console.log('⚠️ DELETE /api/classes/:id - Class not found:', id);
//       return res.status(404).json({
//         success: false,
//         error: 'Class not found'
//       });
//     }

//     const classData = existingClass.rows[0];

//     // Check if class has students enrolled
//     const studentsCheck = await pool.query(
//       'SELECT COUNT(*) as count FROM public.students WHERE class_id = $1 AND status = $2',
//       [id, 'Active']
//     );

//     if (parseInt(studentsCheck.rows[0].count) > 0) {
//       console.log('⚠️ DELETE /api/classes/:id - Class has students:', id);
//       return res.status(400).json({
//         success: false,
//         error: 'Cannot delete class with enrolled students. Please move students to another class first.'
//       });
//     }

//     // Check if class has timetable entries
//     const timetableCheck = await pool.query(
//       'SELECT COUNT(*) as count FROM branch.timetables WHERE class_id = $1',
//       [id]
//     );

//     if (parseInt(timetableCheck.rows[0].count) > 0) {
//       console.log('⚠️ DELETE /api/classes/:id - Class has timetable entries:', id);
//       return res.status(400).json({
//         success: false,
//         error: 'Cannot delete class with timetable entries. Please delete timetable entries first.'
//       });
//     }

//     // Delete class
//     const deleteResult = await pool.query(
//       'DELETE FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
//       [id, req.user.branchId]
//     );

//     if (deleteResult.rowCount === 0) {
//       console.log('⚠️ DELETE /api/classes/:id - No rows affected:', id);
//       return res.status(404).json({
//         success: false,
//         error: 'Class not found'
//       });
//     }

//     const response = {
//       success: true,
//       message: 'Class deleted successfully'
//     };

//     console.log('✅ DELETE /api/classes/:id - Class deleted successfully:', {
//       classId: id,
//       className: classData.class_name
//     });

//     res.json(response);
//   } catch (error) {
//     console.error('❌ DELETE /api/classes/:id - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to delete class'
//     });
//   }
// });

// GET /api/classes/:id/timetable - Get class timetable

router.delete('/:id', authenticateToken, async (req, res) => {
  console.log('🔥 DELETE /api/classes/:id - Incoming request:', {
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;

    console.log('📋 Deleting class:', id);

    // 1️⃣ Check if class exists in this branch
    const existingClass = await pool.query(
      `SELECT * FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid`,
      [id, req.user.branchId]
    );

    if (existingClass.rows.length === 0) {
      console.log('⚠️ Class not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = existingClass.rows[0];

    // 2️⃣ Check if students are enrolled in this class
    const studentsCheck = await pool.query(
      `SELECT COUNT(*) AS count 
       FROM branch.students 
       WHERE class_id = $1 AND status = 'Active'`,
      [id]
    );

    if (parseInt(studentsCheck.rows[0].count) > 0) {
      console.log('⚠️ Class has active students:', id);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete class with enrolled students. Move students to another class first.'
      });
    }

    // 3️⃣ Check for timetable entries
    const timetableCheck = await pool.query(
      `SELECT COUNT(*) AS count 
       FROM branch.timetables 
       WHERE class_id = $1`,
      [id]
    );

    if (parseInt(timetableCheck.rows[0].count) > 0) {
      console.log('⚠️ Class has timetable entries:', id);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete class with timetable entries. Delete timetable entries first.'
      });
    }

    // 4️⃣ Delete class
    const deleteResult = await pool.query(
      `DELETE FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid`,
      [id, req.user.branchId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Class not found or not deleted'
      });
    }

    console.log('✅ Class deleted:', {
      classId: id,
      className: classData.class_name
    });

    return res.json({
      success: true,
      message: 'Class deleted successfully'
    });

  } catch (error) {
    console.error('❌ DELETE /api/classes/:id - Server error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete class',
      details: error.message
    });
  }
});

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
      'SELECT id FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
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
// router.post('/:id/timetable', authenticateToken, async (req, res) => {
//   console.log('🔥 POST /api/classes/:id/timetable - Incoming request:', {
//     headers: req.headers,
//     params: req.params,
//     body: req.body,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     const { id: classId } = req.params;
//     const { subject, teacher_id, day_of_week, start_time, end_time, room_number } = req.body;

//     console.log('📋 POST /api/classes/:id/timetable - Adding slot:', {
//       classId, subject, day_of_week, start_time, end_time, teacher_id
//     });

//     // Verify class belongs to user's branch
//     const classCheck = await pool.query(
//       'SELECT id, semester FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
//       [classId, req.user.branchId]
//     );

//     if (classCheck.rows.length === 0) {
//       console.log('⚠️ POST /api/classes/:id/timetable - Class not found:', classId);
//       return res.status(404).json({
//         success: false,
//         error: 'Class not found'
//       });
//     }

//     const classData = classCheck.rows[0];

//     // Validate required fields
//     if (!subject || !subject.trim()) {
//       return res.status(400).json({
//         success: false,
//         error: 'Subject is required'
//       });
//     }

//     if (!teacher_id) {
//       return res.status(400).json({
//         success: false,
//         error: 'Teacher is required'
//       });
//     }

//     if (!day_of_week || day_of_week < 1 || day_of_week > 7) {
//       return res.status(400).json({
//         success: false,
//         error: 'Valid day of week (1-7) is required'
//       });
//     }

//     if (!start_time || !end_time) {
//       return res.status(400).json({
//         success: false,
//         error: 'Start time and end time are required'
//       });
//     }

//     // Validate time format and logic
//     if (start_time >= end_time) {
//       return res.status(400).json({
//         success: false,
//         error: 'End time must be after start time'
//       });
//     }

//     // Validate teacher exists and is active
//     const teacherCheck = await pool.query(
//       'SELECT id FROM public.users WHERE id = $1 AND role = $2 AND status = $3 AND branch_id = $4',
//       [teacher_id, 'teacher', 'Active', req.user.branchId]
//     );

//     if (teacherCheck.rows.length === 0) {
//       console.log('⚠️ POST /api/classes/:id/timetable - Invalid teacher:', teacher_id);
//       return res.status(400).json({
//         success: false,
//         error: 'Invalid teacher assignment'
//       });
//     }

//     // Check for time conflicts in the same class
//     const conflictCheck = await pool.query(`
//       SELECT id FROM branch.timetables 
//       WHERE class_id = $1 
//       AND day_of_week = $2 
//       AND (
//         (start_time <= $3 AND end_time > $3) OR
//         (start_time < $4 AND end_time >= $4) OR
//         (start_time >= $3 AND end_time <= $4)
//       )
//     `, [classId, day_of_week, start_time, end_time]);

//     if (conflictCheck.rows.length > 0) {
//       console.log('⚠️ POST /api/classes/:id/timetable - Time conflict detected');
//       return res.status(409).json({
//         success: false,
//         error: 'Time conflict detected! This slot overlaps with an existing class.'
//       });
//     }

//     // Get current academic year from class
//     const currentYear = await pool.query(
//       'SELECT academic_year FROM branch.classes WHERE id = $1',
//       [classId]
//     );

//     const academicYear = currentYear.rows[0]?.academic_year || '2024-25';

//     // Insert timetable slot
//     const insertQuery = `
//       INSERT INTO branch.timetables (
//         branch_id, class_id, subject, teacher_id, 
//         day_of_week, start_time, end_time, room_number, 
//         academic_year, semester
//       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
//       RETURNING *
//     `;

//     const result = await pool.query(insertQuery, [
//       req.user.branchId,
//       classId,
//       subject,
//       teacher_id,
//       day_of_week,
//       start_time,
//       end_time,
//       room_number || null,
//       academicYear,
//       classData.semester
//     ]);

//     const newSlot = result.rows[0];

//     // Fetch teacher details
//     const teacherResult = await pool.query(
//       'SELECT name, email FROM public.users WHERE id = $1',
//       [teacher_id]
//     );

//     if (teacherResult.rows.length > 0) {
//       newSlot.teacher = teacherResult.rows[0];
//     }

//     const response = {
//       success: true,
//       data: newSlot,
//       message: 'Timetable slot added successfully'
//     };

//     console.log('✅ POST /api/classes/:id/timetable - Slot added:', {
//       slotId: newSlot.id,
//       classId,
//       subject,
//       teacher: teacherResult.rows[0]?.name || 'Unknown'
//     });

//     res.status(201).json(response);
//   } catch (error) {
//     console.error('❌ POST /api/classes/:id/timetable - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to add timetable slot'
//     });
//   }
// });

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
      WHERE t.id = $1 AND c.branch_id = $2::uuid
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
      FROM branch.timetables t
      JOIN branch.classes c ON t.class_id = c.id
      WHERE t.id = $1 AND c.branch_id = $2::uuid
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
      'DELETE FROM branch.timetables WHERE id = $1 AND branch_id = $2::uuid',
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
// router.get('/teachers/:teacherId/timetable', authenticateToken, async (req, res) => {
//   console.log('🔥 GET /api/classes/teachers/:teacherId/timetable - Incoming request:', {
//     headers: req.headers,
//     params: req.params,
//     user: req.user,
//     timestamp: new Date().toISOString()
//   });

//   try {
//     const { teacherId } = req.params;
//     console.log('📋 GET /api/classes/teachers/:teacherId/timetable - Teacher ID:', teacherId);

//     // Check access permissions:
//     // 1. Teacher can see their own timetable
//     // 2. Admin/Superadmin can see any teacher's timetable
//     // 3. Students/Parents cannot access teacher timetables

//     if (req.user.role === 'teacher' && req.user.userid !== teacherId) {
//       return res.status(403).json({
//         success: false,
//         error: 'Access denied. You can only view your own timetable.'
//       });
//     }

//     if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
//       return res.status(403).json({
//         success: false,
//         error: 'Access denied. Insufficient permissions.'
//       });
//     }

//     // Verify teacher exists and belongs to the branch (for non-teachers)
//     if (req.user.role !== 'teacher') {
//       // Check if teacherId is UUID format or userid
//       const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
//       let teacherCheck;

//       if (uuidRegex.test(teacherId)) {
//         // If it's a UUID, search by id
//         teacherCheck = await pool.query(`
//           SELECT id, name FROM public.users
//           WHERE id = $1 AND role = $2 AND branch_id = $3
//         `, [teacherId, 'teacher', req.user.branchId]);
//       } else {
//         // If it's a userid, search by userid
//         teacherCheck = await pool.query(`
//           SELECT id, name FROM public.users
//           WHERE userid = $1 AND role = $2 AND branch_id = $3
//         `, [teacherId, 'teacher', req.user.branchId]);
//       }

//       if (teacherCheck.rows.length === 0) {
//         console.log('⚠️ GET /api/classes/teachers/:teacherId/timetable - Teacher not found:', teacherId);
//         return res.status(404).json({
//           success: false,
//           error: 'Teacher not found'
//         });
//       }
//     }

//     // Get teacher's complete timetable with class details
//     const query = `
//       SELECT
//         t.*,
//         c.id as class_id,
//         c.class_name,
//         c.standard,
//         c.grade,
//         c.room_number,
//         u.name as teacher_name,
//         u.email as teacher_email,
//         -- Day names for better readability
//         CASE t.day_of_week
//           WHEN 1 THEN 'Monday'
//           WHEN 2 THEN 'Tuesday'
//           WHEN 3 THEN 'Wednesday'
//           WHEN 4 THEN 'Thursday'
//           WHEN 5 THEN 'Friday'
//           WHEN 6 THEN 'Saturday'
//           WHEN 7 THEN 'Sunday'
//         END as day_name
//       FROM branch.timetables t
//       JOIN branch.classes c ON t.class_id = c.id
//       LEFT JOIN public.users u ON t.teacher_id = u.id
//       WHERE t.teacher_id = $1
//         AND t.branch_id = $2::uuid
//         AND c.status = 'active'
//       ORDER BY t.day_of_week, t.start_time
//     `;

//     const result = await pool.query(query, [teacherId, req.user.branchId]);

//     // Group timetable by day for better organization
//     const timetableByDay = {};
//     result.rows.forEach(slot => {
//       const dayKey = slot.day_of_week;
//       if (!timetableByDay[dayKey]) {
//         timetableByDay[dayKey] = {
//           day_name: slot.day_name,
//           day_of_week: slot.day_of_week,
//           slots: []
//         };
//       }
//       timetableByDay[dayKey].slots.push({
//         id: slot.id,
//         subject: slot.subject,
//         start_time: slot.start_time,
//         end_time: slot.end_time,
//         room_number: slot.room_number,
//         class: {
//           id: slot.class_id,
//           class_name: slot.class_name,
//           standard: slot.standard,
//           grade: slot.grade
//         }
//       });
//     });

//     // Convert to array and sort by day
//     const organizedTimetable = Object.values(timetableByDay)
//       .sort((a, b) => a.day_of_week - b.day_of_week);

//     // Get teacher's basic info
//     const teacherInfo = await pool.query(`
//       SELECT
//         u.id,
//         u.name,
//         u.email,
//         u.phone,
//         t.department,
//         t.subjects
//       FROM public.users u
//       LEFT JOIN branch.teachers t ON u.id = t.user_id
//       WHERE u.id = $1 AND u.role = 'teacher'
//     `, [teacherId]);

//     const response = {
//       success: true,
//       data: {
//         teacher: teacherInfo.rows[0] || null,
//         timetable: organizedTimetable,
//         total_slots: result.rows.length,
//         teaching_days: organizedTimetable.length
//       }
//     };

//     console.log('✅ GET /api/classes/teachers/:teacherId/timetable - Success:', {
//       teacherId,
//       totalSlots: result.rows.length,
//       teachingDays: organizedTimetable.length
//     });

//     res.json(response);
//   } catch (error) {
//     console.error('❌ GET /api/classes/teachers/:teacherId/timetable - Server error:', error.message);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch teacher timetable'
//     });
//   }
// });
// Helper: Resolve teacher UUID from either userid or UUID
async function resolveTeacherUUID(inputId, branchId) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // If already UUID
  if (uuidRegex.test(inputId)) return inputId;

  // Otherwise treat as userid (BRANCHINGT001)
  const result = await pool.query(`
    SELECT id FROM public.users
    WHERE userid = $1 AND role = 'teacher' AND branch_id = $2::uuid
  `, [inputId, branchId]);

  return result.rows.length ? result.rows[0].id : null;
}



// ------------------------------------------------------------------
// 📌 FINAL ENDPOINT
// ------------------------------------------------------------------
// ---------------------------------------------------------------------
// Helper: Convert teacherId (UUID or userid) → UUID
// ---------------------------------------------------------------------
async function resolveTeacherId(inputId, branchId) {
  const uuidPattern = /^[0-9a-fA-F-]{36}$/;

  // If it's already UUID → return as-is
  if (uuidPattern.test(inputId)) {
    return inputId;
  }

  // Otherwise look up by userid
  const result = await pool.query(
    `SELECT id FROM public.users 
     WHERE userid = $1 AND role = 'teacher' AND branch_id = $2::uuid`,
    [inputId, branchId]
  );

  return result.rows.length ? result.rows[0].id : null;
}



// ---------------------------------------------------------------------
// ✔ FINAL ENDPOINT — Works with BOTH UUID and userid input
// ---------------------------------------------------------------------
router.get('/teachers/:teacherId/timetable', authenticateToken, async (req, res) => {
  console.log("🔥 GET /api/classes/teachers/:teacherId/timetable", {
    params: req.params,
    user: req.user
  });

  try {
    const branchId = req.user.branchId;
    let { teacherId } = req.params;

    // ---------------------------------------------------------------
    // Case 1: Teacher accessing THEIR OWN timetable
    // ---------------------------------------------------------------
    if (req.user.role === "teacher") {
      teacherId = req.user.userId;  // Force UUID from token
    }

    // ---------------------------------------------------------------
    // Convert incoming teacherId into UUID  
    // ---------------------------------------------------------------
    const teacherUUID = await resolveTeacherId(teacherId, branchId);

    if (!teacherUUID) {
      return res.status(404).json({
        success: false,
        error: "Teacher not found"
      });
    }

    // ---------------------------------------------------------------
    // Access control  
    // Teacher can only access their own timetable
    // ---------------------------------------------------------------
    if (req.user.role === "teacher" && req.user.userId !== teacherUUID) {
      return res.status(403).json({
        success: false,
        error: "Access denied. You can only view your own timetable."
      });
    }

    // Admin / superadmin can view any teacher’s timetable — allowed.


    // ---------------------------------------------------------------
    // Fetch timetable
    // ---------------------------------------------------------------
    const timetableQuery = `
      SELECT
        t.*,
        c.id AS class_id,
        c.class_name,
        c.standard,
        c.grade,
        c.room_number,
        u.name AS teacher_name,
        u.email AS teacher_email,
        CASE t.day_of_week
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday'
          WHEN 5 THEN 'Friday'
          WHEN 6 THEN 'Saturday'
        END AS day_name
      FROM branch.timetables t
      JOIN branch.classes c ON t.class_id = c.id
      LEFT JOIN public.users u ON t.teacher_id = u.id
      WHERE t.teacher_id = $1
        AND t.branch_id = $2::uuid
        AND c.status = 'Active'
      ORDER BY t.day_of_week, t.start_time
    `;

    const slots = await pool.query(timetableQuery, [teacherUUID, branchId]);

    // Group by day
    const grouped = {};
    slots.rows.forEach(slot => {
      if (!grouped[slot.day_of_week]) {
        grouped[slot.day_of_week] = {
          day_of_week: slot.day_of_week,
          day_name: slot.day_name,
          slots: []
        };
      }
      grouped[slot.day_of_week].slots.push({
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

    const timetable = Object.values(grouped)
      .sort((a, b) => a.day_of_week - b.day_of_week);

    // Teacher info
    const teacherInfo = await pool.query(`
      SELECT id, name, email, userid 
      FROM public.users 
      WHERE id = $1
    `, [teacherUUID]);

    res.json({
      success: true,
      data: {
        teacher: teacherInfo.rows[0],
        timetable,
        total_slots: slots.rows.length,
        teaching_days: timetable.length
      }
    });

  } catch (error) {
    console.error("❌ TIMETABLE ERROR:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch teacher timetable"
    });
  }
});

// GET /api/teachers/my-timetable
router.get('/teachers/my-timetable', authenticateToken, requireRole('teacher'), async (req, res) => {
  try {
    const teacherUuid = req.user.userId; // UUID from token
    const branchId = req.user.branchId;

    console.log('🔥 GET /api/teachers/my-timetable - teacherUuid:', teacherUuid);

    // Verify teacher exists
    const teacherCheck = await pool.query(
      `SELECT id, name, email, phone FROM public.users WHERE id = $1 AND role = 'teacher' AND branch_id = $2::uuid`,
      [teacherUuid, branchId]
    );
    if (teacherCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }
    const teacherInfo = teacherCheck.rows[0];

    // Fetch timetable (same query as above)
    const slotsRes = await pool.query(`
      SELECT
        t.id,
        t.day_of_week,
        t.start_time,
        t.end_time,
        t.subject,
        t.room_number,
        t.class_id,
        c.class_name,
        c.standard,
        c.grade,
        CASE t.day_of_week
          WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' WHEN 7 THEN 'Sunday'
        END as day_name
      FROM branch.timetables t
      JOIN branch.classes c ON t.class_id = c.id
      WHERE t.teacher_id = $1
        AND t.branch_id = $2::uuid
        AND LOWER(c.status) = 'active'
      ORDER BY t.day_of_week, t.start_time
    `, [teacherUuid, branchId]);

    const timetableByDay = {};
    slotsRes.rows.forEach(slot => {
      const dow = slot.day_of_week || 0;
      if (!timetableByDay[dow]) {
        timetableByDay[dow] = { day_of_week: dow, day_name: slot.day_name, slots: [] };
      }
      timetableByDay[dow].slots.push({
        id: slot.id,
        subject: slot.subject,
        start_time: slot.start_time,
        end_time: slot.end_time,
        room_number: slot.room_number,
        class: { id: slot.class_id, class_name: slot.class_name, standard: slot.standard, grade: slot.grade }
      });
    });

    const organized = Object.values(timetableByDay).sort((a, b) => a.day_of_week - b.day_of_week);

    res.json({
      success: true,
      data: {
        teacher: teacherInfo,
        timetable: organized,
        total_slots: slotsRes.rows.length,
        teaching_days: organized.length
      }
    });
  } catch (err) {
    console.error('❌ GET /teachers/my-timetable - Error', err);
    res.status(500).json({ success: false, error: 'Failed to fetch your timetable' });
  }
});


// GET /api/classes/:id/students - Get students in a class
router.get('/:id/students', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes/:id/students - Incoming request:', {
    headers: req.headers,
    params: req.params,
    user: req.user,
    timestamp: new Date().toISOString()
  });

  try {
    const { id } = req.params;
    console.log('📋 GET /api/classes/:id/students - Class ID:', id);

    // Verify class belongs to user's branch
    const classCheck = await pool.query(`
      SELECT
        c.*,
        u.name as teacher_name,
        u.email as teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE c.id = $1 AND c.branch_id = $2::uuid
    `, [id, req.user.branchId]);

    if (classCheck.rows.length === 0) {
      console.log('⚠️ GET /api/classes/:id/students - Class not found:', id);
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = classCheck.rows[0];

    // Access control: admin/superadmin can view any class, teacher can only view their own class
    if (req.user.role === 'teacher' && classData.teacher_id !== req.user.userId) {
      console.log('⚠️ GET /api/classes/:id/students - Access denied for teacher:', {
        teacherId: req.user.userId,
        classTeacherId: classData.teacher_id,
        classId: id
      });
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not the class teacher.'
      });
    }

    // Get students enrolled in this class
    const result = await pool.query(`
      SELECT
        s.student_id,
        s.roll_number,
        s.gender,
        s.phone,
        u.name,
        u.email
      FROM branch.students s
      LEFT JOIN public.users u ON s.user_id = u.id
      WHERE s.class_id = $1 AND lower(s.status) = 'active'
      ORDER BY u.name ASC
    `, [id]);

    // Format students for frontend
    const formattedStudents = result.rows.map(student => ({
      student_id: student.student_id,
      name: student.user_name || student.name,
      roll_number: student.roll_number,
      gender: student.gender,
      phone: student.user_phone || student.phone,
      email: student.email
    }));

    const response = {
      success: true,
      data: formattedStudents
    };

    console.log('✅ GET /api/classes/:id/students - Success:', {
      classId: id,
      className: classData.class_name,
      totalStudents: result.rows.length
    });

    res.json(response);
  } catch (error) {
    console.error('❌ GET /api/classes/:id/students - Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch class students'
    });
  }
});
router.get('/teachers/my-students', authenticateToken, async (req, res) => {
  try {
    const teacherUUID = req.user.userId;  // MUST BE UUID
    const branchId = req.user.branchId;

    console.log("Fetching students for teacher:", teacherUUID);

    // 1. Get class where this teacher is assigned
    const classResult = await pool.query(`
      SELECT *
      FROM branch.classes
      WHERE teacher_id = $1
        AND branch_id = $2::uuid
        AND LOWER(status) = 'active'
    `, [teacherUUID, branchId]);  // USING UUID NOW

    if (classResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No class assigned to this teacher"
      });
    }

    const classData = classResult.rows[0];

    // 2. Fetch students of that class
    const students = await pool.query(`
      SELECT s.*, u.name AS student_name, u.email AS student_email
      FROM branch.students s
      LEFT JOIN public.users u ON u.id = s.user_id
      WHERE s.class_id = $1 
        AND LOWER(s.status) = 'active'
      ORDER BY s.roll_number ASC
    `, [classData.id]);

    return res.json({
      success: true,
      data: {
        class: classData,
        students: students.rows
      }
    });

  } catch (err) {
    console.error("GET /teachers/my-students ERROR:", err);
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
    // THE ONLY CORRECT VALUE FOR DB QUERY
    const teacherUUID = req.user.userId;  // UUID ✔
    const branchId = req.user.branchId;

    console.log('📋 Fetching class for teacher UUID:', teacherUUID);

    const result = await pool.query(`
      SELECT
        c.*,
        u.name AS teacher_name,
        u.email AS teacher_email
      FROM branch.classes c
      LEFT JOIN public.users u ON c.teacher_id = u.id
      WHERE c.teacher_id = $1
        AND c.branch_id = $2::uuid
        AND c.status = 'Active'
    `, [teacherUUID, branchId]);  // FIX APPLIED ✔

    if (result.rows.length === 0) {
      console.log('⚠️ No class found for teacher UUID:', teacherUUID);
      return res.status(404).json({
        success: false,
        error: 'No class assigned to you as a class teacher'
      });
    }

    const classData = result.rows[0];

    // Get student count
    const studentCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM branch.students WHERE class_id = $1 AND status = $2',
      [classData.id, 'Active']
    );

    res.json({
      success: true,
      data: {
        class: classData,
        student_count: parseInt(studentCountResult.rows[0].count)
      }
    });

    console.log('✅ Class found:', {
      classId: classData.id,
      className: classData.class_name
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch your class details' });
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
        AND c.branch_id = $2::uuid
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
        AND c.branch_id = $2::uuid
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
        AND c.branch_id = $2::uuid
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
      'SELECT id, class_name, teacher_id, academic_year FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
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
      'SELECT id, class_name, teacher_id FROM branch.classes WHERE id = $1 AND branch_id = $2::uuid',
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
      WHERE a.id = $1 AND a.branch_id = $2::uuid
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
      WHERE a.attendance_date = $1 AND a.branch_id = $2::uuid
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
      WHERE a.attendance_date = $1 AND a.branch_id = $2::uuid
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

router.get('/:classId/students/:studentId/attendance', authenticateToken, async (req, res) => {
  console.log('🔥 GET /api/classes/:classId/students/:studentId/attendance', {
    params: req.params,
    query: req.query,
    user: req.user
  });

  try {
    const { classId, studentId } = req.params;
    const { start_date, end_date, status, limit = 50, offset = 0 } = req.query;

    /* 1️⃣ Verify class belongs to branch */
    const classCheck = await pool.query(
      `
        SELECT id, class_name, teacher_id
        FROM branch.classes
        WHERE id = $1 AND branch_id = $2::uuid
        `,
      [classId, req.user.branchId]
    );

    if (!classCheck.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    const classData = classCheck.rows[0];

    /* 2️⃣ Permission check (teacher only for own class) */
    if (
      req.user.role === 'teacher' &&
      classData.teacher_id !== req.user.userId
    ) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    /* 3️⃣ Verify student belongs to this class */
    const studentCheck = await pool.query(
      `
        SELECT s.id, s.roll_number, u.name
        FROM branch.students s
        LEFT JOIN public.users u ON s.user_id = u.id
        WHERE s.id = $1
          AND s.class_id = $2
          AND s.branch_id = $3::uuid
          AND s.status = 'Active'
        `,
      [studentId, classId, req.user.branchId]
    );

    if (!studentCheck.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'Student not found in this class'
      });
    }

    const student = studentCheck.rows[0];

    /* 4️⃣ Build attendance query */
    let query = `
        SELECT a.*
        FROM branch.attendance a
        WHERE a.class_id = $1
          AND a.student_id = $2
      `;

    const params = [classId, studentId];
    let idx = 3;

    if (start_date) {
      query += ` AND a.attendance_date >= $${idx}`;
      params.push(start_date);
      idx++;
    }

    if (end_date) {
      query += ` AND a.attendance_date <= $${idx}`;
      params.push(end_date);
      idx++;
    }

    if (status && ['Present', 'Absent', 'Late'].includes(status)) {
      query += ` AND a.status = $${idx}`;
      params.push(status);
      idx++;
    }

    query += ` ORDER BY a.attendance_date DESC`;
    query += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const attendanceRes = await pool.query(query, params);

    /* 5️⃣ Count total */
    let countQuery = `
        SELECT COUNT(*) AS total
        FROM branch.attendance a
        WHERE a.class_id = $1
          AND a.student_id = $2
      `;

    const countParams = [classId, studentId];
    let cidx = 3;

    if (start_date) {
      countQuery += ` AND a.attendance_date >= $${cidx}`;
      countParams.push(start_date);
      cidx++;
    }

    if (end_date) {
      countQuery += ` AND a.attendance_date <= $${cidx}`;
      countParams.push(end_date);
      cidx++;
    }

    if (status && ['Present', 'Absent', 'Late'].includes(status)) {
      countQuery += ` AND a.status = $${cidx}`;
      countParams.push(status);
      cidx++;
    }

    const countRes = await pool.query(countQuery, countParams);
    const total = parseInt(countRes.rows[0].total);

    /* 6️⃣ Final response */
    res.json({
      success: true,
      data: {
        class: {
          id: classData.id,
          class_name: classData.class_name
        },
        student: {
          id: student.id,
          roll_number: student.roll_number,
          name: student.name
        },
        attendance_records: attendanceRes.rows.map(r => ({
          id: r.id,
          attendance_date: r.attendance_date,
          status: r.status,
          subject: r.subject,
          remarks: r.remarks,
          marked_at: r.marked_at
        })),
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: total > (parseInt(offset) + parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('❌ Student attendance error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch student attendance'
    });
  }
}
);


// Import additional router with teacher notification endpoints
const additionalRouter = require('./router-additional');

// Mount additional routes (note: additionalRouter already includes /teachers/ in its paths)
router.use('/', additionalRouter);

module.exports = router;