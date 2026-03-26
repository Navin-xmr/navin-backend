import 'dotenv/config';

process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';