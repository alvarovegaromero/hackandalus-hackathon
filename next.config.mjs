/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permite levantar una segunda instancia sin que pelee por el directorio de
  // compilación de otra que ya esté corriendo:
  //   NEXT_DIST_DIR=.next-dev npm run dev -- -p 3001
  distDir: process.env.NEXT_DIST_DIR || ".next"
};

export default nextConfig;
