/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // small Docker image
  serverExternalPackages: ["pg", "bcryptjs", "@react-pdf/renderer", "pdfkit"],
  // pdfkit loads its built-in fonts / data with dynamic requires the standalone tracer misses
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfkit/js/**", "./node_modules/@react-pdf/**", "./node_modules/fontkit/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" }, // photos uploaded before the move
      { protocol: "https", hostname: "cdn2.iconfinder.com" },
    ],
  },
};
export default nextConfig;
