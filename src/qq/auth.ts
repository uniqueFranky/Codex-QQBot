import type { Config } from "../config.js";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  message?: string;
  code?: number;
}

export class QQAuth {
  private token = "";
  private expiresAt = 0;

  constructor(private readonly config: Config) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.expiresAt - 60_000) return this.token;

    const response = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: this.config.qqAppId,
        clientSecret: this.config.qqAppSecret
      })
    });

    const body = (await response.json()) as TokenResponse;
    if (!response.ok || !body.access_token) {
      throw new Error(
        `QQ token request failed: ${response.status} ${JSON.stringify(body)}`
      );
    }

    this.token = body.access_token;
    this.expiresAt = now + (body.expires_in ?? 7200) * 1000;
    return this.token;
  }
}

