const config = {
  "*": ["secretlint --no-glob --no-gitignore", "prettier --write --ignore-unknown"],
  "*.{js,jsx,mjs,cjs,ts,tsx}": "eslint --max-warnings=0"
};

export default config;
