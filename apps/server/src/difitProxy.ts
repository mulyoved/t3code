export const DIFIT_PROXY_PATH_PREFIX = "/__difit";

export interface DifitProxyMatch {
  readonly sessionRevision: string;
  readonly targetPath: string;
}

export interface ProxyDifitRequestOptions {
  readonly request: Request;
  readonly url: URL;
  readonly targetOrigin: string;
  readonly proxyBasePath: string;
  readonly fetchImpl?: typeof fetch;
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

function shouldRewriteResponse(headers: Headers): boolean {
  const contentEncoding = headers.get("content-encoding");
  if (contentEncoding && contentEncoding.length > 0) {
    return false;
  }
  const contentType = headers.get("content-type");
  if (!contentType) {
    return false;
  }
  return (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("text/css")
  );
}

function copyProxyHeaders(headers: Headers, rewrittenBody?: Uint8Array): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.delete("content-length");
  nextHeaders.delete("transfer-encoding");
  nextHeaders.delete("connection");
  if (rewrittenBody) {
    nextHeaders.set("content-length", String(rewrittenBody.byteLength));
  }
  return nextHeaders;
}

function filterRequestHeaders(headers: Headers, targetOrigin: string) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("host", new URL(targetOrigin).host);
  nextHeaders.delete("connection");
  return nextHeaders;
}

export async function proxyDifitRequest(options: ProxyDifitRequestOptions): Promise<Response> {
  const { request, url, targetOrigin, proxyBasePath } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const match = matchDifitProxyPath(url.pathname);
  if (!match) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  const targetUrl = new URL(`${match.targetPath}${url.search}`, targetOrigin);
  const proxiedRequestInit: RequestInit = {
    method: request.method,
    headers: filterRequestHeaders(request.headers, targetOrigin),
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    proxiedRequestInit.body = request.body;
    proxiedRequestInit.duplex = "half";
  }
  const proxiedRequest = new Request(targetUrl.toString(), proxiedRequestInit);
  const proxiedResponse = await fetchImpl(proxiedRequest);

  if (!shouldRewriteResponse(proxiedResponse.headers) || request.method === "HEAD") {
    return new Response(proxiedResponse.body, {
      status: proxiedResponse.status,
      statusText: proxiedResponse.statusText,
      headers: copyProxyHeaders(proxiedResponse.headers),
    });
  }

  const text = await proxiedResponse.text();
  const rewrittenBody = new TextEncoder().encode(
    rewriteDifitTextAsset(
      text,
      proxyBasePath,
      proxiedResponse.headers.get("content-type"),
    ),
  );

  return new Response(rewrittenBody, {
    status: proxiedResponse.status,
    statusText: proxiedResponse.statusText,
    headers: copyProxyHeaders(proxiedResponse.headers, rewrittenBody),
  });
}
