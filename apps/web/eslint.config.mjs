import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { sharedTypeScriptRules } from "../../eslint.config.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: sharedTypeScriptRules,
  },
  globalIgnores([".next/**", "out/**", "build/**", "eslint.config.mjs", "next-env.d.ts"]),
]);
