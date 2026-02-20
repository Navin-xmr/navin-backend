// Setup file for Jest tests
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars!';
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/test';
