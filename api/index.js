// Vercel Serverless Function entrypoint
// Routes all /api/* requests to the Express backend application
const app = require('../Backend/server');

module.exports = app;
