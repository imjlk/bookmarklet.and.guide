const project = {
  name: "BMKL",
  cli: "bmkl",
  version: "0.1.0",
  runtime: "Cloudflare Pages advanced mode",
  packages: [
    "create-bmkl",
    "@bmkl/core",
    "@bmkl/contracts",
    "@bmkl/runtime",
    "@bmkl/templates",
    "@bmkl/vite",
    "@bmkl/cli",
  ],
};

const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const htmlContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(request, url.pathname.startsWith("/api"));
      }

      if (url.pathname === "/api/project") {
        return jsonResponse(
          {
            ...project,
            siteName: env.BMKL_SITE_NAME ?? project.name,
          },
          request,
          {
            headers: {
              Allow: "GET, HEAD",
              "Cache-Control":
                "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
            },
          },
        );
      }

      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return jsonResponse(
          { error: "Not Found" },
          request,
          {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      let response = await env.ASSETS.fetch(request);
      if (response.status === 404 && acceptsHtml(request)) {
        response = await env.ASSETS.fetch(
          new Request(new URL("/", request.url), request),
        );
      }

      return withResponseHeaders(response);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          method: request.method,
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return jsonResponse(
        { error: "Internal Server Error" },
        request,
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  },
};

function acceptsHtml(request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

function methodNotAllowed(request, json) {
  const headers = {
    Allow: "GET, HEAD",
    "Cache-Control": "no-store",
  };

  if (json) {
    return jsonResponse(
      { error: "Method Not Allowed" },
      request,
      { status: 405, headers },
    );
  }

  return withResponseHeaders(
    new Response("Method Not Allowed", {
      status: 405,
      headers: {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
      },
    }),
  );
}

function jsonResponse(payload, request, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Robots-Tag", "noindex");

  return withResponseHeaders(
    new Response(request.method === "HEAD" ? null : JSON.stringify(payload), {
      ...init,
      headers,
    }),
  );
}

function withResponseHeaders(response) {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(securityHeaders)) {
    headers.set(name, value);
  }

  if (headers.get("Content-Type")?.includes("text/html")) {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    headers.set("Content-Security-Policy", htmlContentSecurityPolicy);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
