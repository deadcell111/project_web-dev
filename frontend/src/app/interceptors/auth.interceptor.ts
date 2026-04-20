import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../services/auth.service';

let isRefreshing = false;
const refreshSubject = new BehaviorSubject<boolean>(false);

function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : '';
}

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const router = inject(Router);
  const http = inject(HttpClient);
  const auth = inject(AuthService);

  let cloned = req.clone({ withCredentials: true });

  const csrfToken = getCookie('csrftoken');
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    cloned = cloned.clone({
      setHeaders: { 'X-CSRFToken': csrfToken }
    });
  }

  return next(cloned).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !req.url.includes('/auth/refresh/') && !req.url.includes('/auth/login/') && !req.url.includes('/auth/me/')) {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshSubject.next(false);

          return http.post('/api/auth/refresh/', {}, { withCredentials: true }).pipe(
            switchMap(() => {
              isRefreshing = false;
              refreshSubject.next(true);
              return next(cloned);
            }),
            catchError(refreshError => {
              isRefreshing = false;
              refreshSubject.next(false);
              auth.clearUser();
              router.navigate(['/login']);
              return throwError(() => refreshError);
            })
          );
        } else {
          return refreshSubject.pipe(
            filter(result => result),
            take(1),
            switchMap(() => next(cloned))
          );
        }
      }
      return throwError(() => error);
    })
  );
};
