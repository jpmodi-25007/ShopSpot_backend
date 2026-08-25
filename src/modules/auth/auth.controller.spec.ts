import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    // Mock the AuthService methods
    const mockAuthService = {
      registerWithEmail: jest.fn(),
      registerWithMobile: jest.fn(),
      loginWithEmail: jest.fn(),
      loginWithMobile: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
      getMe: jest.fn(),
      updateMe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('registerEmail', () => {
    it('should successfully register a new user', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
        role: 'CUSTOMER' as any,
      };
      const result = {
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
          role: 'CUSTOMER' as any,
          mobile: null,
          avatarUrl: null,
          languagePreference: 'en',
          addressJson: null,
          isEmailVerified: false,
          isMobileVerified: false,
          isActive: true,
          lastLoginAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };

      authService.registerWithEmail.mockResolvedValue(result as any);

      expect(await controller.registerEmail(registerDto)).toEqual(result);
      expect(authService.registerWithEmail).toHaveBeenCalledWith(registerDto);
    });
  });

  describe('loginEmail', () => {
    it('should authenticate a user and return tokens', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'Password123!',
        role: 'CUSTOMER' as any,
      };
      const result = {
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
          role: 'CUSTOMER' as any,
          mobile: null,
          avatarUrl: null,
          languagePreference: 'en',
          addressJson: null,
          isEmailVerified: true,
          isMobileVerified: false,
          isActive: true,
          lastLoginAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };

      authService.loginWithEmail.mockResolvedValue(result as any);

      expect(await controller.loginEmail(loginDto)).toEqual(result as any);
      expect(authService.loginWithEmail).toHaveBeenCalledWith(loginDto);
    });
  });
});
