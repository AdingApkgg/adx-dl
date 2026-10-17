import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { z } from "zod";

const origin = "https://bbs.wmc.pub";
const profile = z.object({
  me: z.object({
    user_id: z.number().int().positive().safe(),
    username: z.string().trim().min(1).max(100),
  }),
});
const token = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().nonnegative().optional(),
});

/** Plain OAuth: identity comes only from the authenticated /api/me numeric user_id. */
export function createAwmcProvider(client: { clientId: string; clientSecret: string }): GenericOAuthConfig<"awmc"> {
  return {
    providerId: "awmc",
    name: "AWMC",
    ...client,
    authorizationUrl: `${origin}/audapi/oauth2/authorize`,
    scopes: ["user:read"],
    pkce: true,
    async getToken({ code, redirectURI, codeVerifier }) {
      try {
        if (!codeVerifier) throw new Error("AWMC_PKCE_REQUIRED");
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectURI,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          code_verifier: codeVerifier,
        });
        const response = await fetch(`${origin}/api/audapi-oauth2/token`, {
          method: "POST",
          headers: { accept: "application/json" },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("AWMC_TOKEN_EXCHANGE_FAILED");
        const result = token.safeParse(await response.json());
        if (!result.success) throw new Error("AWMC_TOKEN_INVALID");
        return {
          accessToken: result.data.access_token,
          tokenType: "bearer",
          accessTokenExpiresAt:
            result.data.expires_in === undefined ? undefined : new Date(Date.now() + result.data.expires_in * 1000),
          scopes: ["user:read"],
        };
      } catch {
        // Neither provider bodies nor transport/parser exceptions may reach auth logs.
        throw new Error("AWMC_TOKEN_EXCHANGE_FAILED");
      }
    },
    async getUserInfo(tokens) {
      if (!tokens.accessToken) return null;
      try {
        const response = await fetch(`${origin}/api/me`, {
          headers: { authorization: `Bearer ${tokens.accessToken}`, accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        const result = profile.safeParse(await response.json());
        if (!result.success) return null;
        const me = result.data.me;
        return {
          id: String(me.user_id),
          name: me.username,
          email: `awmc-${me.user_id}@provider.invalid`,
          emailVerified: false,
        };
      } catch {
        // Better Auth converts a missing profile into the configured error callback.
        return null;
      }
    },
  };
}
