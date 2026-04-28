/**
 * WS14: `/recipe` slash command for interactive mode.
 *
 * Usage inside an interactive session:
 *   /recipe <name> [key=value ...]
 *   /recipe list
 *   /recipe help
 *
 * The slash command resolves and runs the recipe within the current session
 * context. The recipe's goal (with inputs substituted) is injected as the
 * next user message so the running agent processes it naturally.
 */

import { listAvailableRecipes, resolveRecipeByName, substituteInputs } from "../recipes/loader.js";
import { type Recipe, RecipeValidationError } from "../recipes/schema.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RecipeSlashCommandResult {
	exitCode: number;
	output: string;
	/** When set, the caller should inject this as the next agent message. */
	goal?: string;
	/** The resolved recipe, available for further inspection by the host. */
	recipe?: Recipe;
}

export interface RecipeSlashCommandIO {
	cwd: string;
	/** Extra search directories (for testing). */
	extraDirs?: string[];
}

export const RECIPE_SLASH_COMMAND = {
	name: "recipe",
	description: "Run a YAML recipe in the current session. Usage: /recipe <name> [key=value ...]",
} as const;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParsedRecipeSlash {
	verb: "run" | "list" | "help";
	name?: string;
	inputs: Record<string, string>;
}

/**
 * Parse the raw slash command text (everything after "/recipe").
 */
export function parseRecipeSlash(raw: string): ParsedRecipeSlash {
	const parts = raw
		.trim()
		.replace(/^\/recipe\s*/, "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (parts.length === 0 || parts[0] === "help" || parts[0] === "--help") {
		return { verb: "help", inputs: {} };
	}
	if (parts[0] === "list" || parts[0] === "--list") {
		return { verb: "list", inputs: {} };
	}

	const name = parts[0];
	const inputs: Record<string, string> = {};
	for (let i = 1; i < parts.length; i++) {
		const kv = parts[i];
		const eqIdx = kv.indexOf("=");
		if (eqIdx !== -1) {
			inputs[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
		}
	}
	return { verb: "run", name, inputs };
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

function helpText(): string {
	return [
		"cave /recipe — run a Goose-style YAML recipe in the current session",
		"",
		"Usage:",
		"  /recipe <name> [key=value ...]   Run a recipe (inputs as key=value pairs)",
		"  /recipe list                     List all available recipes",
		"  /recipe help                     Show this help",
		"",
		"Examples:",
		"  /recipe migrate-to-biome",
		"  /recipe add-tests target=src/utils/parser.ts",
		"  /recipe release release_type=minor",
		"",
		"Resolution order: .cave/recipes/ → ~/.cave/recipes/ → bundled defaults",
	].join("\n");
}

function listRecipes(io: RecipeSlashCommandIO): RecipeSlashCommandResult {
	const recipes = listAvailableRecipes(io.cwd, io.extraDirs);
	if (recipes.length === 0) {
		return {
			exitCode: 0,
			output: [
				"No recipes found.",
				"Add .yaml files to .cave/recipes/ or ~/.cave/recipes/",
				"or use one of the bundled defaults (see /recipe list after install).",
			].join("\n"),
		};
	}
	const lines = ["Available recipes:", ""];
	for (const r of recipes) {
		const scope = r.filePath.includes(`${io.cwd}/`) ? "project" : "user/bundled";
		lines.push(`  ${r.name}  (${scope})`);
		lines.push(`    ${r.filePath}`);
	}
	return { exitCode: 0, output: lines.join("\n") };
}

/**
 * Main slash command handler.
 * Returns a result with optional `goal` that the interactive mode host
 * should submit as the next agent message.
 */
export async function runRecipeSlashCommand(args: string, io: RecipeSlashCommandIO): Promise<RecipeSlashCommandResult> {
	const parsed = parseRecipeSlash(args);

	switch (parsed.verb) {
		case "help":
			return { exitCode: 0, output: helpText() };

		case "list":
			return listRecipes(io);

		case "run": {
			const name = parsed.name!;
			let loaded: ReturnType<typeof resolveRecipeByName>;
			try {
				loaded = resolveRecipeByName(name, io.cwd, io.extraDirs);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { exitCode: 1, output: `Error loading recipe: ${msg}` };
			}

			if (!loaded) {
				return {
					exitCode: 1,
					output: [
						`Recipe "${name}" not found.`,
						"Searched: .cave/recipes/, ~/.cave/recipes/, bundled defaults.",
						"Use /recipe list to see all available recipes.",
					].join("\n"),
				};
			}

			let goal: string;
			try {
				goal = substituteInputs(loaded.recipe, parsed.inputs);
			} catch (err) {
				if (err instanceof RecipeValidationError) {
					return {
						exitCode: 1,
						output: `Recipe input error: ${err.message}`,
					};
				}
				throw err;
			}

			const preview = goal.length > 200 ? `${goal.slice(0, 200)}…` : goal;
			return {
				exitCode: 0,
				output: `Running recipe "${name}":\n${preview}`,
				goal,
				recipe: loaded.recipe,
			};
		}
	}
}
