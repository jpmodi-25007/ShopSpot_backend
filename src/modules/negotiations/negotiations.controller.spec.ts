import { Test, TestingModule } from '@nestjs/testing';
import { NegotiationsController } from './negotiations.controller';
import { NegotiationsService } from './negotiations.service';
import { UserRole } from '@prisma/client';

describe('NegotiationsController', () => {
  let controller: NegotiationsController;
  let negotiationsService: jest.Mocked<NegotiationsService>;

  beforeEach(async () => {
    const mockNegotiationsService = {
      startNegotiation: jest.fn(),
      shopkeeperCounter: jest.fn(),
      shopkeeperAccept: jest.fn(),
      shopkeeperReject: jest.fn(),
      getMyNegotiations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NegotiationsController],
      providers: [
        {
          provide: NegotiationsService,
          useValue: mockNegotiationsService,
        },
      ],
    }).compile();

    controller = module.get<NegotiationsController>(NegotiationsController);
    negotiationsService = module.get(NegotiationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('start', () => {
    it('should create an initial offer', async () => {
      const body = {
        productId: 'prod-1',
        offeredPrice: 150,
        message: 'I can pay 150',
      };

      const result = {
        id: 'neg-1',
        productId: 'prod-1',
        customerId: 'user-1',
        shopId: 'shop-1',
        status: 'PENDING' as any,
        currentOfferPrice: 150,
        currency: 'USD',
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      negotiationsService.startNegotiation.mockResolvedValue(result as any);

      expect(await controller.start('user-1', body as any)).toEqual(result as any);
      expect(negotiationsService.startNegotiation).toHaveBeenCalledWith('user-1', body);
    });
  });

  describe('shopAccept', () => {
    it('should accept an offer', async () => {
      const result = {
        id: 'neg-1',
        productId: 'prod-1',
        customerId: 'user-1',
        shopId: 'shop-1',
        status: 'ACCEPTED' as any,
        currentOfferPrice: 150,
        currency: 'USD',
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      negotiationsService.shopkeeperAccept.mockResolvedValue(result as any);

      expect(await controller.shopAccept('neg-1', 'shop-staff-1')).toEqual(result as any);
      expect(negotiationsService.shopkeeperAccept).toHaveBeenCalledWith('neg-1', 'shop-staff-1');
    });
  });
});
