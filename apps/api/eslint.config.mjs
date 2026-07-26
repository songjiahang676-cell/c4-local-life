import sharedConfig from "../../eslint.config.mjs";

export default [
  ...sharedConfig,
  {
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
    },
  },
];
