/**
 * Standardized API response wrapper.
 * Ensures consistent response shape across all endpoints.
 */
class ApiResponse {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {*}      data       - Response payload
   * @param {string} message    - Success message
   */
  constructor(statusCode, data = null, message = 'Success') {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }

  // ─── Factory Methods ──────────────────────────────

  static ok(data, message = 'Success') {
    return new ApiResponse(200, data, message);
  }

  static success(data, message = 'Success') {
    return new ApiResponse(200, data, message);
  }

  static created(data, message = 'Resource created successfully') {
    return new ApiResponse(201, data, message);
  }

  static noContent(message = 'No content') {
    return new ApiResponse(204, null, message);
  }
}

module.exports = ApiResponse;
