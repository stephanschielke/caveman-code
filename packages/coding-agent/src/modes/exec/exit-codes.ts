/**
 * WS16: cave exec exit codes.
 *
 * These are stable — CI scripts may rely on them. Do not renumber.
 */

/** Successful execution. */
export const EXIT_SUCCESS = 0;

/** Generic / unclassified error. */
export const EXIT_GENERIC_ERROR = 1;

/** --output-schema validation failed: final assistant message does not match the schema. */
export const EXIT_SCHEMA_VALIDATION_FAILED = 2;

/** Sandbox denied a tool call. */
export const EXIT_SANDBOX_DENIED = 3;

/** Model error (API error, context-length exceeded, etc.). */
export const EXIT_MODEL_ERROR = 4;

/** Execution timed out (CAVE_EXEC_TIMEOUT_MS / --timeout). */
export const EXIT_TIMEOUT = 5;

/** User-config error (bad settings file, bad --profile name, etc.). */
export const EXIT_USER_CONFIG_ERROR = 6;

/**
 * Classify a thrown error into an exit code.
 * Falls back to EXIT_GENERIC_ERROR for unknown errors.
 */
export function classifyError(err: unknown): number {
	if (err instanceof ExecTimeoutError) return EXIT_TIMEOUT;
	if (err instanceof ExecSandboxDeniedError) return EXIT_SANDBOX_DENIED;
	if (err instanceof ExecModelError) return EXIT_MODEL_ERROR;
	if (err instanceof ExecUserConfigError) return EXIT_USER_CONFIG_ERROR;
	return EXIT_GENERIC_ERROR;
}

// ---------------------------------------------------------------------------
// Typed error classes used by exec-mode internals.
// ---------------------------------------------------------------------------

export class ExecTimeoutError extends Error {
	constructor(ms: number) {
		super(`cave exec timed out after ${ms}ms`);
		this.name = "ExecTimeoutError";
	}
}

export class ExecSandboxDeniedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExecSandboxDeniedError";
	}
}

export class ExecModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExecModelError";
	}
}

export class ExecUserConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExecUserConfigError";
	}
}
