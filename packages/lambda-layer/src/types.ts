export interface BusinessLogicInterface {
  body: string;
  traceCarrier: Record<string, string>;
  requestId: string;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
