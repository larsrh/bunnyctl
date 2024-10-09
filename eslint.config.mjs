// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default tseslint.config({
    files: ["src/**/*.ts"],
    extends: [
        eslint.configs.recommended,
        ...tseslint.configs.recommendedTypeChecked,
        eslintPluginPrettierRecommended
    ],
    languageOptions: {
        parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname
        }
    }
});