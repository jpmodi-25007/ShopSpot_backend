import { Test, TestingModule } from '@nestjs/testing';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { UserRole } from '@prisma/client';

describe('ShopsController', () => {
  let controller: ShopsController;
  let shopsService: jest.Mocked<ShopsService>;

  beforeEach(async () => {
    const mockShopsService = {
      createShop: jest.fn(),
      getMyShop: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      updateShop: jest.fn(),
      getStaff: jest.fn(),
      addStaff: jest.fn(),
      removeStaff: jest.fn(),
      searchByLocation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopsController],
      providers: [
        {
          provide: ShopsService,
          useValue: mockShopsService,
        },
      ],
    }).compile();

    controller = module.get<ShopsController>(ShopsController);
    shopsService = module.get(ShopsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createShop', () => {
    it('should create a new shop', async () => {
      const createShopDto = {
        name: 'Test Shop',
        description: 'A great shop',
        addressText: '123 Test St',
        latitude: 37.7749,
        longitude: -122.4194,
      };

      const result = {
        id: 'shop-1',
        ownerId: 'user-1',
        name: 'Test Shop',
        description: 'A great shop',
        coverImage: null,
        addressText: '123 Test St',
        isActive: true,
        isVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        location: null as any,
      };

      shopsService.createShop.mockResolvedValue(result as any);

      expect(await controller.createShop('user-1', createShopDto as any)).toEqual(result);
      expect(shopsService.createShop).toHaveBeenCalledWith('user-1', createShopDto);
    });
  });

  describe('getMyShop', () => {
    it('should return the shop belonging to the user', async () => {
      const result = {
        id: 'shop-1',
        ownerId: 'user-1',
        name: 'Test Shop',
        description: 'A great shop',
        coverImage: null,
        addressText: '123 Test St',
        isActive: true,
        isVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        location: null as any,
      };

      shopsService.getMyShop.mockResolvedValue(result as any);

      expect(await controller.getMyShop('user-1')).toEqual(result);
      expect(shopsService.getMyShop).toHaveBeenCalledWith('user-1');
    });
  });
});
