const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const router = require('./router');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8004;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/classes', router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ClassesService', port: PORT });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 ClassesService running on port ${PORT}`);
});

module.exports = app;