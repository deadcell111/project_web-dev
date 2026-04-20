const target = process.env.BACKEND_ORIGIN || 'http://localhost:8000';

module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
  },
};
