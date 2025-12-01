# ClassesService - Node.js API Setup Guide

## 📋 Environment Configuration

The `.env` file has been updated with the required variables for PostgreSQL database connection:

### **Database Configuration**
```env
DB_HOST=localhost              # Your PostgreSQL server host
DB_PORT=5432                   # PostgreSQL port (default: 5432)
DB_NAME=school_management      # Your database name
DB_USER=postgres               # Database username
DB_PASSWORD=your_password_here # Database password
```

### **Authentication Configuration**
```env
JWT_SECRET=your_jwt_secret_key_here  # JWT signing secret (should be a long, random string)
```

### **Service Configuration**
```env
PORT=3004                      # Port for ClassesService
NODE_ENV=development           # Environment (development/production)
```

## 🚀 Setup Instructions

### **1. Database Setup**

Update the `.env` file with your actual database credentials:

```env
# Replace these values with your actual database settings
DB_HOST=localhost              # Your PostgreSQL server address
DB_PORT=5432                   # Your PostgreSQL port
DB_NAME=school_management      # Your actual database name
DB_USER=postgres               # Your database username
DB_PASSWORD=your_actual_password  # Your actual database password
```

### **2. JWT Secret Setup**

Generate a secure JWT secret:
```bash
# Generate a random JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Update your `.env` file:
```env
JWT_SECRET=your_generated_jwt_secret_here
```

### **3. Install Dependencies**

```bash
cd backend/ClassesService
npm install
```

### **4. Start the Service**

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The service will be available at `http://localhost:3004`

## 🔗 API Endpoints Reference

### **Classes Management**
- `GET /api/classes` - List all classes
- `POST /api/classes` - Create new class
- `GET /api/classes/:id` - Get class details
- `PUT /api/classes/:id` - Update class
- `DELETE /api/classes/:id` - Delete class

### **Timetable Management**
- `GET /api/classes/:id/timetable` - Get class timetable
- `POST /api/classes/:id/timetable` - Add timetable slot
- `PUT /api/timetable/:id` - Update timetable slot
- `DELETE /api/timetable/:id` - Delete timetable slot

### **Advanced Features**
- `POST /api/classes/bulk-create` - Bulk create classes for new academic year
- `GET /api/teachers/available` - Get available teachers

## 🔐 Authentication

All endpoints require JWT authentication:

```bash
# Include in request headers
Authorization: Bearer <your_jwt_token>
Content-Type: application/json
```

## 📊 Frontend Integration Example

```javascript
// Replace Supabase calls with API calls
const fetchClasses = async () => {
  try {
    const authToken = localStorage.getItem('authToken');
    
    const response = await fetch('http://localhost:3004/api/classes', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    
    if (result.success) {
      setClasses(result.data);
    } else {
      console.error('Failed to fetch classes:', result.error);
    }
  } catch (error) {
    console.error('Error fetching classes:', error);
  }
};
```

## 🗄️ Database Schema Requirements

Your PostgreSQL database should have these tables:

### **classes table**
```sql
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  class_name VARCHAR(255) NOT NULL,
  grade VARCHAR(100),
  standard VARCHAR(50) NOT NULL,
  teacher_id UUID REFERENCES users(id),
  semester VARCHAR(100) DEFAULT 'First Semester',
  capacity INTEGER DEFAULT 30,
  room_number VARCHAR(50),
  schedule TEXT,
  academic_year VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### **timetables table**
```sql
CREATE TABLE timetables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  class_id UUID NOT NULL REFERENCES classes(id),
  subject VARCHAR(255) NOT NULL,
  teacher_id UUID NOT NULL REFERENCES users(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 1 AND day_of_week <= 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room_number VARCHAR(50),
  academic_year VARCHAR(50) NOT NULL,
  semester VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### **users table** (for teacher references)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  userid VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## 🔧 Troubleshooting

### **Database Connection Issues**
- Verify database credentials in `.env`
- Ensure PostgreSQL service is running
- Check firewall settings for database port
- Verify database exists and user has permissions

### **Authentication Issues**
- Ensure JWT_SECRET is properly configured
- Verify auth tokens are being passed correctly
- Check token expiration settings

### **Common Errors**
```
Error: getaddrinfo ENOTFOUND
```
- Issue: Cannot connect to database host
- Fix: Check DB_HOST value in `.env`

```
Error: password authentication failed
```
- Issue: Invalid database credentials
- Fix: Verify DB_USER and DB_PASSWORD

```
Error: Invalid or expired token
```
- Issue: JWT authentication failed
- Fix: Check JWT_SECRET and token validity

## 📈 Performance Tips

1. **Connection Pooling**: Already implemented in `config/database.js`
2. **Pagination**: Use `limit` and `offset` parameters
3. **Indexing**: Add indexes on frequently queried columns
4. **Caching**: Consider Redis for frequently accessed data

## 🚀 Next Steps

1. **Update Environment Variables**: Set up your actual database and JWT credentials
2. **Test Endpoints**: Use Postman or similar tool to test APIs
3. **Frontend Integration**: Update React components to use new API
4. **Deploy**: Set up as production service with proper environment variables

The ClassesService is now ready to replace your Supabase-based Classes functionality with a robust, scalable Node.js implementation!