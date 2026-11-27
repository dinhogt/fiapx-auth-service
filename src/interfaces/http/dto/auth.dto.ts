import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterBodyDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Ana Silva' })
  name!: string;

  @ApiProperty({ format: 'email', example: 'ana@example.com' })
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, example: 'Str0ng-Passw0rd!' })
  password!: string;
}

export class LoginBodyDto {
  @ApiProperty({ format: 'email', example: 'ana@example.com' })
  email!: string;

  @ApiProperty({ minLength: 1, example: 'Str0ng-Passw0rd!' })
  password!: string;
}

export class RefreshBodyDto {
  @ApiProperty({ description: 'Opaque refresh token from login/refresh' })
  refreshToken!: string;
}

export class RegisteredUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TokenPairDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 900 })
  expiresIn!: number;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ example: 3600 })
  refreshExpiresIn!: number;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class ProblemDetailsDto {
  @ApiProperty({ example: 'about:blank' })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: number;

  @ApiProperty()
  detail!: string;

  @ApiPropertyOptional()
  instance?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  correlationId?: string;
}
