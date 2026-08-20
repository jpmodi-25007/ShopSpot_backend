import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SearchService } from '../search.service';
import { GlobalSearchDto } from '../dto/search.dto';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Global search across shops, products, and categories' })
  globalSearch(@Query() query: GlobalSearchDto) {
    return this.searchService.globalSearch(query);
  }
}
