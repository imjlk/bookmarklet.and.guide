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
    "@bmkl/vite",
    "@bmkl/cli",
  ],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/project") {
      return Response.json({
        ...project,
        siteName: env.BMKL_SITE_NAME ?? project.name,
        generatedAt: new Date().toISOString(),
      });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && acceptsHtml(request)) {
      return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    }

    return response;
  },
};

function acceptsHtml(request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}
