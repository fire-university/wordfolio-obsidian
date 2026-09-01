// 官方社群目錄的自動審查用的就是這一套規則(eslint-plugin-obsidianmd)。
// 裝在本機是為了**送審前自己驗**——2026-09-01 第一次送審被兩個 Error 擋下,
// 就是因為我只照文件上的人工清單自檢,沒跑這套。
//
//   npm run lint
//
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["main.js", "dict/**", "vendor/**", "test/fixtures/**", "node_modules/**"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
		},
	}
);
