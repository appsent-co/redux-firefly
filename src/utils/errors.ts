/**
 * Base error class for all Firefly errors
 */
export class FireflyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'FireflyError';

    // Maintain proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FireflyError);
    }
  }
}

/**
 * Error thrown when a database operation fails
 */
export class DatabaseOperationError extends FireflyError {
  constructor(operation: string, originalError: Error) {
    super(
      `Database ${operation} operation failed: ${originalError.message}`,
      'DB_OPERATION_ERROR',
      originalError
    );
    this.name = 'DatabaseOperationError';
  }
}

/**
 * Error thrown when hydration fails
 */
export class HydrationError extends FireflyError {
  constructor(sliceName: string, originalError: Error) {
    super(
      `Failed to hydrate slice "${sliceName}": ${originalError.message}`,
      'HYDRATION_ERROR',
      originalError
    );
    this.name = 'HydrationError';
  }
}
