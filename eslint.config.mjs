import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export const sharedTypeScriptRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { disallowTypeAnnotations: false, fixStyle: "inline-type-imports" },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/*.config.*",
      "!playwright.config.ts",
      "**/next-env.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: sharedTypeScriptRules,
  },
  {
    files: ["**/test/**/*.ts", "**/test/**/*.tsx", "e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.tests.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
