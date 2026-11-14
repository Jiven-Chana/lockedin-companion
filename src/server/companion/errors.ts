/** Typed failures the companion routes map to HTTP responses (http.ts). */
export class CompanionError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		message?: string,
		readonly detail?: unknown,
	) {
		super(message ?? code);
		this.name = "CompanionError";
	}
}

export const notFound = (what: string) => new CompanionError(`${what}_not_found`, 404, `${what} not found`);
export const badRequest = (message: string, detail?: unknown) => new CompanionError("bad_request", 400, message, detail);
export const conflict = (code: string, message?: string) => new CompanionError(code, 409, message ?? code);

/** An engine could not do what was asked (no models, timeout, protocol error). */
export class EngineError extends CompanionError {
	constructor(code: string, message?: string, status = 502) {
		super(code, status, message ?? code);
		this.name = "EngineError";
	}
}
