/** @type {import('next').NextConfig} */
const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";
const sessionFrame = [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${meshOrigin}` }];
const consoleFrame = [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }];
const everywhere = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: everywhere },
      { source: "/((?!devices/[^/]+/file-(?:manager|transfer)).*)", headers: consoleFrame },
      { source: "/devices/:id/file-manager", headers: sessionFrame },
      { source: "/devices/:id/file-transfer", headers: sessionFrame },
    ];
  },
};

export default nextConfig;
