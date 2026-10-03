export type ProblemCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INSUFFICIENT_POSITION'
  | 'CURRENCY_MISMATCH'
  | 'ACCOUNT_ARCHIVED'
  | 'AUTOMATIC_MOVEMENT'
  | 'NO_POSITION_FOR_DIVIDEND'
  | 'INVALID_STATE'
  | 'INTERNAL_ERROR';

export type FieldError = { field: string; message: string };

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Content Too Large',
  422: 'Unprocessable Content',
  500: 'Internal Server Error',
};

/** Error que ya sabe cómo responderse como RFC 9457 problem+json. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  /** Cabeceras propias del error (p. ej. Allow en un 405). */
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ProblemCode,
    detail?: string,
    errors?: FieldError[],
    headers: Record<string, string> = {},
  ) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = errors;
    this.headers = headers;
  }

  toProblem(): Record<string, unknown> {
    return {
      type: 'about:blank',
      title: TITLES[this.status] ?? 'Error',
      status: this.status,
      code: this.code,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(this.errors === undefined ? {} : { errors: this.errors }),
    };
  }
}
