import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateStockDto,
  ProductQueryDto,
  SearchProductsDto,
} from './dto/product.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('shopkeeper/products')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a new product' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateProductDto) {
    return this.productsService.createProduct(userId, dto);
  }

  @Get('shopkeeper/products')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List my products' })
  listMine(@CurrentUser('id') userId: string, @Query() query: ProductQueryDto) {
    return this.productsService.getMyProducts(userId, query);
  }

  @Put('shopkeeper/products/:id')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update product' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(userId, id, dto);
  }

  @Delete('shopkeeper/products/:id')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Soft-delete product' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.deleteProduct(userId, id);
  }

  @Put('shopkeeper/products/:id/stock')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update product stock quantity' })
  updateStock(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
  ) {
    return this.productsService.updateStock(userId, id, dto);
  }

  @Public()
  @Get('products/search')
  @ApiOperation({ summary: 'Search products' })
  search(@Query() query: SearchProductsDto) {
    return this.productsService.searchProducts(query);
  }

  @Public()
  @Get('products/trending')
  @ApiOperation({ summary: 'Get trending products' })
  trending(@Query('limit') limit = 10) {
    return this.productsService.getTrending(+limit);
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'Get product detail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getProductDetail(id);
  }

  @Public()
  @Get('products/:id/compare')
  @ApiOperation({ summary: 'Price comparison across shops' })
  compare(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
  ) {
    return this.productsService.getPriceComparison(
      id,
      lat ? +lat : undefined,
      lng ? +lng : undefined,
    );
  }
}
