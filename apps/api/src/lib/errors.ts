export class ClientInputError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}
