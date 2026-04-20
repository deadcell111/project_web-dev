import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'feed', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  { path: 'register', loadComponent: () => import('./pages/register/register').then(m => m.Register) },
  { path: 'feed', loadComponent: () => import('./pages/feed/feed').then(m => m.Feed) },
  { path: 'items/:id', loadComponent: () => import('./pages/item-detail/item-detail').then(m => m.ItemDetail) },
  { path: 'my-items', loadComponent: () => import('./pages/my-items/my-items').then(m => m.MyItems), canActivate: [authGuard] },
  { path: 'post', loadComponent: () => import('./pages/post-item/post-item').then(m => m.PostItem), canActivate: [authGuard] },
];
