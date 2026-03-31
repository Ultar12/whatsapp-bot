/**
 * Centralized Authentication & Configuration
 * Single place to manage all passwords and authentication logic
 */

class AuthService {
  constructor() {
    this.adminPassword = process.env.ADMIN_PASSWORD;
    this.minPasswordLength = 8;
    this.publicEndpoints = [
      '/health',
      '/webhook/incoming-message',
      '/api/updates',
      '/api/updates/*',
      '/qr-code',
    ];

    // Validate password on startup
    this.validatePassword();
  }

  /**
   * Validate password meets minimum security requirements
   */
  validatePassword() {
    if (!this.adminPassword) {
      console.warn('⚠️  WARNING: ADMIN_PASSWORD is not set in .env file');
      console.warn('Please set ADMIN_PASSWORD with at least 8 characters');
      return;
    }

    if (this.adminPassword.length < this.minPasswordLength) {
      console.error(`❌ ERROR: ADMIN_PASSWORD must be at least ${this.minPasswordLength} characters long`);
      console.error(`Current length: ${this.adminPassword.length} characters`);
      console.error('Please update your .env file with a stronger password');
      process.exit(1);
    }

    console.log(`✅ Password validation passed (${this.adminPassword.length} characters)`);
  }

  /**
   * Verify admin authentication token
   */
  verifyAdminToken(token) {
    if (!token) return false;
    return token === this.adminPassword;
  }

  /**
   * Extract token from Authorization header
   */
  extractToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.split(' ')[1];
  }

  /**
   * Check if endpoint requires authentication
   */
  isPublicEndpoint(path) {
    return this.publicEndpoints.some(endpoint => {
      // Handle wildcards
      if (endpoint.includes('*')) {
        const regex = endpoint.replace(/\*/g, '.*');
        return new RegExp(`^${regex}`).test(path);
      }
      return path === endpoint;
    });
  }

  /**
   * Middleware for Express - verify admin token
   */
  adminAuthMiddleware() {
    return (req, res, next) => {
      // Check if endpoint is public
      if (this.isPublicEndpoint(req.path)) {
        return next();
      }

      const authHeader = req.headers.authorization;
      const token = this.extractToken(authHeader);

      if (!token || !this.verifyAdminToken(token)) {
        return res.status(401).json({ error: 'Unauthorized - Invalid or missing token' });
      }

      next();
    };
  }

  /**
   * Middleware for Express - check token without failing (optional auth)
   */
  optionalAuthMiddleware() {
    return (req, res, next) => {
      const authHeader = req.headers.authorization;
      const token = this.extractToken(authHeader);

      if (token && this.verifyAdminToken(token)) {
        req.isAuthenticated = true;
      } else {
        req.isAuthenticated = false;
      }

      next();
    };
  }
}

module.exports = new AuthService();
