// Deployment installs don't need local Git hooks or the Husky dev dependency.
if (process.env.NODE_ENV !== "production" && !process.env.CI && process.env.HUSKY !== "0") {
  const { default: husky } = await import("husky");
  const result = husky();
  if (result) throw new Error(result);
}
