import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export const DIFIT_PROXY_PATH_PREFIX = "/__difit";

export interface DifitProxyMatch {
  readonly sessionRevision: string;
  readonly targetPath: string;
}

export interface ProxyDifitRequestOptions {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly targetPort: number;
  readonly proxyBasePath: string;
}

function rewriteQuotedAbsolutePaths(source: string, proxyBasePath: string): string {
  return source.replace(
    /(["'`])\/(assets\/|api\/|favicon(?:-white)?\.svg)/g,
    (_match, quote, path) => `${quote}${proxyBasePath}/${path}`,
  );
}

function buildDifitProxyShim(proxyBasePath: string): string {
  return `<script>(function(){const prefix=${JSON.stringify(
    proxyBasePath,
  )};const origin=window.location.origin;const prefixUrl=(input)=>{if(typeof input!=="string"){return input;}if(input.startsWith(prefix)||input.startsWith("http://")||input.startsWith("https://")||input.startsWith("//")||input.startsWith("data:")||input.startsWith("blob:")){return input;}if(input.startsWith(origin+"/")){const path=input.slice(origin.length);return path.startsWith("/")?prefix+path:input;}return input.startsWith("/")?prefix+input:input;};const originalFetch=window.fetch.bind(window);window.fetch=function(input,init){if(typeof input==="string"){return originalFetch(prefixUrl(input),init);}if(input instanceof Request){const nextUrl=prefixUrl(input.url);if(nextUrl!==input.url){input=new Request(nextUrl,input);}return originalFetch(input,init);}return originalFetch(input,init);};if(window.EventSource){const OriginalEventSource=window.EventSource;window.EventSource=function(url,config){return new OriginalEventSource(prefixUrl(String(url)),config);};window.EventSource.prototype=OriginalEventSource.prototype;}const xhrOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){return xhrOpen.call(this,method,prefixUrl(String(url)),...rest);};})();</script>`;
}

export function buildDifitProxyBasePath(sessionRevision: string): string {
  return `${DIFIT_PROXY_PATH_PREFIX}/${encodeURIComponent(sessionRevision)}`;
}

export function matchDifitProxyPath(pathname: string): DifitProxyMatch | null {
  if (!pathname.startsWith(`${DIFIT_PROXY_PATH_PREFIX}/`)) {
    return null;
  }
  const suffix = pathname.slice(DIFIT_PROXY_PATH_PREFIX.length + 1);
  const slashIndex = suffix.indexOf("/");
  if (slashIndex < 0) {
    return {
      sessionRevision: decodeURIComponent(suffix),
      targetPath: "/",
    };
  }
  const sessionRevision = decodeURIComponent(suffix.slice(0, slashIndex));
  const remainder = suffix.slice(slashIndex);
  return {
    sessionRevision,
    targetPath: remainder.length > 0 ? remainder : "/",
  };
}

export function rewriteDifitDocumentHtml(input: string, proxyBasePath: string): string {
  const rewritten = rewriteQuotedAbsolutePaths(input, proxyBasePath);
  const shim = buildDifitProxyShim(proxyBasePath);
  if (rewritten.includes("</head>")) {
    return rewritten.replace("</head>", `${shim}</head>`);
  }
  return `${shim}${rewritten}`;
}

export function rewriteDifitTextAsset(
  input: string,
  proxyBasePath: string,
  contentType: string | null,
): string {
  if (contentType?.includes("text/html")) {
    return rewriteDifitDocumentHtml(input, proxyBasePath);
  }
  return rewriteQuotedAbsolutePaths(input, proxyBasePath);
}

function shouldRewriteResponse(headers: http.IncomingHttpHeaders): boolean {
  const contentEncoding = headers["content-encoding"];
  if (typeof contentEncoding === "string" && contentEncoding.length > 0) {
    return false;
  }
  const contentType = headers["content-type"];
  if (typeof contentType !== "string") {
    return false;
  }
  return (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("text/css")
  );
}

function copyProxyHeaders(
  headers: http.IncomingHttpHeaders,
  rewrittenBody?: Buffer,
): http.OutgoingHttpHeaders {
  const nextHeaders: http.OutgoingHttpHeaders = { ...headers };
  delete nextHeaders["content-length"];
  delete nextHeaders["transfer-encoding"];
  delete nextHeaders.connection;
  if (rewrittenBody) {
    nextHeaders["content-length"] = Buffer.byteLength(rewrittenBody);
  }
  return nextHeaders;
}

function filterRequestHeaders(headers: IncomingMessage["headers"], targetPort: number) {
  const nextHeaders: http.OutgoingHttpHeaders = { ...headers };
  nextHeaders.host = `127.0.0.1:${targetPort}`;
  delete nextHeaders.connection;
  return nextHeaders;
}

export async function proxyDifitRequest(options: ProxyDifitRequestOptions): Promise<void> {
  const { request, response, url, targetPort, proxyBasePath } = options;
  const match = matchDifitProxyPath(url.pathname);
  if (!match) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not Found");
    return;
  }

  await new Promise<void>((resolve) => {
    const proxyRequest = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        method: request.method,
        path: `${match.targetPath}${url.search}`,
        headers: filterRequestHeaders(request.headers, targetPort),
      },
      (proxyResponse) => {
        const shouldRewrite = shouldRewriteResponse(proxyResponse.headers);
        if (!shouldRewrite || request.method === "HEAD") {
          response.writeHead(
            proxyResponse.statusCode ?? 502,
            copyProxyHeaders(proxyResponse.headers),
          );
          proxyResponse.pipe(response);
          proxyResponse.on("end", () => resolve());
          return;
        }

        const chunks: Buffer[] = [];
        proxyResponse.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        proxyResponse.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const rewrittenBody = Buffer.from(
            rewriteDifitTextAsset(
              text,
              proxyBasePath,
              typeof proxyResponse.headers["content-type"] === "string"
                ? proxyResponse.headers["content-type"]
                : null,
            ),
          );
          response.writeHead(
            proxyResponse.statusCode ?? 502,
            copyProxyHeaders(proxyResponse.headers, rewrittenBody),
          );
          response.end(rewrittenBody);
          resolve();
        });
        proxyResponse.on("error", () => {
          if (!response.headersSent) {
            response.writeHead(502, { "Content-Type": "text/plain" });
          }
          response.end("Bad Gateway");
          resolve();
        });
      },
    );

    const closeProxyRequest = () => {
      proxyRequest.destroy();
    };

    request.on("aborted", closeProxyRequest);
    response.on("close", closeProxyRequest);

    proxyRequest.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "Content-Type": "text/plain" });
      }
      response.end("Bad Gateway");
      resolve();
    });

    if (request.readableEnded || request.method === "GET" || request.method === "HEAD") {
      proxyRequest.end();
      return;
    }

    request.pipe(proxyRequest);
  });
}
