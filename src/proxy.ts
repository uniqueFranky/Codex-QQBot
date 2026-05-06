import { ProxyAgent, setGlobalDispatcher } from "undici";

export function configureGlobalProxy(): void {
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (!proxy) return;

  setGlobalDispatcher(new ProxyAgent(proxy));
  console.log(`HTTP(S) proxy enabled: ${redactProxy(proxy)}`);
}

function redactProxy(proxy: string): string {
  try {
    const url = new URL(proxy);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    return "<invalid proxy url>";
  }
}
