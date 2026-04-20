import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isLoggedIn$.pipe(
    take(1),
    map(loggedIn => {
      if (!loggedIn) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    })
  );
};
