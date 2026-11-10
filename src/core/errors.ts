/** An expected, user-facing error. `key` is a translation key in messages/*.json ("errors.*"). */
export class UserError extends Error {
  constructor(
    public readonly key: string,
    public readonly values: Record<string, string | number> = {},
  ) {
    super(key);
    this.name = "UserError";
  }
}

export class ForbiddenError extends UserError {
  constructor(permission?: string) {
    super("errors.forbidden", permission ? { permission } : {});
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends UserError {
  constructor() {
    super("errors.unauthenticated");
    this.name = "UnauthenticatedError";
  }
}
