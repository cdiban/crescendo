const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const driverError = (err as { driverError?: { code?: string; constraint?: string } }).driverError;
  return driverError?.code === UNIQUE_VIOLATION && (constraint === undefined || driverError.constraint === constraint);
}
