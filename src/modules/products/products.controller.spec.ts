import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let productsService: jest.Mocked<ProductsService>;

  beforeEach(async () => {
    const mockProductsService = {
      createProduct: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      updateProduct: jest.fn(),
      updateStock: jest.fn(),
      removeProduct: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    productsService = module.get(ProductsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a product for a given shop', async () => {
      const createProductDto = {
        name: 'Headphones',
        description: 'Noise cancelling',
        basePrice: 200,
        currency: 'USD',
        categoryId: 'cat-1',
        stockQuantity: 50,
      };

      const result = {
        id: 'prod-1',
        shopId: 'shop-1',
        categoryId: 'cat-1',
        name: 'Headphones',
        description: 'Noise cancelling',
        basePrice: 200,
        currency: 'USD',
        mediaAssets: [],
        stockQuantity: 50,
        stockStatus: 'IN_STOCK' as any,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      productsService.createProduct.mockResolvedValue(result as any);

      expect(await controller.create('shop-1', createProductDto as any)).toEqual(result);
      expect(productsService.createProduct).toHaveBeenCalledWith('shop-1', createProductDto);
    });
  });
});
