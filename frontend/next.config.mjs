const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_PUBLIC_API_URL=/backend sends API calls through this app, so a phone on the
  // same Wi-Fi only needs to reach port 3000, and the browser never needs CORS.
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${backendUrl}/:path*` }];
  },
};

export default nextConfig;
