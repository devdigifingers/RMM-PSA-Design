/** @type {import('next').NextConfig} */
const meshOrigin = process.env.MESH_ORIGIN || "https://mesh.digitalfingers.co.za";
const sessionFrame = [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${meshOrigin}` }];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/devices/:id/file-manager", headers: sessionFrame },
      { source: "/devices/:id/file-transfer", headers: sessionFrame },
    ];
  },
};

export default nextConfig;
