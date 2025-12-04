/**
 * WebSocket Client for Student Notifications
 * 
 * Students use this to connect and receive real-time notifications from teachers
 * 
 * Usage:
 * const client = new NotificationClient('ws://localhost:8004/ws');
 * client.connect('student-uuid-here');
 */

class NotificationClient {
  constructor(websocketUrl, options = {}) {
    this.websocketUrl = websocketUrl;
    this.studentId = null;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectInterval = options.reconnectInterval || 3000; // 3 seconds
    this.isConnected = false;
    this.onNotification = options.onNotification || console.log;
    this.onConnection = options.onConnection || console.log;
    this.onDisconnect = options.onDisconnect || console.log;
    this.onError = options.onError || console.error;
  }

  /**
   * Connect to WebSocket server and register as student
   */
  connect(studentId) {
    if (!studentId) {
      throw new Error('Student ID is required');
    }

    this.studentId = studentId;
    console.log(`🔌 Connecting to ${this.websocketUrl} as student ${studentId}...`);

    try {
      this.ws = new WebSocket(this.websocketUrl);

      this.ws.onopen = (event) => {
        console.log('✅ WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Register as student
        this.send({
          type: 'register',
          studentId: this.studentId
        });

        this.onConnection(event);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Received message:', data);

          switch (data.type) {
            case 'connected':
              console.log(`✅ Registered as student ${data.studentId}`);
              break;
            case 'notification':
              this.handleNotification(data);
              break;
            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        this.onDisconnect(event);

        // Auto-reconnect
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        this.onError(error);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.onError(error);
    }
  }

  /**
   * Handle incoming notification
   */
  handleNotification(data) {
    console.log('🔔 NEW NOTIFICATION RECEIVED!');
    console.log('📱 Title:', data.data.title);
    console.log('📝 Content:', data.data.content);
    console.log('⚡ Priority:', data.data.priority);
    console.log('👨‍🏫 From:', data.data.teacher_name);
    console.log('🕒 Time:', new Date(data.data.publish_date).toLocaleString());

    // Call custom notification handler
    this.onNotification(data);
  }

  /**
   * Send message to server
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('⚠️ WebSocket not connected, message not sent');
    }
  }

  /**
   * Attempt to reconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        if (this.studentId) {
          this.connect(this.studentId);
        }
      }, this.reconnectInterval);
    } else {
      console.error('❌ Max reconnection attempts reached');
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      studentId: this.studentId,
      websocketUrl: this.websocketUrl,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Example usage for Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationClient;
}

// Example usage (Node.js)
if (typeof window === 'undefined') {
  const WebSocket = require('ws');
  global.WebSocket = WebSocket;

  // Example student connection
  const client = new NotificationClient('ws://localhost:8004/ws', {
    onNotification: (data) => {
      console.log('🔔 You have a new notification from your teacher!');
      console.log('📋 Notification Details:', data.data);
    },
    onConnection: () => {
      console.log('📱 Successfully connected to notification service');
    },
    onDisconnect: () => {
      console.log('📴 Disconnected from notification service');
    },
    onError: (error) => {
      console.error('❌ Connection error:', error);
    }
  });

  // Simulate student connection
  console.log('🧪 Starting WebSocket Client Test...');
  console.log('📝 This simulates a student connecting to receive notifications');
  
  // Uncomment to test:
  // client.connect('student-uuid-12345');
}

// Example usage for browsers
if (typeof window !== 'undefined') {
  window.NotificationClient = NotificationClient;
  
  // Browser usage example:
  /*
  const client = new NotificationClient('ws://localhost:8004/ws', {
    onNotification: (data) => {
      // Show browser notification
      if (Notification.permission === 'granted') {
        new Notification(`New Notification from ${data.data.teacher_name}`, {
          body: data.data.title,
          icon: '/notification-icon.png'
        });
      }
      
      // Update UI
      document.getElementById('notifications').insertAdjacentHTML('beforeend', `
        <div class="notification ${data.data.priority.toLowerCase()}">
          <h4>${data.data.title}</h4>
          <p>${data.data.content}</p>
          <small>From ${data.data.teacher_name} - ${new Date(data.data.publish_date).toLocaleString()}</small>
        </div>
      `);
    }
  });
  
  // Request notification permission and connect
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      client.connect('student-uuid-here');
    }
  });
  */
}