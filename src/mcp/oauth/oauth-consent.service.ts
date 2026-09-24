import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { Either, left, right } from '@/vault/domain/either';
import { McpConfig } from '../mcp.config';
import { OAuthRepository } from './oauth.repository';
import { generateSecret, hashSecret } from './oauth-secrets';

const REQUEST_AUDIENCE = 'duna-mcp-consent';
const REQUEST_TTL_SECONDS = 10 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;

/**
 * A pending /authorize request, carried to the consent screen and back as a
 * signed JWT so no server-side state is needed until the user decides.
 */
export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: string[];
  resource: string | null;
};

export function signAuthorizationRequest(
  jwtService: JwtService,
  secret: string,
  request: AuthorizationRequest,
): Promise<string> {
  return jwtService.signAsync(request, {
    secret,
    audience: REQUEST_AUDIENCE,
    expiresIn: REQUEST_TTL_SECONDS,
  });
}

export type ConsentDetails = {
  clientName: string | null;
  clientUri: string | null;
  redirectUri: string;
};

@Injectable()
export class OAuthConsentService {
  constructor(
    private readonly repository: OAuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: McpConfig,
  ) {}

  async describe(signed: string): Promise<Either<string, ConsentDetails>> {
    const [error, validated] = await this.validate(signed);
    if (error !== null) return left(error);
    const { request, clientName, clientUri } = validated;
    return right({ clientName, clientUri, redirectUri: request.redirectUri });
  }

  async approve(
    signed: string,
    vaultId: string,
  ): Promise<Either<string, { redirectUrl: string }>> {
    const [error, validated] = await this.validate(signed);
    if (error !== null) return left(error);
    const { request } = validated;

    const code = generateSecret();
    const now = new Date();
    await this.repository.createAuthorizationCode({
      codeHash: hashSecret(code),
      clientId: request.clientId,
      vaultId,
      codeChallenge: request.codeChallenge,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      resource: request.resource,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      usedAt: null,
      createdAt: now,
    });

    const url = new URL(request.redirectUri);
    url.searchParams.set('code', code);
    if (request.state !== null) url.searchParams.set('state', request.state);
    return right({ redirectUrl: url.href });
  }

  async deny(signed: string): Promise<Either<string, { redirectUrl: string }>> {
    const [error, validated] = await this.validate(signed);
    if (error !== null) return left(error);
    const { request } = validated;

    const url = new URL(request.redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'O usuário negou o acesso');
    if (request.state !== null) url.searchParams.set('state', request.state);
    return right({ redirectUrl: url.href });
  }

  /**
   * Besides the signature, re-checks the client and redirect_uri against what
   * is registered: a code must never be sent to a URI the client did not
   * register, even if the signing secret leaked.
   */
  private async validate(signed: string): Promise<
    Either<
      string,
      {
        request: AuthorizationRequest;
        clientName: string | null;
        clientUri: string | null;
      }
    >
  > {
    let request: AuthorizationRequest;
    try {
      request = await this.jwtService.verifyAsync<AuthorizationRequest>(
        signed,
        { secret: this.config.jwtSecret, audience: REQUEST_AUDIENCE },
      );
    } catch {
      return left('Pedido de autorização inválido ou expirado');
    }

    const client = await this.repository.findClient(request.clientId);
    if (!client) {
      return left('Aplicativo não encontrado');
    }
    const redirectAllowed = client.redirect_uris.some((registered) =>
      redirectUriMatches(request.redirectUri, registered),
    );
    if (!redirectAllowed) {
      return left('Endereço de retorno não registrado para este aplicativo');
    }

    return right({
      request,
      clientName: client.client_name ?? null,
      clientUri: client.client_uri ?? null,
    });
  }
}
