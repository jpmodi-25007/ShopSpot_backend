import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { stripSecrets } from '../helpers/sanitize.helper';

/**
 * Safety net registered globally: no matter which service builds a response
 * (for example via `include: { owner: true }`), password hashes and password
 * reset data are never serialised to a client. The response shape is not
 * otherwise modified.
 */
@Injectable()
export class StripSecretsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => stripSecrets(data)));
  }
}
