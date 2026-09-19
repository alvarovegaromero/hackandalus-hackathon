const config = {
  "*": ["secretlint", "prettier --write --ignore-unknown"],
  "*.{js,jsx,mjs,cjs,ts,tsx}": "eslint --max-warnings=0 --no-warn-ignored",
};

export default config;
