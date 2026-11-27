export type AccessTokenClaims = {
  sub: string;
  sid: string;
};

export type SignedAccessToken = {
  accessToken: string;
  expiresIn: number;
};

export interface AccessTokenSigner {
  sign(claims: AccessTokenClaims): Promise<SignedAccessToken>;
}
