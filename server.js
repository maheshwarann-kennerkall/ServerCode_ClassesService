const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const router = require('./router');
const http = require('http');
const WebSocket = require('ws');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8004;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws' });

// Store active WebSocket connections by student ID
const activeConnections = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('🔌 New WebSocket connection established');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle student registration
      if (data.type === 'register' && data.studentId) {
        activeConnections.set(data.studentId, ws);
        ws.studentId = data.studentId;
        
        console.log(`📱 Student ${data.studentId} connected via WebSocket`);
        
        // Send confirmation
        ws.send(JSON.stringify({
          type: 'connected',
          studentId: data.studentId,
          timestamp: new Date().toISOString()
        }));
      }
      
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    if (ws.studentId) {
      activeConnections.delete(ws.studentId);
      console.log(`📱 Student ${ws.studentId} disconnected from WebSocket`);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Function to broadcast notification to specific student
function broadcastNotificationToStudent(studentId, notification) {
  const ws = activeConnections.get(studentId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'notification',
      data: notification,
      timestamp: new Date().toISOString()
    }));
    console.log(`📨 Notification sent to student ${studentId} via WebSocket`);
    return true;
  }
  return false;
}

// Function to broadcast notification to multiple students
function broadcastNotificationToStudents(studentIds, notification) {
  const sentCount = studentIds.filter(studentId =>
    broadcastNotificationToStudent(studentId, notification)
  ).length;
  
  console.log(`📨 Notification broadcasted to ${sentCount}/${studentIds.length} students`);
  return sentCount;
}

// Make broadcast functions available to routers
app.set('broadcastNotificationToStudent', broadcastNotificationToStudent);
app.set('broadcastNotificationToStudents', broadcastNotificationToStudents);
app.set('activeConnections', activeConnections);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/classes', router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ClassesService',
    port: PORT,
    websocketConnections: activeConnections.size
  });
});

// WebSocket status endpoint
app.get('/ws/status', (req, res) => {
  res.json({
    activeConnections: activeConnections.size,
    connectedStudents: Array.from(activeConnections.keys())
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

server.listen(PORT, () => {
  console.log(`🚀 ClassesService running on port ${PORT}`);
  console.log(`🔌 WebSocket server available at ws://localhost:${PORT}/ws`);
});

module.exports = { app, server, broadcastNotificationToStudent, broadcastNotificationToStudents };